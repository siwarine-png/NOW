/**
 * Turns raw identity_checkins samples into current_hours_per_week per axis
 * -- the "reality" half of the Adaptive Allocation Engine's gap calculation
 * (desired vs. current, see engine-specs/adaptive-allocation-engine-v1.1.md
 * §4). Point-sample proportions over a rolling window stand in for actual
 * time-use proportions (standard ESM time-budget estimation), scaled
 * against the user's own waking hours per week rather than a flat 168 --
 * sleep isn't allocatable time to begin with.
 *
 * desired_hours_per_week is a rough, real computation from the one signal
 * onboarding actually collects for this: identity_priorities (1-5 relative
 * priority per axis, tap-only). It can't be more than rough -- the real
 * Phase 1/2 baseline+flex allocation from the spec is a separate, much
 * bigger piece of work -- but rough-and-real beats the flat mock constant
 * this used to be, identical for every user regardless of what they
 * actually said mattered to them. The flexible pool (waking hours minus
 * whatever fixed time is known so far) splits proportional to priority
 * weight, floored per axis at AXIS_FLOORS so a low-priority axis never
 * reads as "zero hours desired" regardless of how it's weighted.
 *
 * Samples with is_fixed = true count toward fixed_hours_per_week --
 * non-negotiable time future allocation logic must not suggest moving.
 * is_fixed = null (the common case for a fast manual chip tap with no
 * matching registered commitment) is folded into flexible rather than
 * asserted either way, since absence of a registered commitment isn't
 * proof the time was actually free.
 *
 * logged_hours_per_week is a second, separate signal: real elapsed time
 * actually checked in done, over the same rolling window, from TWO sources
 * -- axis-tagged commitments (migration 016, "I'm Stuck -> Something new
 * to track") AND domain-mode outcome_equivalents (Engine v8's starter task
 * library, "95% of usage" per NowScreen -- without this half, completing
 * literally any of the small suggested tasks logged nothing at all).
 * Deliberately NOT merged into current_hours_per_week's point-sample
 * proportion -- that estimate's math assumes samples land at effectively
 * random moments, and a burst of completed-task events doesn't share that
 * property (finishing 3 Finance tasks in one sitting isn't 3x the
 * point-sample evidence a random ping would represent, and could easily
 * double-count a moment a sample happened to also catch). Reported
 * alongside as ground truth for whatever's actually been logged, not a
 * replacement for the sampling estimate covering everything else.
 *
 * Duration comes from, in order: the commitment's own window (window_end
 * minus window_start); the equivalent's timer_seconds when it's a literal
 * fixed-duration action (e.g. "breathe for 1 minute"); otherwise a rough
 * per-effort-tier default (DEFAULT_TIER_MINUTES) or, for a windowless
 * commitment (priority_tier 'critical'/"Right now", see
 * AddPainPointScreen.js's submitUrgent), a single flat default -- there's
 * no scheduled duration to read for either of those, so this is explicitly
 * an estimate, not a measurement.
 */
const sb = require('../db/client');
const { AXES, ROLLING_WINDOW_DAYS, wakingMinutes } = require('./identityCheckin');

const DEFAULT_TIER_MINUTES = { 1: 2, 2: 5, 3: 15, 4: 45 };
const DEFAULT_WINDOWLESS_MINUTES = 15;
const MIN_CONFIDENT_SAMPLES = 10; // same "enough data" threshold interventions.js's personalization uses
const DEFAULT_PRIORITY = 3; // mid-scale, matches OnboardingScreen.js's DEFAULT_IDENTITY_PRIORITIES
const AXIS_FLOORS = { relationships: 3, finance: 2 };

// priorities: {axis: 1-5} from users.identity_priorities (onboarding's tap-
// only priority step). fixedHoursByAxis: this call's own per-axis
// fixed_hours_per_week, nulls treated as 0 -- early on (day 1, or before
// any "I'm busy"/fixed commitment exists) that's everything, which just
// means the flexible pool starts as the full waking week until real fixed
// time is known, rather than blocking this computation on data that isn't
// there yet.
function computeDesiredHoursPerWeek(priorities, wakingHoursPerWeek, fixedHoursByAxis) {
  const totalFixed = AXES.reduce((sum, axis) => sum + (fixedHoursByAxis[axis] || 0), 0);
  const flexiblePool = Math.max(0, wakingHoursPerWeek - totalFixed);

  const weights = AXES.map(axis => priorities?.[axis] ?? DEFAULT_PRIORITY);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const desired = {};
  AXES.forEach((axis, i) => {
    const proportional = (weights[i] / totalWeight) * flexiblePool;
    desired[axis] = Math.round(Math.max(proportional, AXIS_FLOORS[axis] || 0) * 10) / 10;
  });
  return desired;
}

function windowMinutes(windowStart, windowEnd) {
  const [sh, sm] = windowStart.split(':').map(Number);
  const [eh, em] = windowEnd.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 1440; // overnight window
  return diff;
}

