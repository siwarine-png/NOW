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

async function getStalledProjects(userId) {
  const { data: commitments } = await sb
    .from('commitments')
    .select('id, title, parent_commitment_id, status, created_at')
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

module.exports = { getStalledProjects, STALE_DAYS };
