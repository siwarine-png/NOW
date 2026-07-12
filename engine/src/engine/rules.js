/**
 * Rules Engine v1 — priority ordered, first match wins.
 * Each rule is a { id, matches(ctx), build(ctx) } object.
 * ctx = { commitment, stats, energy, checkedInToday, nowMinutes }
 * R1 (streak-protection framing) retired -- see R3's comment.
 */

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

// "Now," expressed as minutes-since-midnight in the user's own timezone — not
// the server's. Cloud Run runs in UTC; comparing that directly against a
// window the user entered in their own local time silently misfires by
// however many hours the two are apart.
function nowMinutesInTz(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC', hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    return (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  } catch (e) {
    const d = new Date();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

// True if `nowMin` falls inside [windowStart, windowEnd) — handles windows
// that cross midnight (e.g. 22:00-06:00), which a plain nowMin >= ws && < we
// check gets backwards. No window set at all = always allowed.
function isWithinWindow(nowMin, windowStart, windowEnd) {
  const ws = timeToMinutes(windowStart), we = timeToMinutes(windowEnd);
  if (ws == null || we == null) return true;
  if (we >= ws) return nowMin >= ws && nowMin < we;
  return nowMin >= ws || nowMin < we; // overnight window
}

// Minutes until windowEnd, correct even when the window wraps past midnight.
function minutesLeft(windowEnd, nowMin, windowStart) {
  const we = timeToMinutes(windowEnd);
  if (we == null) return null;
  const ws = timeToMinutes(windowStart);
  if (ws != null && we < ws) {
    return nowMin >= ws ? (we + 1440) - nowMin : we - nowMin;
  }
  return we - nowMin;
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h % 12) || 12)}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

