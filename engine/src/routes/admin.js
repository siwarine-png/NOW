/**
 * Admin/back-office routes — gated by ADMIN_SECRET, entirely separate from
 * the public /v1 API the NOW app (or any client) consumes. Adding endpoints
 * here doesn't touch the "8 endpoints" freeze on the client-facing surface;
 * this is internal tooling, not part of that contract.
 */
const { Router } = require('express');
const crypto = require('crypto');
const sb = require('../db/client');
const { hashKey } = require('../middleware/auth');
const { sendCheckinPush, runSchedulerTick, runPushReminderTick } = require('../engine/scheduler');
const nudgeEngine = require('../engine/nudgeEngine');

const router = Router();

router.use((req, res, next) => {
  const internal = req.headers['x-internal-secret'];
  if (internal !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
});

// POST /admin/apps — provision a new client app + API key (unchanged from before)
router.post('/apps', async (req, res) => {
  const { name, webhook_url, webhook_secret } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const rawKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;
  const { data, error } = await sb
    .from('apps')
    .insert({ name, api_key_hash: hashKey(rawKey), webhook_url, webhook_secret })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ app: data, api_key: rawKey });
});

// GET /admin/analytics/overview?app_id= — MVP2 gate metrics
router.get('/analytics/overview', async (req, res) => {
  const { data, error } = await sb.rpc('admin_gate_metrics', { p_app_id: req.query.app_id || null });
  if (error) return res.status(500).json({ error: error.message });
  const row = data?.[0] || {};
  res.json({
    ...row,
    // Objective, spec-stated threshold ("50-100 users with 2+ weeks of data")
    // — NOT a verdict on retention itself, which the spec says needs a real
    // cohort before defining a pass/fail bar.
    enough_users_for_gate_review: (row.users_2wk_plus || 0) >= 50,
  });
});

// GET /admin/analytics/rules?app_id= — per-rule fire count + acted rate
router.get('/analytics/rules', async (req, res) => {
  const { data, error } = await sb.rpc('admin_rule_performance', { p_app_id: req.query.app_id || null });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /admin/users?app_id=&limit=&offset= — per-user summary rows
router.get('/users', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const { data, error } = await sb.rpc('admin_user_summaries', {
    p_app_id: req.query.app_id || null, p_limit: limit, p_offset: offset,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /admin/users/:id/test-push — fire a check-in push on demand instead of
// waiting for the daily checkin_time window, so delivery can be verified
// (success or the exact rejection reason) immediately.
router.post('/users/:id/test-push', async (req, res) => {
  const { data: user, error } = await sb
    .from('users').select('id, push_token, web_push_subscription').eq('id', req.params.id).single();
  if (error || !user) return res.status(404).json({ error: 'user not found' });
  if (!user.push_token && !user.web_push_subscription) return res.status(400).json({ error: 'user has no push_token or web_push_subscription registered' });

  const result = await sendCheckinPush(user.id, user, 'Test push', 'This is a manual test push from the admin dashboard.');
  res.json(result);
});

// POST /admin/scheduler-tick — runs the same work the in-process node-cron
// timer does, but triggered externally. On Cloud Run without min-instances
// set, the container scales to zero when idle and the in-process cron never
// fires unattended -- only inbound HTTP traffic wakes an instance. Point a
// Cloud Scheduler job at this endpoint every 5 minutes (with the
// x-internal-secret header this router already requires) so the daily
// check-in push actually runs regardless of whether anything else is
// keeping the instance warm.
router.post('/scheduler-tick', async (req, res) => {
  try {
    await runSchedulerTick();
    await runPushReminderTick();
    await nudgeEngine.runNudgeTestsTick(sb);
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /admin/users/:id/nudge — profile + most recent test per behavior, for
// observability (same principle as the push-status column: a broken or
// stuck test should be visible, not something you have to guess about).
router.get('/users/:id/nudge', async (req, res) => {
  const { data: profile } = await sb.from('nudge_profiles').select('*').eq('user_id', req.params.id).single();
  const { data: tests } = await sb.from('nudge_tests')
    .select('*').eq('user_id', req.params.id).order('created_at', { ascending: false });
  res.json({ profile: profile || null, tests: tests || [] });
});

// GET /admin/users/:id/events?limit= — one user's raw event history
router.get('/users/:id/events', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { data, error } = await sb
    .from('events').select('*').eq('user_id', req.params.id)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /admin/events?type=&limit= — recent events across all users, optionally by type
router.get('/events', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  let q = sb.from('events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (req.query.type) q = q.eq('type', req.query.type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