async function commitmentMinutesByAxis(userId, windowStart) {
  const { data: tagged } = await sb
    .from('commitments')
    .select('id, identity_axis, window_start, window_end')
    .eq('user_id', userId)
    .not('identity_axis', 'is', null);
  if (!tagged?.length) return {};

  const byId = new Map(tagged.map(c => [c.id, c]));
  const { data: doneCheckins } = await sb
    .from('checkins')
    .select('commitment_id, occurred_at')
    .in('commitment_id', [...byId.keys()])
    .eq('result', 'done')
    .gte('occurred_at', windowStart.toISOString());

  const minutesByAxis = {};
  for (const chk of doneCheckins || []) {
    const c = byId.get(chk.commitment_id);
    if (!c) continue;
    const minutes = (c.window_start && c.window_end)
      ? windowMinutes(c.window_start, c.window_end)
      : DEFAULT_WINDOWLESS_MINUTES;
    minutesByAxis[c.identity_axis] = (minutesByAxis[c.identity_axis] || 0) + minutes;
  }
  return minutesByAxis;
}

async function equivalentMinutesByAxis(userId, windowStart) {
  const { data: equivalents } = await sb
    .from('outcome_equivalents')
    .select('id, domain, effort_tier, timer_seconds')
    .eq('user_id', userId);
  if (!equivalents?.length) return {};

  const byId = new Map(equivalents.map(e => [e.id, e]));
  const { data: doneCheckins } = await sb
    .from('checkins')
    .select('equivalent_id, occurred_at')
    .in('equivalent_id', [...byId.keys()])
    .eq('result', 'done')
    .gte('occurred_at', windowStart.toISOString());

  const minutesByAxis = {};
  for (const chk of doneCheckins || []) {
    const eq = byId.get(chk.equivalent_id);
    if (!eq) continue;
    const minutes = eq.timer_seconds
      ? eq.timer_seconds / 60
      : (DEFAULT_TIER_MINUTES[eq.effort_tier] || DEFAULT_TIER_MINUTES[2]);
    minutesByAxis[eq.domain] = (minutesByAxis[eq.domain] || 0) + minutes;
  }
  return minutesByAxis;
}

async function computeLoggedHoursPerWeek(userId, windowStart) {
  const [commitmentMinutes, equivalentMinutes] = await Promise.all([
    commitmentMinutesByAxis(userId, windowStart),
    equivalentMinutesByAxis(userId, windowStart),
  ]);

  const weeks = ROLLING_WINDOW_DAYS / 7;
  const result = {};
  for (const axis of new Set([...Object.keys(commitmentMinutes), ...Object.keys(equivalentMinutes)])) {
    const totalMinutes = (commitmentMinutes[axis] || 0) + (equivalentMinutes[axis] || 0);
    result[axis] = Math.round((totalMinutes / 60 / weeks) * 10) / 10;
  }
  return result;
}

async function computeCurrentHoursPerWeek(userId) {
  const { data: user } = await sb
    .from('users').select('wake_time, sleep_time, identity_checkin_started_at, identity_priorities')
    .eq('id', userId).single();
  if (!user) return null;

  const lookbackStart = new Date(Date.now() - ROLLING_WINDOW_DAYS * 86_400_000);
  const startedAt = user.identity_checkin_started_at ? new Date(user.identity_checkin_started_at) : null;
  const windowStart = startedAt && startedAt > lookbackStart ? startedAt : lookbackStart;

  const { data: checkins } = await sb
    .from('identity_checkins')
    .select('identity_axis, is_fixed')
    .eq('user_id', userId)
    .gte('created_at', windowStart.toISOString());

  const total = checkins?.length || 0;
  const wakingHoursPerWeek = (wakingMinutes(user.wake_time, user.sleep_time) / 60) * 7;
  const logged = await computeLoggedHoursPerWeek(userId, windowStart);

  const axes = {};
  for (const axis of AXES) {
    const axisCheckins = total ? checkins.filter(c => c.identity_axis === axis) : [];
    const fixedCount = axisCheckins.filter(c => c.is_fixed === true).length;
    axes[axis] = {
      sample_count: axisCheckins.length,
      // Extrapolating a full week from a handful of point-samples can land
      // on technically-correct-but-absurd numbers early on (e.g. the first
      // 2 samples both happening to be 'achievement' reads as "112h/week" --
      // literally 100% of waking hours, from n=2). low_confidence flags
      // that so the client can caveat it instead of presenting it as a
      // settled measurement; same MIN_CONFIDENT_SAMPLES threshold
      // interventions.js's personalization already uses for "enough data."
      low_confidence: total > 0 && total < MIN_CONFIDENT_SAMPLES,
      current_hours_per_week: total ? Math.round((axisCheckins.length / total) * wakingHoursPerWeek * 10) / 10 : null,
      fixed_hours_per_week: total ? Math.round((fixedCount / total) * wakingHoursPerWeek * 10) / 10 : null,
      logged_hours_per_week: logged[axis] || 0,
    };
  }

  const fixedHoursByAxis = {};
  AXES.forEach(axis => { fixedHoursByAxis[axis] = axes[axis].fixed_hours_per_week || 0; });
  const desired = computeDesiredHoursPerWeek(user.identity_priorities, wakingHoursPerWeek, fixedHoursByAxis);
  AXES.forEach(axis => {
    axes[axis].desired_hours_per_week = desired[axis];
    axes[axis].floor_hours_per_week = AXIS_FLOORS[axis] || null;
  });

  return { total_samples: total, window_start: windowStart.toISOString(), axes };
}

module.exports = { computeCurrentHoursPerWeek };
