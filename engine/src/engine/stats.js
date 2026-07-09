/**
 * Load per-commitment stats from Supabase needed by the risk scorer and rules engine.
 * Returns { missedYesterday, completionRate14d, streak, daysSinceLastCheckin,
 *           lastResultToday, lastCheckinAt }
 */
const sb = require('../db/client');

async function loadStats(commitmentId) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate()-1);
  const yesterdayEnd = new Date(todayStart);
  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(now.getDate()-14);

  const { data: checkins } = await sb
    .from('checkins')
    .select('result, occurred_at')
    .eq('commitment_id', commitmentId)
    .gte('occurred_at', fourteenDaysAgo.toISOString())
    .order('occurred_at', { ascending: false });

  // Snoozes are deferrals, not outcomes — excluded from every "did something"
  // calculation below (streak, completion rate, checkedInToday). They're still
  // written to checkins for the full event-capture record, just not counted here.
  const rows = (checkins || []).filter(r => r.result !== 'snoozed');

  const todayRows = rows.filter(r => new Date(r.occurred_at) >= todayStart);
  const yesterdayRows = rows.filter(r => {
    const d = new Date(r.occurred_at);
    return d >= yesterdayStart && d < yesterdayEnd;
  });

  const checkedInToday = todayRows.length > 0;
  const lastResultToday = todayRows[0]?.result ?? null;
  const missedYesterday = yesterdayRows.length === 0 ||
    yesterdayRows.every(r => r.result === 'skipped');

  const done14 = rows.filter(r => r.result === 'done' || r.result === 'partial').length;
  const completionRate14d = rows.length > 0 ? done14 / rows.length : 1;

  // Streak: consecutive days ending today/yesterday with done/partial
  const dayMap = {};
  rows.forEach(r => {
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
