/**
 * Load per-commitment stats from Supabase needed by the risk scorer and rules engine.
 * Returns { missedYesterday, completionRate14d, streak, daysSinceLastCheckin,
 *           lastResultToday, lastCheckinAt }
 *
 * checkedInToday's name is a slight misnomer for cadence='monthly': it means
 * "already satisfied for the current cadence period" -- a day for
 * once/daily (unchanged), the calendar month-to-date for monthly. Kept the
 * same field name rather than renaming it everywhere, since every caller
 * (interventions.js, commitments.js's /today, scheduler.js's push ticks)
 * already just gates on "is this already done for now," which is exactly
 * what it still means, just over a longer period for a monthly task. Before
 * this, cadence='monthly' didn't exist and 'daily' was the only recurring
 * option, so a genuinely monthly task (e.g. "send provision budget to
 * sister") had no correct setting and nagged every day instead of once a month.
 */
const sb = require('../db/client');

async function loadStats(commitmentId, cadence) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate()-1);
  const yesterdayEnd = new Date(todayStart);
  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(now.getDate()-14);

  // Monthly cadence's "period" is month-to-date, not today -- and that can
  // reach further back than the usual 14-day lookback (e.g. day 20 of a
  // 30-day month), so the fetch window has to extend to cover it or an
  // earlier-in-the-month checkin would be invisible here.
  const periodStart = cadence === 'monthly' ? new Date(now.getFullYear(), now.getMonth(), 1) : todayStart;
  const fetchSince = periodStart < fourteenDaysAgo ? periodStart : fourteenDaysAgo;

  const { data: checkins } = await sb
    .from('checkins')
    .select('result, occurred_at')
    .eq('commitment_id', commitmentId)
    .gte('occurred_at', fetchSince.toISOString())
    .order('occurred_at', { ascending: false });

  // Snoozes are deferrals, not outcomes — excluded from every "did something"
  // calculation below (streak, completion rate, checkedInToday). They're still
  // written to checkins for the full event-capture record, just not counted here.
  const rows = (checkins || []).filter(r => r.result !== 'snoozed');
  // completionRate14d/streak are informational risk signals meant to stay
  // scoped to the real last-14-days window regardless of cadence, even when
  // the fetch above reached back further for a monthly period.
  const last14 = rows.filter(r => new Date(r.occurred_at) >= fourteenDaysAgo);

  const periodRows = rows.filter(r => new Date(r.occurred_at) >= periodStart);
  const yesterdayRows = last14.filter(r => {
    const d = new Date(r.occurred_at);
    return d >= yesterdayStart && d < yesterdayEnd;
  });

  const checkedInToday = periodRows.length > 0;
  const lastResultToday = periodRows[0]?.result ?? null;
  const missedYesterday = yesterdayRows.length === 0 ||
    yesterdayRows.every(r => r.result === 'skipped');

  const done14 = last14.filter(r => r.result === 'done' || r.result === 'partial').length;
  const completionRate14d = last14.length > 0 ? done14 / last14.length : 1;

  // Streak: consecutive days ending today/yesterday with done/partial
  const dayMap = {};
  last14.forEach(r => {
    const d = new Date(r.occurred_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!dayMap[key]) dayMap[key] = r.result;
    else if (r.result === 'done') dayMap[key] = r.result;
  });
  let streak = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dayMap[key] === 'done' || dayMap[key] === 'partial') streak++;
    else break;
  }

  const lastCheckinAt = rows[0]?.occurred_at ?? null;
  const daysSinceLastCheckin = lastCheckinAt
    ? Math.floor((now - new Date(lastCheckinAt)) / 86_400_000)
    : null;

  return {
    missedYesterday,
    completionRate14d,
    streak,
    checkedInToday,
    lastResultToday,
    daysSinceLastCheckin,
    lastCheckinAt,
  };
}

module.exports = { loadStats };
