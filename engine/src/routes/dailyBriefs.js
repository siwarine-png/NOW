/**
 * Mounted under /v2 -- Morning Brief / Evening Debrief (migration 029). One
 * row per user per calendar day in the user's own timezone (rules.js's
 * todayKeyInTz), same "what day is it" logic due_date comparisons already
 * use, so a check near midnight doesn't land on the wrong day.
 */
const { Router } = require('express');
const sb = require('../db/client');
const { todayKeyInTz } = require('../engine/rules');

const router = Router();

function dateKeyInTz(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(date);
}

async function loadUser(user_id, app_id) {
  const { data: user } = await sb.from('users').select('id, timezone').eq('id', user_id).eq('app_id', app_id).single();
  return user;
}

// GET /v2/daily-briefs/today?user_id= -- today's row, or null if neither
// prompt has been answered yet today. Lets the client decide whether
// Morning Brief / Evening Debrief still need to show without re-deriving
// the day boundary itself.
router.get('/today', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const user = await loadUser(user_id, req.app_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const briefDate = todayKeyInTz(user.timezone);
  const { data } = await sb.from('daily_briefs').select('*').eq('user_id', user_id).eq('brief_date', briefDate).maybeSingle();
  res.json({ brief: data || null });
});

// GET /v2/daily-briefs/review?user_id= -- Evening Debrief's "what did you
// actually do" half: today's done checkins (title + duration_seconds, when
// a Start/Finish pair recorded one -- see commitments.js PATCH's
// active_since) alongside this morning's planned_focus, for a real
// planned-vs-actual comparison instead of just the shipped y/n question.
router.get('/review', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const user = await loadUser(user_id, req.app_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const briefDate = todayKeyInTz(user.timezone);

  const { data: commitments } = await sb.from('commitments').select('id, title').eq('user_id', user_id);
  const titleById = new Map((commitments || []).map(c => [c.id, c.title]));
  const commitmentIds = [...titleById.keys()];

  let completed = [];
  if (commitmentIds.length) {
    // Wide net (recent, not literally unbounded) then filtered by the
    // actual tz-aware day key -- a plain UTC created_at range would
    // misfire near midnight for anyone west of UTC, same reasoning as
    // isDueByToday.
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { data: checkins, error } = await sb
      .from('checkins')
      .select('commitment_id, occurred_at, context')
      .in('commitment_id', commitmentIds)
      .eq('result', 'done')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    completed = (checkins || [])
      .filter(c => dateKeyInTz(new Date(c.occurred_at), user.timezone) === briefDate)
      .map(c => ({
        title: titleById.get(c.commitment_id) || 'Untitled',
        done_at: c.occurred_at,
        duration_seconds: c.context?.duration_seconds ?? null,
      }));
  }

  const { data: brief } = await sb.from('daily_briefs').select('planned_focus').eq('user_id', user_id).eq('brief_date', briefDate).maybeSingle();
  res.json({ planned_focus: brief?.planned_focus || null, completed });
});

// POST /v2/daily-briefs/morning -- planned_focus is free text, the user's
// own framing of today's one thing (deliberately separate from the risk
// scorer's own DO-THIS-NOW pick -- see migration 029's header comment).
router.post('/morning', async (req, res) => {
  const { user_id, planned_focus } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const user = await loadUser(user_id, req.app_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const briefDate = todayKeyInTz(user.timezone);
  const { data, error } = await sb
    .from('daily_briefs')
    .upsert(
      { user_id, brief_date: briefDate, planned_focus: planned_focus || null, morning_completed_at: new Date().toISOString() },
      { onConflict: 'user_id,brief_date' }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /v2/daily-briefs/evening
router.post('/evening', async (req, res) => {
  const { user_id, shipped_something, shipped_note } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const user = await loadUser(user_id, req.app_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const briefDate = todayKeyInTz(user.timezone);
  const { data, error } = await sb
    .from('daily_briefs')
    .upsert(
      {
        user_id, brief_date: briefDate, shipped_something: !!shipped_something,
        shipped_note: shipped_note || null, evening_completed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,brief_date' }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

module.exports = router;
