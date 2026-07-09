const { Router } = require('express');
const sb = require('../db/client');
const { isWithinWindow } = require('../engine/rules');

const router = Router();

function dateKeyInTz(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function minutesOfDayInTz(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC', hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t).value;
  return (Number(get('hour')) % 24) * 60 + Number(get('minute'));
}

// GET /patterns/adherence?user_id= — "I don't follow my schedule as planned"
// made visible as data: per active commitment, did the last 7 days' checkins
// actually land inside their planned window, land outside it, or not happen
// at all -- rather than only surfacing the gap reactively in the moment via
// R1-R3's nudges.
router.get('/adherence', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: user } = await sb.from('users').select('id, timezone').eq('id', user_id).eq('app_id', req.app_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { data: commitments } = await sb.from('commitments').select('*').eq('user_id', user_id).eq('status', 'active');
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const result = [];
  for (const c of commitments || []) {
    const { data: checkins } = await sb
      .from('checkins').select('occurred_at, result').eq('commitment_id', c.id)
      .in('result', ['done', 'partial']).gte('occurred_at', since).order('occurred_at');

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86_400_000);
      const dayKey = dateKeyInTz(day, user.timezone);
      const match = (checkins || []).find(ch => dateKeyInTz(new Date(ch.occurred_at), user.timezone) === dayKey);

      let withinWindow = null;
      if (match && c.window_start && c.window_end) {
        withinWindow = isWithinWindow(minutesOfDayInTz(new Date(match.occurred_at), user.timezone), c.window_start, c.window_end);
      }
      days.push({ date: dayKey, occurred_at: match?.occurred_at || null, within_window: match ? withinWindow : null });
    }

    const onPlan = days.filter(d => d.occurred_at && d.within_window !== false).length;
    result.push({
      commitment_id: c.id, title: c.title, window_start: c.window_start, window_end: c.window_end,
      last_7d: days, adherence_rate_7d: Math.round((onPlan / days.length) * 100) / 100,
    });
  }

  res.json({ commitments: result });
});

// GET /patterns?user_id=
// Aggregates: best hour, completion by weekday, streaks, most effective framing
router.get('/', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: user } = await sb.from('users').select('id,timezone').eq('id', user_id).eq('app_id', req.app_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const since = new Date(Date.now() - 60 * 86_400_000).toISOString(); // 60-day window

  const { data: checkins } = await sb
    .from('checkins')
    .select('commitment_id, result, occurred_at')
    .in('commitment_id', (await sb.from('commitments').select('id').eq('user_id', user_id)).data?.map(c => c.id) || [])
    .gte('occurred_at', since)
    .order('occurred_at');

  const { data: interventions } = await sb
    .from('interventions')
    .select('payload->framing, outcome')
    .in('commitment_id', (await sb.from('commitments').select('id').eq('user_id', user_id)).data?.map(c => c.id) || [])
    .not('outcome', 'is', null);

  const rows = checkins || [];

  // Best hour of day (by completion rate)
  const hourBuckets = {};
  rows.forEach(r => {
    const h = new Date(r.occurred_at).getHours();
    hourBuckets[h] = hourBuckets[h] || { done: 0, total: 0 };
    hourBuckets[h].total++;
    if (r.result === 'done' || r.result === 'partial') hourBuckets[h].done++;
  });
  const bestHour = Object.keys(hourBuckets).reduce((best, h) => {
    const rate = hourBuckets[h].done / hourBuckets[h].total;
    const bestRate = hourBuckets[best]?.done / hourBuckets[best]?.total ?? 0;
    return rate > bestRate ? h : best;
  }, null);

  // Completion rate by weekday (0=Sun … 6=Sat)
  const weekdayBuckets = Array.from({ length: 7 }, () => ({ done: 0, total: 0 }));
  rows.forEach(r => {
    const wd = new Date(r.occurred_at).getDay();
    weekdayBuckets[wd].total++;
    if (r.result === 'done' || r.result === 'partial') weekdayBuckets[wd].done++;
  });
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const completion_by_weekday = weekdayBuckets.map((b, i) => ({
    day: weekdays[i],
    rate: b.total > 0 ? Math.round((b.done / b.total) * 100) / 100 : null,
    total: b.total,
  }));

  // Most effective framing (by acted rate)
  const framingMap = {};
  (interventions || []).forEach(iv => {
    const f = iv.framing;
    if (!f) return;
    framingMap[f] = framingMap[f] || { acted: 0, total: 0 };
    framingMap[f].total++;
    if (iv.outcome === 'acted') framingMap[f].acted++;
  });
  const framing_effectiveness = Object.keys(framingMap).map(f => ({
    framing: f,
    acted_rate: Math.round((framingMap[f].acted / framingMap[f].total) * 100) / 100,
    sample_size: framingMap[f].total,
  })).sort((a, b) => b.acted_rate - a.acted_rate);

  res.json({
    best_hour: bestHour !== null ? { hour: Number(bestHour), label: `${bestHour}:00` } : null,
    completion_by_weekday,
    framing_effectiveness,
    total_checkins_60d: rows.length,
    done_rate_60d: rows.length > 0
      ? Math.round(rows.filter(r => r.result === 'done' || r.result === 'partial').length / rows.length * 100) / 100
      : null,
  });
});

module.exports = router;
