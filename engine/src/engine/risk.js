/**
 * Risk Scorer v1 — fully deterministic, no ML.
 *
 * risk = clamp01(
 *   0.30 * missed_yesterday
 * + 0.20 * (1 - completion_rate_14d)
 * + 0.20 * window_pressure          // 1 - time_left/window_length, 0 outside window
 * + 0.15 * new_habit_support         // 1 if streak in [1,3] -- still forming, benefits from more support
 * + 0.15 * deadline_pressure        // max(0, 1 - hours_to_deadline/72)
 * )
 */

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * @param {Object} c - commitment row
 * @param {Object} stats - { missedYesterday, completionRate14d, streak, lastCheckinAt }
 * @returns {{ score: number, top_factor: string, factors: Object }}
 */
function scoreRisk(c, stats) {
  const { missedYesterday, completionRate14d, streak } = stats;

  // window pressure: how far into the window are we with no check-in today?
  let windowPressure = 0;
  if (c.window_start && c.window_end) {
    const now = nowMinutes();
    const ws = timeToMinutes(c.window_start);
    const we = timeToMinutes(c.window_end);
    const windowLen = we > ws ? we - ws : 0;
    if (windowLen > 0 && now >= ws && now <= we) {
      windowPressure = 1 - (we - now) / windowLen;
    }
  }

  // A habit that's 1-3 days in is still forming, not yet a stable pattern --
  // this is the same "still early, deserves more support" signal the Nudge
  // Engine's Momentum Score uses (low M -> higher nudge frequency), not a
  // "streak worth protecting from breaking" framing.
  const newHabitSupport = streak >= 1 && streak <= 3 ? 1 : 0;

  // deadline pressure: 1 if deadline < 72h away, scales linearly
  let deadlinePressure = 0;
  if (c.deadline) {
    const hoursLeft = (new Date(c.deadline) - Date.now()) / 3_600_000;
    if (hoursLeft < 72) deadlinePressure = Math.max(0, 1 - hoursLeft / 72);
  }

  const factors = {
    missed_yesterday:     missedYesterday ? 1 : 0,
    low_completion:       1 - (completionRate14d ?? 1),
    window_pressure:      windowPressure,
    new_habit_support:    newHabitSupport,
    deadline_pressure:    deadlinePressure,
  };

  const weights = {
    missed_yesterday:   0.30,
    low_completion:     0.20,
    window_pressure:    0.20,
    new_habit_support:  0.15,
    deadline_pressure:  0.15,
  };

  const score = clamp01(
    Object.keys(factors).reduce((s, k) => s + factors[k] * weights[k], 0)
  );

  const top_factor = Object.keys(factors).reduce((best, k) =>
    factors[k] * weights[k] > factors[best] * weights[best] ? k : best
  );

  return { score, top_factor, factors };
}

module.exports = { scoreRisk };
