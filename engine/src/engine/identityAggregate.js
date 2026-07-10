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
 */
const sb = require('../db/client');
const { AXES, ROLLING_WINDOW_DAYS, wakingMinutes } = require('./identityCheckin');

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

  const axes = {};
  for (const axis of AXES) {
    const axisCheckins = total ? checkins.filter(c => c.identity_axis === axis) : [];
    const fixedCount = axisCheckins.filter(c => c.is_fixed === true).length;
    axes[axis] = {
      sample_count: axisCheckins.length,
      current_hours_per_week: total ? Math.round((axisCheckins.length / total) * wakingHoursPerWeek * 10) / 10 : null,
      fixed_hours_per_week: total ? Math.round((fixedCount / total) * wakingHoursPerWeek * 10) / 10 : null,
    };
  }

  return { total_samples: total, window_start: windowStart.toISOString(), axes };
}

module.exports = { computeCurrentHoursPerWeek };
