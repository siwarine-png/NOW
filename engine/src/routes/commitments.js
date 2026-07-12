const { Router } = require('express');
const sb = require('../db/client');
const { log } = require('../engine/events');
const { loadStats } = require('../engine/stats');
const { isWithinWindow, nowMinutesInTz } = require('../engine/rules');
const { advanceSiblingChain } = require('../engine/decomposition');
const { getStalledProjects, reviewStaleProject } = require('../engine/projects');

const router = Router();

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

// POST /commitments
router.post('/', async (req, res) => {
  const { user_id, title, next_action, why, identity_tag, identity_axis,
          cadence, window_start, window_end, deadline,
          priority_tier, parent_commitment_id, status } = req.body;

  if (!user_id || !title) return res.status(400).json({ error: 'user_id and title required' });
  // Only a sensible *starting* state is creatable here -- 'completed'/
  // 'abandoned' only ever happen through the checkin/PATCH flows that
  // actually resolve something, never asserted at creation time. This is
  // what lets a client create a multi-step project's queued-but-not-yet-
  // active steps in one request each (AddPainPointScreen.js's project
  // path), instead of creating everything 'active' and then a separate
  // PATCH per step just to pause the ones not up yet.
  if (status && !['active', 'paused'].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'paused' at creation" });
  }

  // Verify user belongs to this app
  const { data: user } = await sb.from('users').select('id').eq('id', user_id).eq('app_id', req.app_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { data, error } = await sb
    .from('commitments')
    // identity_axis is distinct from identity_tag (a free-text motivational
    // label like "writer" -- R5_identity_reinforce) -- this is the Adaptive
    // Allocation Engine's 6-axis spectrum categorization instead, null for
    // things that deliberately don't map to one (medication -- see the
    // column comment in migration 016).
    .insert({ user_id, title, next_action, why, identity_tag, identity_axis: identity_axis || null,
              cadence: cadence || 'daily', window_start, window_end, deadline,
              priority_tier: priority_tier || 'normal', parent_commitment_id: parent_commitment_id || null,
              ...(status ? { status } : {}) })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  log(req.app_id, user_id, 'commitment.created', { commitment_id: data.id, title });
  res.status(201).json(data);
});

// GET /commitments/stalled-projects?user_id=&needs_review=true — soft nudge,
// not a hard gate. Without needs_review, every currently-stalled project is
// returned every time (AddPainPointScreen's "before adding something new"
// nudge — informational, fine to repeat). needs_review=true additionally
// suppresses anything already reviewed in the last 7 days (Today's periodic
// "still going, or pause it?" prompt — re-asking daily would make "still
// going" meaningless). See engine/projects.js.
router.get('/stalled-projects', async (req, res) => {
  const { user_id, needs_review } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const stalled = await getStalledProjects(user_id, { needsReviewOnly: needs_review === 'true' });
  res.json({ stalled });
});

// POST /commitments/:id/stale-review — the user's answer to that prompt.
// action: 'continue' just resets the re-ask clock; 'pause' also pauses the
// project and records why (reason), a real audit trail instead of a
// project just silently going quiet with no record of the decision.
router.post('/:id/stale-review', async (req, res) => {
  const { action, reason } = req.body;
  if (!['continue', 'pause'].includes(action)) return res.status(400).json({ error: "action must be 'continue' or 'pause'" });

  const { data: current } = await sb
    .from('commitments').select('id, user_id, users!inner(app_id)').eq('id', req.params.id).single();
  if (!current || current.users.app_id !== req.app_id) return res.status(404).json({ error: 'Not found' });

  const data = await reviewStaleProject(req.params.id, action, reason);
  log(req.app_id, current.user_id, 'project.stale_reviewed', { commitment_id: req.params.id, action, reason: reason || null });
  res.json(data);
});

// GET /commitments/suggestions — most commonly chosen titles across this app's
// users once there's enough data (see top_commitment_titles). Empty array (not
// an error) below the threshold, so the client silently falls back to statics.
router.get('/suggestions', async (req, res) => {
  const { data, error } = await sb.rpc('top_commitment_titles', { p_app_id: req.app_id });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /commitments/today?user_id= — "I feel lost, not just about the single
// next task but the whole day" (the /interventions/now money endpoint only
// ever shows one thing). Buckets today's active commitments by whether
// their window already closed, is open now, or hasn't opened yet, so the
// client can render a full-day view instead of just a single focused card.
router.get('/today', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: user } = await sb.from('users').select('id, timezone').eq('id', user_id).eq('app_id', req.app_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { data: allCommitments } = await sb.from('commitments').select('*').eq('user_id', user_id).eq('status', 'active');
  // Same "only the current smallest step shows" rule GET /interventions/now
  // already applies -- a parent with an open (active) child is never itself
  // surfaceable, here either. Without this, a decomposed project (e.g. a
  // multi-step checklist under one parent_commitment_id) would show both the
  // umbrella task AND its current step as separate completable rows, and
  // tapping Done on the umbrella would prematurely close the whole thing.
  const parentIdsWithOpenChildren = new Set(
    (allCommitments || []).filter(c => c.parent_commitment_id).map(c => c.parent_commitment_id)
  );
  const commitments = (allCommitments || []).filter(c => !parentIdsWithOpenChildren.has(c.id));
  const nowMin = nowMinutesInTz(user.timezone);

  const earlier_today = [], happening_now = [], coming_up = [], anytime = [];
  let doneCount = 0;

  for (const c of commitments || []) {
    const stats = await loadStats(c.id, c.cadence);
    if (stats.checkedInToday) doneCount++;

    const row = {
      commitment_id: c.id, title: c.title, window_start: c.window_start, window_end: c.window_end,
      priority_tier: c.priority_tier, done: stats.checkedInToday, identity_axis: c.identity_axis,
    };

    if (!c.window_start || !c.window_end) { anytime.push(row); continue; }
    if (isWithinWindow(nowMin, c.window_start, c.window_end)) { happening_now.push(row); continue; }

    const startMin = timeToMinutes(c.window_start);
    if (nowMin < startMin) coming_up.push({ ...row, minutes_until: startMin - nowMin });
    else earlier_today.push(row);
  }

  res.json({
    done_count: doneCount,
    total_count: (commitments || []).length,
    sections: { earlier_today, happening_now, coming_up, anytime },
  });
});

// GET /commitments?user_id=&status=
router.get('/', async (req, res) => {
  const { user_id, status } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  let q = sb.from('commitments').select('*').eq('user_id', user_id);
  if (status) q = q.eq('status', status);
  else q = q.eq('status', 'active');

  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /commitments/:id
// "I keep revising MVP1, no actual progress" -- a title/next_action edit
// (redefining what the thing IS, not just its schedule) counts as a
// revision. Past 5 revisions without reaching status=completed, the API
// itself refuses further scope edits unless force_ship=true, which instead
// locks in whatever scope currently exists as done -- the API enforces the
// ship, it doesn't just suggest it.
router.patch('/:id', async (req, res) => {
  const allowed = ['status', 'next_action', 'window_start', 'window_end', 'title', 'why', 'identity_tag', 'cadence', 'deadline', 'priority_tier'];
  const { force_ship } = req.body;
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const { data: current, error: findErr } = await sb
    .from('commitments').select('*, users!inner(app_id)').eq('id', req.params.id).single();
  if (findErr || !current || current.users.app_id !== req.app_id) return res.status(404).json({ error: 'Not found' });

  const isScopeEdit = (updates.title !== undefined && updates.title !== current.title) ||
                      (updates.next_action !== undefined && updates.next_action !== current.next_action);

  if (isScopeEdit && current.status !== 'completed') {
    if (force_ship) {
      updates.status = 'completed';
      updates.scope_locked_at = new Date().toISOString();
      delete updates.title;
      delete updates.next_action;
    } else {
      const nextCount = (current.revision_count || 0) + 1;
      if (nextCount > 5) {
        return res.status(409).json({
          error: 'This has been revised more than 5 times without shipping. Pass force_ship=true to lock in current scope as done, or stop revising it.',
          revision_count: current.revision_count,
        });
      }
      updates.revision_count = nextCount;
    }
  }

  const { data, error } = await sb
    .from('commitments')
    .update(updates)
    .eq('id', req.params.id)
    .select('*, users!inner(app_id)')
    .single();

  if (error || !data || data.users.app_id !== req.app_id)
    return res.status(404).json({ error: 'Not found' });

  // A decomposed step being Removed (status -> 'abandoned', Today's per-row
  // action) or otherwise closed out this way shouldn't leave the rest of a
  // multi-step project stuck with nothing active -- same advance POST
  // /checkins already does when a step is marked done, just reached from a
  // different door (skipping/removing a step instead of completing it).
  if (['completed', 'abandoned'].includes(updates.status) && current.parent_commitment_id) {
    await advanceSiblingChain(current.parent_commitment_id);
  }

  log(req.app_id, data.user_id, 'commitment.updated', { commitment_id: data.id, updates });
  res.json(data);
});

module.exports = router;
