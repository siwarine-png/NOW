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
const { AXES, isWithinSamplingWindow, isDue } = require('../engine/identityCheckin');
const { nowMinutesInTz } = require('../engine/rules');
const { suggestAxis } = require('../engine/groq');

const router = Router();

// POST /v2/identity-checkins/suggest-axis — "not sure" path. Groq-assisted
// classification only, restricted to the same 6 axes and never written to
// the DB itself -- the client still needs an explicit Accept, which hits
// POST /v2/identity-checkins below just like a manual chip tap.
router.post('/suggest-axis', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    const axis = await suggestAxis(text.trim());
    res.json({ axis });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /v2/identity-checkins — record one "what are you doing right now" response
router.post('/', async (req, res) => {
  const { user_id, identity_axis } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!AXES.includes(identity_axis)) return res.status(400).json({ error: `identity_axis must be one of: ${AXES.join(', ')}` });

  const { data, error } = await sb
    .from('identity_checkins')
    .insert({ user_id, identity_axis })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
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
  // otherwise disable sampling forever -- start the window here, on first
  // check, rather than only at registration.
  if (!user.identity_checkin_started_at) {
    user.identity_checkin_started_at = new Date().toISOString();
    await sb.from('users').update({ identity_checkin_started_at: user.identity_checkin_started_at }).eq('id', user_id);
  }

  const windowActive = isWithinSamplingWindow(user);
  if (!windowActive) return res.json({ due: false, window_active: false, day: null });

  const { data: last } = await sb
    .from('identity_checkins').select('created_at')
    .eq('user_id', user_id).order('created_at', { ascending: false }).limit(1).single();

  const nowMin = nowMinutesInTz(user.timezone);
  const due = isDue({ user, nowMin, lastCheckinAt: last?.created_at });
  const day = Math.floor((Date.now() - new Date(user.identity_checkin_started_at)) / 86_400_000) + 1;

  res.json({ due, window_active: true, day });
});

module.exports = router;
