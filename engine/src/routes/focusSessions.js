/**
 * Mounted under /v2, same reasoning as identityCheckins.js -- new capability,
 * not part of the frozen /v1 surface. Write-only from the client's point of
 * view (log the session once it ends); no GET here yet since nothing reads
 * this back into the app -- it's raw signal for a future Adaptive Execution
 * Engine analysis, not a user-facing feature by itself.
 */
const { Router } = require('express');
const sb = require('../db/client');

const router = Router();

// POST /v2/focus-sessions — log one completed or cancelled focus session.
router.post('/', async (req, res) => {
  const {
    user_id, identity_axis, action_text, equivalent_id, commitment_id,
    planned_seconds, actual_seconds, started_at, ended_reason, left_count,
  } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!['completed', 'cancelled'].includes(ended_reason)) {
    return res.status(400).json({ error: "ended_reason must be 'completed' or 'cancelled'" });
  }
  if (!planned_seconds || !actual_seconds || !started_at) {
    return res.status(400).json({ error: 'planned_seconds, actual_seconds, started_at required' });
  }

  const { data, error } = await sb
    .from('focus_sessions')
    .insert({
      user_id, identity_axis: identity_axis || null, action_text: action_text || null,
      equivalent_id: equivalent_id || null, commitment_id: commitment_id || null,
      planned_seconds, actual_seconds, started_at,
      ended_reason, left_count: left_count || 0,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

module.exports = router;
