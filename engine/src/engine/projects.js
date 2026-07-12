/**
 * "Project" isn't a new concept in the schema -- it's any active commitment
 * that other commitments reference via parent_commitment_id (the same
 * decomposition mechanic Day Arc's checklist uses, see engine/decomposition.js
 * and routes/interventions.js's "only the current smallest step shows" rule).
 * This module answers one question about that existing structure: which
 * projects have gone quiet, so the app can nudge toward finishing what's
 * already started instead of silently accepting an unlimited number of new
 * ones -- same 7-day "gone quiet" threshold R8_stale_commitment already uses
 * for a single commitment (engine/rules.js), applied at the whole-project level.
 */
const sb = require('../db/client');

const STALE_DAYS = 7;

// needsReviewOnly: the creation-time soft nudge (routes/commitments.js's
// GET /stalled-projects) wants every currently-stalled project shown every
// time -- low stakes, purely informational context before adding something
// new. The periodic proactive check (scheduler.js's runStaleProjectCheckTick)
// wants the opposite: never re-ask about the same project more than once
// every STALE_DAYS, or "still going" would mean nothing since it'd just be
// asked again tomorrow. Same underlying stalled-detection, two different
// re-ask policies layered on top depending on which surface is asking.
async function getStalledProjects(userId, { needsReviewOnly = false } = {}) {
  const { data: commitments } = await sb
    .from('commitments')
    .select('id, title, parent_commitment_id, status, created_at, last_stale_check_at')
    .eq('user_id', userId);
  if (!commitments?.length) return [];

  const parentIds = new Set(commitments.filter(c => c.parent_commitment_id).map(c => c.parent_commitment_id));
  const activeProjects = commitments.filter(c => c.status === 'active' && parentIds.has(c.id));
  if (!activeProjects.length) return [];

  const childrenByParent = new Map();
  commitments.forEach(c => {
    if (!c.parent_commitment_id) return;
    if (!childrenByParent.has(c.parent_commitment_id)) childrenByParent.set(c.parent_commitment_id, []);
    childrenByParent.get(c.parent_commitment_id).push(c.id);
  });

  const now = Date.now();
  const stalled = [];

  for (const project of activeProjects) {
    if (needsReviewOnly && project.last_stale_check_at) {
      const daysSinceReview = Math.floor((now - new Date(project.last_stale_check_at).getTime()) / 86_400_000);
      if (daysSinceReview < STALE_DAYS) continue;
    }

    const memberIds = [project.id, ...(childrenByParent.get(project.id) || [])];
    const { data: checkins } = await sb
      .from('checkins')
      .select('occurred_at')
      .in('commitment_id', memberIds)
      .neq('result', 'snoozed')
      .order('occurred_at', { ascending: false })
      .limit(1);

    // No activity yet at all -- the project's own creation is the only
    // reference point for "how long has this sat untouched."
    const lastActivityAt = checkins?.[0]?.occurred_at || project.created_at;
    const daysSinceActivity = Math.floor((now - new Date(lastActivityAt).getTime()) / 86_400_000);

    if (daysSinceActivity >= STALE_DAYS) {
      stalled.push({ commitment_id: project.id, title: project.title, days_stalled: daysSinceActivity });
    }
  }

  return stalled;
}

// User's answer to "still going, or pause it (and why)?" -- 'continue' just
// records that this was reviewed (resets the STALE_DAYS re-ask clock
// without changing anything else); 'pause' also sets status to 'paused'
// (dropping it out of every active-commitment query, same as any other
// paused commitment) and keeps the stated reason as a real audit trail
// instead of the project just silently going quiet with no record of why.
async function reviewStaleProject(commitmentId, action, reason) {
  const updates = { last_stale_check_at: new Date().toISOString() };
  if (action === 'pause') {
    updates.status = 'paused';
    updates.paused_at = updates.last_stale_check_at;
    updates.paused_reason = reason || null;
  }
  const { data, error } = await sb.from('commitments').update(updates).eq('id', commitmentId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { getStalledProjects, reviewStaleProject, STALE_DAYS };
