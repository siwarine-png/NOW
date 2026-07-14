/**
 * Mounted under /v2 -- Parking Lot (migration 028): capture a new idea
 * without it becoming a real commitment that competes in the DO-THIS-NOW
 * rotation. Plain CRUD over parking_lot_items; converting an idea into a
 * real project happens client-side (opens AddPainPointScreen prefilled
 * with the title) -- this only needs to mark the item resolved once that
 * succeeds, no linkage back to the created commitment is tracked.
 */
const { Router } = require('express');
const sb = require('../db/client');

const router = Router();

// GET /v2/parking-lot?user_id=&status=parked
router.get('/', async (req, res) => {
  const { user_id, status } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await sb
    .from('parking_lot_items')
    .select('*')
    .eq('user_id', user_id)
    .eq('status', status || 'parked')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /v2/parking-lot
router.post('/', async (req, res) => {
  const { user_id, title } = req.body;
  if (!user_id || !title?.trim()) return res.status(400).json({ error: 'user_id and title required' });

  const { data: user } = await sb.from('users').select('id').eq('id', user_id).eq('app_id', req.app_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { data, error } = await sb.from('parking_lot_items').insert({ user_id, title: title.trim() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /v2/parking-lot/:id -- status: 'dismissed' or 'converted' only, the
// two ways a parked idea gets resolved. Never re-parked once decided.
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  if (!['dismissed', 'converted'].includes(status)) {
    return res.status(400).json({ error: "status must be 'dismissed' or 'converted'" });
  }

  const { data: current } = await sb
    .from('parking_lot_items').select('id, users!inner(app_id)').eq('id', req.params.id).single();
  if (!current || current.users.app_id !== req.app_id) return res.status(404).json({ error: 'Not found' });

  const { data, error } = await sb
    .from('parking_lot_items')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
