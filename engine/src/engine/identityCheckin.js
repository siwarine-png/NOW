/**
 * Adaptive Allocation Engine's identity-spectrum data collection (see
 * migration 015's comment for why this exists and where the 5/day figure
 * comes from). Deterministic, no ML -- same founding principle as every
 * other engine module here.
 *
 * Lazy-requires scheduler.js's sendCheckinPush inside the tick function
 * rather than at module top level, same reason nudgeEngine.js already does
 * this: scheduler.js will require this module to wire the tick into cron,
 * so a top-level require here would deadlock on load.
 */
const sb = require('../db/client');

const WINDOW_DAYS = 7;
const DAILY_PROMPTS = 5; // tuned against ESM research, see migration 015

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

function isWithinSamplingWindow(user, now = new Date()) {
  if (!user.identity_checkin_started_at) return false;
  const days = (now - new Date(user.identity_checkin_started_at)) / 86_400_000;
  return days >= 0 && days < WINDOW_DAYS;
}

// Spacing-based due check rather than fixed clock slots -- simpler to get
// right, and naturally spreads ~DAILY_PROMPTS prompts across whatever the
// user's own waking window actually is (reusing wake_time/sleep_time, the
// same personalized schedule the Identity tab already collects).
function isDue({ user, nowMin, lastCheckinAt, now = new Date() }) {
  if (!isWithinSamplingWindow(user, now)) return false;
  if (!isWithinWakingHours(nowMin, user.wake_time, user.sleep_time)) return false;
  const spacingMinutes = wakingMinutes(user.wake_time, user.sleep_time) / DAILY_PROMPTS;
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
    if (!isWithinSamplingWindow(user, now)) continue;
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

module.exports = { runIdentityCheckinTick, isWithinSamplingWindow, isDue, wakingMinutes, AXES, WINDOW_DAYS, DAILY_PROMPTS };
