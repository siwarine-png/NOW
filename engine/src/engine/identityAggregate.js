/**
 * Turns raw identity_checkins samples into current_hours_per_week per axis
 * -- the "reality" half of the Adaptive Allocation Engine's gap calculation
 * (desired vs. current, see engine-specs/adaptive-allocation-engine-v1.1.md
 * §4). Point-sample proportions over a rolling window stand in for actual
 * time-use proportions (standard ESM time-budget estimation), scaled
 * against the user's own waking hours per week rather than a flat 168 --
 * sleep isn't allocatable time to begin with.
 *
 * Only current_hours_per_week -- desired_hours_per_week still isn't
 * computed anywhere (that's the unbuilt Phase 1/2 baseline+flex allocation
 * from the spec, a separate and much bigger piece of work). This module is
 * deliberately scoped to just the measurement side.
 *
 * Samples with is_fixed = true count toward fixed_hours_per_week --
 * non-negotiable time future allocation logic must not suggest moving.
 * is_fixed = null (the common case for a fast manual chip tap with no
 * matching registered commitment) is folded into flexible rather than
 * asserted either way, since absence of a registered commitment isn't
 * proof the time was actually free.
 *
 * logged_hours_per_week is a second, separate signal: real elapsed time
 * from axis-tagged commitments (see migration 016) actually checked in
 * done, over the same rolling window. Deliberately NOT merged into
 * current_hours_per_week's point-sample proportion -- that estimate's math
 * assumes samples land at effectively random moments, and a burst of
 * completed-task events doesn't share that property (finishing 3 Finance
 * commitments in one sitting isn't 3x the point-sample evidence a random
 * ping would represent, and could easily double-count a moment a sample
 * happened to also catch). Reported alongside as ground truth for whatever
 * axis-tagged commitments actually exist, not a replacement for the
 * sampling estimate covering everything else.
 */
const sb = require('../db/client');
const { AXES, ROLLING_WINDOW_DAYS, wakingMinutes } = require('./identityCheckin');

function windowMinutes(windowStart, windowEnd) {
  const [sh, sm] = windowStart.split(':').map(Number);
  const [eh, em] = windowEnd.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 1440; // overnight window
  return diff;
}

async function computeLoggedHoursPerWeek(userId, windowStart) {
  const { data: tagged } = await sb
    .from('commitments')
    .select('id, identity_axis, window_start, window_end')
    .eq('user_id', userId)
    .not('identity_axis', 'is', null)
    .not('window_start', 'is', null)
    .not('window_end', 'is', null);
  if (!tagged?.length) return {};

  const byId = new Map(tagged.map(c => [c.id, c]));
  const { data: doneCheckins } = await sb
    .from('checkins')
    .select('commitment_id, occurred_at')
    .in('commitment_id', [...byId.keys()])
    .eq('result', 'done')
    .gte('occurred_at', windowStart.toISOString());

  const weeks = ROLLING_WINDOW_DAYS / 7;
  const minutesByAxis = {};
  for (const chk of doneCheckins || []) {
    const c = byId.get(chk.commitment_id);
    if (!c) continue;
    minutesByAxis[c.identity_axis] = (minutesByAxis[c.identity_axis] || 0) + windowMinutes(c.window_start, c.window_end);
  }

  const result = {};
  for (const axis of Object.keys(minutesByAxis)) {
    result[axis] = Math.round((minutesByAxis[axis] / 60 / weeks) * 10) / 10;
  }
  return result;
}

async function computeCurrentHoursPerWeek(userId) {
  const { data: user } = await sb
    .from('users').select('wake_time, sleep_time, identity_checkin_started_at')
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
      current_hours_per_week: total ? Math.round((axisCheckins.length / total) * wakingHoursPerWeek * 10) / 10 : null,
      fixed_hours_per_week: total ? Math.round((fixedCount / total) * wakingHoursPerWeek * 10) / 10 : null,
      logged_hours_per_week: logged[axis] || 0,
    };
  }

  return { total_samples: total, window_start: windowStart.toISOString(), axes };
}

module.exports = { computeCurrentHoursPerWeek };
