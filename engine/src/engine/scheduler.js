/**
 * Scheduler — runs every 5 minutes.
 * Finds commitments whose window is about to close (< 90 min) and no check-in today,
 * evaluates rules, and fires webhooks to registered app webhook_urls.
 */
const cron = require('node-cron');
const webpush = require('web-push');
const sb = require('../db/client');
const { loadStats } = require('./stats');
const { scoreRisk } = require('./risk');
const { evaluate, isWithinWindow, nowMinutesInTz } = require('./rules');
const { pickDomainIntervention } = require('./domainRules');
const { deliver } = require('./webhooks');
const { log } = require('./events');
// Lazy-required where used (not here): nudgeEngine.js requires this module
// for sendCheckinPush, so a top-level require here would deadlock on load.

async function runSchedulerTick() {
  const { data: apps } = await sb.from('apps').select('id,webhook_url,webhook_secret').not('webhook_url', 'is', null);
  if (!apps?.length) return;

  for (const app of apps) {
    const { data: users } = await sb.from('users').select('id,timezone,quiet_start,quiet_end').eq('app_id', app.id);
    if (!users?.length) continue;

    for (const user of users) {
      const nowMin = nowMinutesInTz(user.timezone);
      if (isQuietHours(user, nowMin)) continue;

      const { data: commitments } = await sb
        .from('commitments').select('*').eq('user_id', user.id).eq('status', 'active');
      if (!commitments?.length) continue;

      for (const c of commitments) {
        if (c.snoozed_until && new Date(c.snoozed_until) > new Date()) continue;
        // Same window gate as GET /interventions/now — a commitment outside its
        // own "only nudge me between X-Y" window shouldn't fire proactively either.
        if (!isWithinWindow(nowMin, c.window_start, c.window_end)) continue;
        const stats = await loadStats(c.id);
        if (stats.checkedInToday) continue;

        const { score } = scoreRisk(c, stats);
        const ctx = { commitment: c, stats, energy: null, checkedInToday: false, nowMin };
        const result = evaluate(ctx);
        if (!result) continue;

        // Only fire webhook if risk > 0.5 (worth interrupting)
        if (score < 0.5) continue;

        const { data: intervention } = await sb
          .from('interventions')
          .insert({ commitment_id: c.id, rule_id: result.rule_id, payload: result.payload })
          .select().single();

        await deliver(app.webhook_url, app.webhook_secret, 'intervention.suggested', {
          user_id: user.id,
          commitment_id: c.id,
          intervention_id: intervention?.id,
          rule_id: result.rule_id,
          message: result.payload.message,
          action: result.payload.action,
          risk: Math.round(score * 100) / 100,
        });

        log(app.id, user.id, 'webhook.sent', { intervention_id: intervention?.id, rule_id: result.rule_id });
      }
    }
  }
}

function isQuietHours(user, nowMin) {
  if (!user.quiet_start || !user.quiet_end) return false;
  const [qsh, qsm] = user.quiet_start.split(':').map(Number);
  const [qeh, qem] = user.quiet_end.split(':').map(Number);
  const qs = qsh * 60 + qsm, qe = qeh * 60 + qem;
  return qs < qe ? (nowMin >= qs && nowMin < qe) : (nowMin >= qs || nowMin < qe);
}

// Commitment-mode fallback for the daily push, so users with no domain data
// still get a real, concrete thing in the notification body instead of the
// generic placeholder -- picks the single highest-risk active, in-window,
// not-yet-checked-in commitment's own next_action/title. Deliberately
// doesn't run the full R1-R8 rule engine or write an intervention record:
// this is a best-effort richer preview for a lock-screen notification, not
// the authoritative pick GET /interventions/now still makes once the app is
// actually opened.
async function pickCommitmentPushBody(userId, nowMin, now) {
  const { data: commitments } = await sb
    .from('commitments').select('*').eq('user_id', userId).eq('status', 'active');
  const candidates = (commitments || []).filter(c =>
    isWithinWindow(nowMin, c.window_start, c.window_end) &&
    (!c.snoozed_until || new Date(c.snoozed_until) <= now)
  );
  if (!candidates.length) return null;

  const scored = await Promise.all(candidates.map(async c => {
    const stats = await loadStats(c.id);
    if (stats.checkedInToday) return null;
    const { score } = scoreRisk(c, stats);
    return { c, score };
  }));
  const best = scored.filter(Boolean).sort((a, b) => b.score - a.score)[0];
  return best ? (best.c.next_action || best.c.title) : null;
}

