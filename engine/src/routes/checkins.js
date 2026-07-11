const { Router } = require('express');
const sb = require('../db/client');
const { log } = require('../engine/events');
const { loadStats } = require('../engine/stats');
const { scoreRisk } = require('../engine/risk');

const router = Router();

// Snooze duration → an absolute wake-up time. `minutes === null` means "today":
// suppressed until midnight in the user's own timezone (the "Today" option).
function computeSnoozedUntil(minutes, timezone) {
  if (minutes) return new Date(Date.now() + minutes * 60_000).toISOString();
  try {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    var get = (t) => parts.find((p) => p.type === t).value;
    // Midnight tonight, expressed as a UTC instant approximated via the tz offset trick:
    // safe enough here since we only need a same-day cutoff, not sub-minute precision.
    var localMidnight = new Date(`${get('year')}-${get('month')}-${get('day')}T23:59:59`);
    return localMidnight.toISOString();
  } catch (e) {
    var d = new Date(); d.setUTCHours(23, 59, 59, 999);
    return d.toISOString();
  }
}

// POST /checkins
// Side effect: closes any open intervention from last 24h
router.post('/', async (req, res) => {
  const { commitment_id, equivalent_id, result, energy, context, evidence_url } = req.body;
  if (!result) return res.status(400).json({ error: 'result required' });
  if (!commitment_id && !equivalent_id)
    return res.status(400).json({ error: 'commitment_id or equivalent_id required' });
  if (commitment_id && equivalent_id)
    return res.status(400).json({ error: 'pass only one of commitment_id, equivalent_id' });
  if (!['done','partial','skipped','snoozed'].includes(result))
    return res.status(400).json({ error: 'result must be done|partial|skipped|snoozed' });

  if (equivalent_id) {
    return handleEquivalentCheckin(req, res, { equivalent_id, result, energy, context, evidence_url });
  }

  // Verify ownership
  const { data: commitment } = await sb
    .from('commitments')
    .select('*, users!inner(id, app_id, timezone)')
    .eq('id', commitment_id)
    .single();

  if (!commitment || commitment.users.app_id !== req.app_id)
    return res.status(404).json({ error: 'Commitment not found' });

  const userId = commitment.user_id;

  // Write check-in
  const { data: checkin, error } = await sb
    .from('checkins')
    .insert({ commitment_id, result, energy, context, evidence_url })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Snooze suppresses re-triggering until it expires; any other result clears
  // a stale snooze (e.g. the user acted on their own before it ran out).
  const snoozedUntil = result === 'snoozed'
    ? computeSnoozedUntil(context?.snooze_minutes ?? null, commitment.users.timezone)
    : null;
  const commitmentUpdates = { snoozed_until: snoozedUntil };
  // cadence='once' has no notion of "tomorrow" -- nothing else in rules.js/
  // stats.js treats it differently from 'daily' (checkedInToday is purely
  // date-scoped), so without this a one-time task would silently resurface
  // the very next day. Marking it completed here is what actually retires
  // it, by dropping out of every "status = active" query everywhere else.
  if (result === 'done' && commitment.cadence === 'once') commitmentUpdates.status = 'completed';
  await sb.from('commitments').update(commitmentUpdates).eq('id', commitment_id);

  // A decomposed step just finished -- advance the next queued sibling into
  // the one thing that's actually surfaceable, same "only the current
  // smallest step shows" rule that already hides an open-children parent
  // (see GET /interventions/now). Queued steps sit at status 'paused' (no
  // new status value needed) until it's their turn; a 'daily' sibling (an
  // ongoing habit reached at the end of a checklist, e.g. "track views
  // daily") never completes on its own, so the chain simply stays there --
  // that's correct, not a bug, for a step meant to run indefinitely.
  if (commitmentUpdates.status === 'completed' && commitment.parent_commitment_id) {
    await advanceSiblingChain(commitment.parent_commitment_id);
  }

  // Close any open intervention from last 24h
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const outcome = (result === 'done' || result === 'partial') ? 'acted' : 'ignored';
  await sb.from('interventions')
    .update({ outcome, outcome_at: new Date().toISOString() })
    .eq('commitment_id', commitment_id)
    .is('outcome', null)
    .gte('issued_at', since);

  // Compute updated stats & risk for response
  const stats = await loadStats(commitment_id);
  const { score: risk, top_factor } = scoreRisk(commitment, stats);

  log(req.app_id, userId, 'checkin.created', {
    commitment_id, result, energy, intervention_outcome: outcome,
    streak: stats.streak, risk,
  });

  res.status(201).json({
    checkin,
    streak: stats.streak,
    risk: Math.round(risk * 100) / 100,
    top_factor,
  });
});

// Activates the earliest still-'paused' sibling under the same parent
// (created_at order), so a multi-step checklist surfaces exactly one step
// at a time instead of dumping all of them into the rotation together. If
// nothing's left to queue, and every sibling is now completed/abandoned,
// the parent itself is marked done -- closing the loop on the whole project.
async function advanceSiblingChain(parentId) {
  const { data: siblings } = await sb
    .from('commitments')
    .select('id, status')
    .eq('parent_commitment_id', parentId)
    .order('created_at', { ascending: true });
  if (!siblings?.length) return;

  const nextQueued = siblings.find(s => s.status === 'paused');
  if (nextQueued) {
    await sb.from('commitments').update({ status: 'active' }).eq('id', nextQueued.id);
    return;
  }

  const allDone = siblings.every(s => s.status === 'completed' || s.status === 'abandoned');
  if (allDone) await sb.from('commitments').update({ status: 'completed' }).eq('id', parentId);
}

// Engine v8: checkins against a domain equivalent instead of a commitment.
// No commitment-style stats/risk/intervention-closing here — that machinery
// is R1-R8-specific and the domain system (R9/R9a/R9b/R10) doesn't use it.
async function handleEquivalentCheckin(req, res, { equivalent_id, result, energy, context, evidence_url }) {
  const { data: equivalent } = await sb
    .from('outcome_equivalents')
    .select('*, users!inner(id, app_id, timezone)')
    .eq('id', equivalent_id)
    .single();

  if (!equivalent || equivalent.users.app_id !== req.app_id)
    return res.status(404).json({ error: 'Equivalent not found' });

  const userId = equivalent.user_id;

  const { data: checkin, error } = await sb
    .from('checkins')
    .insert({ equivalent_id, result, energy, context, evidence_url })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // First-ever completion promotes a seeded default into a real, user-
  // confirmed equivalent — the action itself is the confirmation (v8 step 7).
  let promoted = false;
  if (result === 'done') {
    const updates = { last_completed_at: new Date().toISOString() };
    if (equivalent.created_by === 'system_suggested') {
      updates.created_by = 'user';
      promoted = true;
    }
    await sb.from('outcome_equivalents').update(updates).eq('id', equivalent_id);
  }

  log(req.app_id, userId, 'checkin.created', {
    equivalent_id, domain: equivalent.domain, result, energy, promoted,
  });

  res.status(201).json({ checkin, promoted });
}

module.exports = router;