const RULES = [
  {
    id: 'R9_critical_override',
    // "I forget to take prescribed medicine" -- a critical commitment stays
    // due (not just momentarily nudged) from the moment its window opens
    // until it's checked in, regardless of streak/deadline/energy signals
    // that govern R1-R8. Evaluated first so nothing else can out-rank it for
    // a given commitment; interventions.js separately sorts critical
    // commitments ahead of the domain system and normal risk-based rotation
    // so this rule actually gets a chance to run instead of being crowded
    // out before evaluation.
    matches({ commitment: c, checkedInToday, nowMin }) {
      if (checkedInToday) return false;
      if (c.priority_tier !== 'critical') return false;
      const ws = timeToMinutes(c.window_start);
      if (ws == null) return true;
      return nowMin >= ws;
    },
    build({ commitment: c }) {
      return {
        framing: 'critical',
        action: c.next_action || `Take care of ${c.title}`,
        message: `${c.title} — ${c.next_action || 'do this now'}. This doesn't wait for anything else.`,
        friction_reduction: null,
        why_this: 'Marked critical: always surfaces first, regardless of what else is due.',
      };
    },
  },
  {
    id: 'R2_missed_yesterday',
    matches({ commitment: c, stats, checkedInToday }) {
      if (checkedInToday) return false;
      return !!stats.missedYesterday && c.cadence === 'daily';
    },
    build({ commitment: c }) {
      return {
        framing: 'recovery',
        action: c.next_action || `Start ${c.title}`,
        message: `Never miss twice. Smallest version of "${c.title}" today — even 2 minutes — resets the pattern.`,
        friction_reduction: '2-minute version',
        why_this: 'One miss is a blip. Two misses is a new (bad) habit.',
      };
    },
  },
  {
    // Was two rules: this one at <60min for everyone, plus R1_streak_at_risk
    // at <90min but only if streak >= 3 ("don't break the chain" framing).
    // Retired R1 rather than softening its language -- gating the earlier
    // heads-up behind an existing streak meant someone on day one, or
    // recovering from a miss, got *less* support than someone who'd already
    // succeeded a few times running, which is backwards. Everyone gets the
    // earlier <90min heads-up now, plain urgency framing, no streak count,
    // no chain to protect or break.
    id: 'R3_window_closing',
    matches({ commitment: c, stats, checkedInToday, nowMin }) {
      if (checkedInToday) return false;
      if (!isWithinWindow(nowMin, c.window_start, c.window_end)) return false;
      const ml = minutesLeft(c.window_end, nowMin, c.window_start);
      return ml !== null && ml < 90 && ml > 0;
    },
    build({ commitment: c, stats, nowMin }) {
      const ml = minutesLeft(c.window_end, nowMin, c.window_start);
      const rate = Math.round((stats.completionRate14d ?? 0) * 100);
      return {
        framing: 'urgency',
        action: c.next_action || `Start ${c.title}`,
        message: `Window closes in ${ml} min for "${c.title}". Your in-window rate: ${rate}%.`,
        friction_reduction: null,
        why_this: `This window closes at ${fmtTime(c.window_end)} — next chance is tomorrow.`,
      };
    },
  },
  {
    id: 'R4_ambiguous_action',
    matches({ commitment: c, checkedInToday }) {
      if (checkedInToday) return false;
      return !c.next_action || c.next_action.length > 80;
    },
    build({ commitment: c }) {
      return {
        framing: 'clarify',
        action: 'Define your first physical step',
        message: `"${c.title}" doesn't have a clear first step yet. What's the single physical action that starts it?`,
        friction_reduction: null,
        why_this: 'Vague intentions fail. A physical first step (under 80 chars) makes it 3× more likely to happen.',
      };
    },
  },
  {
    id: 'R5_identity_reinforce',
    // Fires after a done/partial check-in when identity_tag is set
    matches({ commitment: c, stats, checkedInToday }) {
      return !!checkedInToday && !!c.identity_tag && stats.lastResultToday === 'done';
    },
    build({ commitment: c }) {
      return {
        framing: 'identity',
        action: null,
        message: `Evidence logged: you acted like a ${c.identity_tag} today. Every action casts a vote for who you're becoming.`,
        friction_reduction: null,
        why_this: 'Identity-based motivation compounds. Log it.',
      };
    },
  },
  {
    id: 'R6_low_energy_downshift',
    matches({ energy, checkedInToday }) {
      return !checkedInToday && energy !== null && energy <= 2;
    },
    build({ commitment: c }) {
      return {
        framing: 'friction_reduction',
        action: c.next_action ? `2-min version: ${c.next_action}` : `2-min version of ${c.title}`,
        message: `Low energy today. Maintenance counts. 2-minute version of "${c.title}" preserves the habit without burning you out.`,
        friction_reduction: '2-minute version',
        why_this: 'Showing up at low energy is the skill. The minimum counts.',
      };
    },
  },
  {
    id: 'R7_deadline_proximity',
    matches({ commitment: c, stats, checkedInToday }) {
      if (checkedInToday) return false;
      if (!c.deadline) return false;
      const hoursLeft = (new Date(c.deadline) - Date.now()) / 3_600_000;
      return hoursLeft < 48 && stats.completionRate14d < 0.6;
    },
    build({ commitment: c }) {
      const hoursLeft = Math.round((new Date(c.deadline) - Date.now()) / 3_600_000);
      return {
        framing: 'deadline',
        action: c.next_action || `Work on ${c.title}`,
        message: `Deadline for "${c.title}" in ${hoursLeft}h and you're behind pace. This is the escalation window.`,
        friction_reduction: null,
        why_this: 'Behind pace with < 48h left. Time to escalate, not coast.',
        notify_partner_flag: true,
      };
    },
  },
  {
    id: 'R8_stale_commitment',
    matches({ commitment: c, stats }) {
      const daysSilent = stats.daysSinceLastCheckin ?? 999;
      return daysSilent >= 7 && c.status === 'active';
    },
    build({ commitment: c, stats }) {
      // daysSinceLastCheckin is null (not 0) when there's never been a
      // single checkin recorded at all -- matches() folds that into the
      // same "definitely stale" bucket via ?? 999, but the message needs
      // its own wording here instead of literally printing "null days".
      const staleDescription = stats.daysSinceLastCheckin == null
        ? "hasn't been checked in on yet"
        : `has been quiet for ${stats.daysSinceLastCheckin} days`;
      return {
        framing: 'renegotiate',
        action: null,
        message: `"${c.title}" ${staleDescription}. Pause it, renegotiate the scope, or recommit — but don't let it linger as silent debt.`,
        friction_reduction: null,
        why_this: 'A commitment you\'re not keeping is a trust leak. Pause or renegotiate beats silent guilt.',
      };
    },
  },
];

/**
 * Evaluate all rules against context. Return first matching rule's output,
 * or null if nothing actionable.
 */
function evaluate(ctx) {
  for (const rule of RULES) {
    if (rule.matches(ctx)) {
      const payload = rule.build(ctx);
      return { rule_id: rule.id, payload };
    }
  }
  return null;
}

// "Today," expressed as a YYYY-MM-DD key in the user's own timezone -- same
// reasoning as nowMinutesInTz: a due_date is a plain calendar date with no
// timezone of its own, so comparing it against the server's UTC day would
// misfire near midnight for anyone west of UTC.
function todayKeyInTz(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date());
}

// A future due_date means "not yet" -- the commitment exists, it just
// shouldn't surface or push before its day arrives. No due_date (the common
// case -- habits, medication, anything not date-bound) always passes. A
// past due_date (overdue, still not done) also passes -- it should keep
// nagging, not silently vanish once its day is over.
function isDueByToday(dueDate, timezone) {
  if (!dueDate) return true;
  return dueDate <= todayKeyInTz(timezone);
}

module.exports = { evaluate, RULES, isWithinWindow, nowMinutesInTz, todayKeyInTz, isDueByToday };
