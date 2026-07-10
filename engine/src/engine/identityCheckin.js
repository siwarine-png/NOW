/**
 * Adaptive Allocation Engine's identity-spectrum data collection (see
 * migration 015's comment for why this exists and where the 5/day figure
 * comes from). Deterministic, no ML -- same founding principle as every
 * other engine module here.
 *
 * Burst-then-sparse-forever, not a 7-day window that stops: an intensive
 * first week (5/day) establishes a baseline fast, then sampling drops to a
 * much lower "maintenance" rate (a few times/week) and keeps running
 * indefinitely rather than ending. This is a recognized ESM design pattern
 * (intensive burst for calibration, sparse ongoing sampling for
 * longitudinal tracking), not an arbitrary choice -- it's what lets
 * current_hours_per_week stay current via a rolling lookback instead of
 * freezing at whatever onboarding week happened to look like, with no
 * "remeasure" button or decision ever surfaced to the user.
 *
 * Lazy-requires scheduler.js's sendCheckinPush inside the tick function
 * rather than at module top level, same reason nudgeEngine.js already does
 * this: scheduler.js will require this module to wire the tick into cron,
 * so a top-level require here would deadlock on load.
 */
const sb = require('../db/client');

const INTENSIVE_DAYS = 7;
const INTENSIVE_DAILY_PROMPTS = 5; // tuned against ESM research, see migration 015
const MAINTENANCE_WEEKLY_PROMPTS = 3; // ongoing rate once the intensive week ends
const ROLLING_WINDOW_DAYS = 28; // aggregation lookback (used once current_hours_per_week is computed)

const AXES = ['foundation', 'relationships', 'achievement', 'finance', 'contribution', 'recreation'];

function timeToMinutes(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

// Minutes from wake to sleep, handling the (unusual but real, e.g. night
// shift) case where sleep_time's clock value is earlier than wake_time's.
function wakingMinutes(wakeTime, sleepTime) {
  const w = timeToMinutes(wakeTime), s = timeToMinutes(sleepTime);
  return s > w ? s - w : (1440 - w) + s;
}

function isWithinWakingHours(nowMin, wakeTime, sleepTime) {
  const w = timeToMinutes(wakeTime), s = timeToMinutes(sleepTime);
  return s > w ? (nowMin >= w && nowMin < s) : (nowMin >= w || nowMin < s);
}

function daysSinceStart(user, now = new Date()) {
  if (!user.identity_checkin_started_at) return null;
  return (now - new Date(user.identity_checkin_started_at)) / 86_400_000;
}

// No end date -- sampling is "on" from the moment it starts, forever, just
// at a different rate depending on phase. Kept as a named check (rather
// than inlining `!= null`) since callers care about the concept, not the
// implementation of "started."
function isSampling(user, now = new Date()) {
  const days = daysSinceStart(user, now);
  return days !== null && days >= 0;
}

function currentPhase(user, now = new Date()) {
  const days = daysSinceStart(user, now);
  if (days === null) return null;
  return days < INTENSIVE_DAYS ? 'intensive' : 'maintenance';
}

// Spacing-based due check rather than fixed clock slots -- simpler to get
// right, and naturally spreads prompts across whatever the user's own
// waking window actually is (reusing wake_time/sleep_time, the same
// personalized schedule the Identity tab already collects). Maintenance
// phase spreads MAINTENANCE_WEEKLY_PROMPTS across a full 7-day week's worth
// of waking minutes rather than a single day's, since a few-times-a-week
// rate doesn't divide evenly into one day.
function isDue({ user, nowMin, lastCheckinAt, now = new Date() }) {
  if (!isSampling(user, now)) return false;
  if (!isWithinWakingHours(nowMin, user.wake_time, user.sleep_time)) return false;

  const wakingMin = wakingMinutes(user.wake_time, user.sleep_time);
  const spacingMinutes = currentPhase(user, now) === 'intensive'
    ? wakingMin / INTENSIVE_DAILY_PROMPTS
    : (wakingMin * 7) / MAINTENANCE_WEEKLY_PROMPTS;

  if (!lastCheckinAt) return true;
  return (now - new Date(lastCheckinAt)) / 60_000 >= spacingMinutes;
}

async function runIdentityCheckinTick() {
  const { nowMinutesInTz } = require('./rules');
  const { sendCheckinPush } = require('./scheduler');

  const { data: users } = await sb
    .from('users')
    .select('id, wake_time, sleep_time, timezone, identity_checkin_started_at, push_token, web_push_subscription')
    .not('identity_checkin_started_at', 'is', null)
    .or('push_token.not.is.null,web_push_subscription.not.is.null');
  if (!users?.length) return;

  const now = new Date();
  for (const user of users) {
    if (!isSampling(user, now)) continue;
    const nowMin = nowMinutesInTz(user.timezone);

    const { data: last } = await sb
      .from('identity_checkins')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!isDue({ user, nowMin, lastCheckinAt: last?.created_at, now })) continue;

    await sendCheckinPush(user.id, user, 'Quick check-in', 'What are you doing right now?');
  }
}

module.exports = {
  runIdentityCheckinTick, isSampling, isDue, currentPhase, wakingMinutes, AXES,
  INTENSIVE_DAYS, INTENSIVE_DAILY_PROMPTS, MAINTENANCE_WEEKLY_PROMPTS, ROLLING_WINDOW_DAYS,
};