// Daily check-in reminder — the thing onboarding actually promises ("we'll
// check in with you once a day around 6 PM"). Only users who registered a
// push_token (opted in client-side) are considered; checkin_time is the
// user's own explicit choice, so it isn't gated by quiet hours the way
// R1-R8's proactive webhook nudges are.
async function runPushReminderTick() {
  const { data: users } = await sb
    .from('users')
    .select('id, push_token, web_push_subscription, checkin_time, timezone, last_push_sent_at')
    .or('push_token.not.is.null,web_push_subscription.not.is.null');
  if (!users?.length) return;

  // A user mid app-open anchor test is already being fired at by
  // nudgeEngine's own tick (at whichever candidate anchor is active) --
  // firing this fixed checkin_time push in parallel would double-nudge them
  // every day until the test locks in.
  const { data: activeTests } = await sb
    .from('nudge_tests').select('user_id').eq('behavior', 'app_open').eq('status', 'active');
  const inActiveTest = new Set((activeTests || []).map(t => t.user_id));

  const now = new Date();
  for (const user of users) {
    if (inActiveTest.has(user.id)) continue;
    const nowMin = nowMinutesInTz(user.timezone);
    const [ch, cm] = (user.checkin_time || '18:00').split(':').map(Number);
    const checkinMin = ch * 60 + cm;
    // Fire once, within the 5-minute window starting at checkin_time.
    if (nowMin < checkinMin || nowMin >= checkinMin + 5) continue;
    if (user.last_push_sent_at && dateKeyInTz(new Date(user.last_push_sent_at), user.timezone) === dateKeyInTz(now, user.timezone)) continue;

    let body = "What's the smallest useful thing right now?";
    try {
      const domainResult = await pickDomainIntervention(sb, user.id);
      if (domainResult?.all_done) body = "You're all caught up today. No pressure — just checking in.";
      else if (domainResult?.message) body = domainResult.message;
      else body = await pickCommitmentPushBody(user.id, nowMin, now) || body;
    } catch (e) {
      console.error('[push] domain lookup failed for user', user.id, e.message);
    }

    await sendCheckinPush(user.id, user, 'Check-in time', body);
  }
}

// Shared by the scheduled tick, nudgeEngine's fireDueTests, and the on-demand
// admin test-push route, so all three paths record delivery result (and
// dead-token/dead-subscription cleanup) identically. `target` is a user row
// with push_token and/or web_push_subscription -- web is tried first since a
// user who set up web push is using the web client, not the native app.
async function sendCheckinPush(userId, target, title, body) {
  const result = target.web_push_subscription
    ? await sendWebPush(target.web_push_subscription, title, body)
    : await sendExpoPush(target.push_token, title, body);

  const update = { last_push_sent_at: new Date().toISOString(), last_push_error: result.ok ? null : result.error };
  // A dead token/subscription will fail forever silently otherwise --
  // clearing it makes "reminder stopped working" visible as the field going
  // null instead of an invisible no-op every day.
  if (result.deviceNotRegistered) {
    if (target.web_push_subscription) update.web_push_subscription = null;
    else update.push_token = null;
  }
  await sb.from('users').update(update).eq('id', userId);
  return result;
}

// Same delivery mechanism the older BECOME prototype already proved out
// (VAPID + web-push), rather than the less-certain path of trying to make
// Expo's own push token system work for browsers. Boot-time key setup can
// throw on a malformed key; capture it instead of crashing tick startup.
let vapidError = null;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:noreply@example.com',
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY,
    );
  } catch (e) { vapidError = e.message; }
}

async function sendWebPush(subscription, title, body) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { ok: false, error: 'VAPID keys not configured on the server' };
  }
  if (vapidError) return { ok: false, error: `VAPID setup failed: ${vapidError}` };
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
    return { ok: true };
  } catch (e) {
    console.error('[push] web push send failed', { statusCode: e.statusCode, error: e.message });
    return { ok: false, error: e.message, deviceNotRegistered: e.statusCode === 404 || e.statusCode === 410 };
  }
}

function dateKeyInTz(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Expo's send endpoint returns 200 even when the push itself was rejected --
// per-token success/failure is only visible in the response body's ticket,
// which the previous version never read. That let every rejected push
// (bad/expired token, revoked credentials, ...) disappear with zero trace.
async function sendExpoPush(token, title, body) {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify([{ to: token, title, body, sound: 'default' }]),
    });
    const json = await res.json().catch(() => null);
    const ticket = json?.data?.[0];
    if (!res.ok || ticket?.status === 'error') {
      const message = ticket?.message || `HTTP ${res.status}`;
      console.error('[push] delivery rejected', { token, message, details: ticket?.details });
      return { ok: false, error: message, deviceNotRegistered: ticket?.details?.error === 'DeviceNotRegistered' };
    }
    return { ok: true };
  } catch (e) {
    console.error('[push] send failed', e.message);
    return { ok: false, error: e.message };
  }
}

function startScheduler() {
  cron.schedule('*/5 * * * *', () => {
    runSchedulerTick().catch(e => console.error('[scheduler] tick error', e.message));
    runPushReminderTick().catch(e => console.error('[scheduler] push tick error', e.message));
    require('./nudgeEngine').runNudgeTestsTick(sb).catch(e => console.error('[scheduler] nudge tick error', e.message));
    require('./identityCheckin').runIdentityCheckinTick().catch(e => console.error('[scheduler] identity checkin tick error', e.message));
  });
  console.log('[scheduler] started — 5-min tick');
}

module.exports = { startScheduler, sendCheckinPush, runSchedulerTick, runPushReminderTick };
