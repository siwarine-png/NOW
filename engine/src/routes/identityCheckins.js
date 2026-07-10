/**
 * Mounted under /v2, not /v1 -- MVP1-SPEC-v3.md froze the v1 client surface
 * at 8 endpoints deliberately ("one was added and then removed mid-round to
 * hold that line"). New capability goes under /v2 instead, same pattern the
 * Adherence Addendum's POST /v2/evidence and GET /v2/disclosure/summary
 * already established (spec-only until now -- this is the first /v2 route
 * actually implemented).
 */
const { Router } = require('express');
const sb = require('../db/client');
const { AXES, isSampling, isDue, currentPhase } = require('../engine/identityCheckin');
const { isWithinWindow, nowMinutesInTz } = require('../engine/rules');
const { classifyActivity } = require('../engine/groq');
const { computeCurrentHoursPerWeek } = require('../engine/identityAggregate');

const router = Router();

// POST /v2/identity-checkins/suggest-axis — "not sure" path. Groq-assisted
// classification only, restricted to the same 6 axes and never written to
// the DB itself -- the client still needs an explicit Accept, which hits
// POST /v2/identity-checkins below just like a manual chip tap.
router.post('/suggest-axis', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    const { axis, is_fixed } = await classifyActivity(text.trim());
    res.json({ axis, is_fixed });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Best-effort fixed/flexible inference for a manual chip tap (no Groq
// classification available): true if "now" falls inside any of the user's
// currently-active commitments' windows, otherwise null (unknown, not "free"
// -- plenty of real fixed obligations, e.g. a day job, are never registered
// as a commitment in this app, so absence of a match isn't proof of anything).
async function inferIsFixed(userId, nowMin) {
  const { data: commitments } = await sb
    .from('commitments').select('window_start, window_end').eq('user_id', userId).eq('status', 'active');
  const hasMatch = (commitments || []).some(c => isWithinWindow(nowMin, c.window_start, c.window_end));
  return hasMatch ? true : null;
}

// POST /v2/identity-checkins — record one "what are you doing right now" response
router.post('/', async (req, res) => {
  const { user_id, identity_axis, is_fixed } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!AXES.includes(identity_axis)) return res.status(400).json({ error: `identity_axis must be one of: ${AXES.join(', ')}` });

  let resolvedIsFixed = typeof is_fixed === 'boolean' ? is_fixed : null;
  if (resolvedIsFixed === null) {
    const { data: user } = await sb.from('users').select('timezone').eq('id', user_id).single();
    if (user) resolvedIsFixed = await inferIsFixed(user_id, nowMinutesInTz(user.timezone));
  }

  const { data, error } = await sb
    .from('identity_checkins')
    .insert({ user_id, identity_axis, is_fixed: resolvedIsFixed })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /v2/identity-checkins/spectrum?user_id= — real current_hours_per_week
// per axis, computed from actual recorded check-ins (see
// engine/src/engine/identityAggregate.js). desired_hours_per_week isn't
// included -- that's the unbuilt allocation-engine side, not this endpoint's job.
router.get('/spectrum', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const result = await computeCurrentHoursPerWeek(user_id);
  if (!result) return res.status(404).json({ error: 'user not found' });
  res.json(result);
});

// GET /v2/identity-checkins/status?user_id= — client polls this on
// foreground (not on every notification tap specifically, so it also
// catches someone who just opens the app normally during a due window)
router.get('/status', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: user, error } = await sb
    .from('users').select('id, wake_time, sleep_time, timezone, identity_checkin_started_at')
    .eq('id', user_id).single();
  if (error || !user) return res.status(404).json({ error: 'user not found' });

  // Accounts created before this feature shipped (or any registration path
  // that missed it) never got identity_checkin_started_at set, which would
  // otherwise disable sampling forever -- start it here, on first check,
  // rather than only at registration.
  if (!user.identity_checkin_started_at) {
    user.identity_checkin_started_at = new Date().toISOString();
    await sb.from('users').update({ identity_checkin_started_at: user.identity_checkin_started_at }).eq('id', user_id);
  }

  // Sampling never ends (burst-then-sparse-forever, see identityCheckin.js) --
  // window_active is effectively always true once started, kept as a field
  // for a hypothetical future user with no start date rather than removed.
  if (!isSampling(user)) return res.json({ due: false, window_active: false, day: null, phase: null });

  const { data: last } = await sb
    .from('identity_checkins').select('created_at')
    .eq('user_id', user_id).order('created_at', { ascending: false }).limit(1).single();

  const nowMin = nowMinutesInTz(user.timezone);
  const due = isDue({ user, nowMin, lastCheckinAt: last?.created_at });
  const day = Math.floor((Date.now() - new Date(user.identity_checkin_started_at)) / 86_400_000) + 1;

  res.json({ due, window_active: true, day, phase: currentPhase(user) });
});

module.exports = router;
