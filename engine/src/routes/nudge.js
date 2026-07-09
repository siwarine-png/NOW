/**
 * Adaptive Nudge Engine — client-facing surface. Onboarding's app-open test
 * is started from POST /users (see routes/users.js); these three endpoints
 * cover reuse (establish a second behavior), status polling, and the user
 * override that beats another silent test cycle.
 */
const { Router } = require('express');
const sb = require('../db/client');
const nudgeEngine = require('../engine/nudgeEngine');

const router = Router();

async function requireOwnedUser(req, res) {
  const { user_id } = { ...req.query, ...req.body };
  if (!user_id) { res.status(400).json({ error: 'user_id required' }); return null; }
  const { data: user } = await sb.from('users').select('id').eq('id', user_id).eq('app_id', req.app_id).single();
  if (!user) { res.status(404).json({ error: 'User not found' }); return null; }
  return user_id;
}

// POST /behaviors/establish { user_id, behavior, frequency }
// Executive Engine's establish("take medication", frequency="daily") call.
router.post('/behaviors/establish', async (req, res) => {
  const user_id = await requireOwnedUser(req, res);
  if (!user_id) return;
  const { behavior, frequency } = req.body;
  if (behavior !== 'medication') return res.status(400).json({ error: 'Only "medication" is supported in MVP1' });

  try {
    const result = await nudgeEngine.establishMedication(sb, user_id, frequency);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /behaviors/:behavior/status?user_id=
router.get('/behaviors/:behavior/status', async (req, res) => {
  const user_id = await requireOwnedUser(req, res);
  if (!user_id) return;
  const status = await nudgeEngine.getStatus(sb, user_id, req.params.behavior);
  res.json(status);
});

// POST /nudge/override { user_id, behavior, anchor, anchor_time }
// "This time isn't sticking — want to try a different anchor?" -- the user's
// direct pick, not another silent test cycle.
router.post('/nudge/override', async (req, res) => {
  const user_id = await requireOwnedUser(req, res);
  if (!user_id) return;
  const { behavior, anchor, anchor_time } = req.body;
  if (!anchor || !anchor_time) return res.status(400).json({ error: 'anchor and anchor_time required' });

  try {
    const result = await nudgeEngine.overrideAnchor(sb, user_id, behavior || 'app_open', anchor, anchor_time);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
