/**
 * The substitution system (Engine v5-v8): one fixed goal (compound_self_investment,
 * implicit, never stored/shown), domains as substitutable pools of equivalent
 * actions. This runs alongside — not instead of — the original commitment-based
 * R1-R8 rules in rules.js; GET /interventions/now tries domains first (matches
 * MVP1-SPEC-v2's zero-typing onboarding, which never creates a commitment at all)
 * and falls back to commitments if a user has any.
 *
 * R9:  same equivalent failed ('skipped') 2x running -> offer a lower-effort
 *      compounding equivalent instead.
 * R9a: tiebreak among same-tier candidates -> most-recently-completed first,
 *      else the order they were created in.
 * R9b: the lowest-effort compounding equivalent has itself failed 2x -> stop
 *      shrinking, ask whether to pause this domain instead.
 * R10: >=10 observations in a domain with a flat/declining trend -> ask if
 *      it's still worth counting. NOTE: no pipeline exists yet to capture
 *      actual metric *values* (e.g. real minutes moved) — this is a
 *      completion-rate proxy for "trend" until real metric capture exists.
 * R11: when multiple domains are due on the same day, prioritize whichever
 *      one the user actually follows through on more (completion rate),
 *      not just seed-then-creation order. A domain with <5 observations
 *      yet is scored neutral, so a brand-new domain gets a fair first look
 *      before adaptive weighting has anything real to go on.
 */
const { DOMAIN_ORDER } = require('./seed');

function fmtAction(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

async function loadDomainData(sb, userId) {
  const { data: equivalents } = await sb
    .from('outcome_equivalents').select('*').eq('user_id', userId);
  const eqIds = (equivalents || []).map((e) => e.id);
  let checkins = [];
  if (eqIds.length) {
    const { data } = await sb
      .from('checkins').select('equivalent_id,result,occurred_at')
      .in('equivalent_id', eqIds).order('occurred_at', { ascending: false }).limit(300);
    checkins = data || [];
  }
  return { equivalents: equivalents || [], checkins };
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Most recent 2 checkins for a specific equivalent, newest first.
function lastTwoFor(checkins, equivalentId) {
  return checkins.filter((c) => c.equivalent_id === equivalentId).slice(0, 2);
}

function bothSkipped(pair) {
  return pair.length === 2 && pair.every((c) => c.result === 'skipped');
}

// R11: fraction of done vs. (done+skipped) observations for a domain's
// equivalents. Null (not a low number) below the observation floor, so
// callers can tell "genuinely bad at this" from "haven't tried it yet" and
// treat the latter neutrally instead of penalizing it.
function domainCompletionRate(checkins, ids) {
  const observations = checkins.filter((c) => ids.includes(c.equivalent_id) && (c.result === 'done' || c.result === 'skipped'));
  if (observations.length < 5) return null;
  return observations.filter((c) => c.result === 'done').length / observations.length;
}

// Read-only zoom levels on the one signal that already exists (done checkins)
// — never separate authored goals, which is exactly what v6 collapsed away.
// Each window is a superset of the one before it except `longterm`, which is
// deliberately about longevity (first done checkin 30+ days back) rather than
// recency, so it isn't just a redundant echo of `month`.
// Caveat: checkins are capped at the 300 most recent (see loadDomainData), so
// `longterm` could read false for a very heavy user whose earliest checkin
// has aged out of that window — acceptable for MVP1 scale, not for later.
function computeBigPicture(checkins, now) {
  const done = checkins.filter((c) => c.result === 'done');
  const withinDays = (days) => done.some((c) => now - new Date(c.occurred_at) <= days * 86400000);
  const earliest = done.reduce((min, c) => {
    const t = new Date(c.occurred_at);
    return !min || t < min ? t : min;
  }, null);
  return {
    today: done.some((c) => isSameDay(new Date(c.occurred_at), now)),
    week: withinDays(7),
    month: withinDays(30),
    longterm: !!earliest && (now - earliest) >= 30 * 86400000,
  };
}

// R9a: among candidates at a given tier, most-recently-completed first, else
// insertion order (created_at asc).
function pickByR9a(candidates) {
  return candidates.slice().sort((a, b) => {
    if (a.last_completed_at && b.last_completed_at) return new Date(b.last_completed_at) - new Date(a.last_completed_at);
    if (a.last_completed_at) return -1;
    if (b.last_completed_at) return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  })[0];
}

async function pickDomainIntervention(sb, userId) {
  const { equivalents, checkins } = await loadDomainData(sb, userId);
  if (!equivalents.length) return null;

  const now = new Date();
  const bigPicture = computeBigPicture(checkins, now);
  const byDomain = {};
  equivalents.forEach((e) => { (byDomain[e.domain] = byDomain[e.domain] || []).push(e); });

  // Seeded domains rotate in their fixed order first; any domain the user has
  // (self-authored, not from the starter library) is appended after, sorted
  // for determinism. DOMAIN_ORDER alone would silently hide those forever.
  const seededPresent = DOMAIN_ORDER.filter((d) => byDomain[d]);
  const customPresent = Object.keys(byDomain).filter((d) => !DOMAIN_ORDER.includes(d)).sort();
  const domains = seededPresent.concat(customPresent);
  const dueDomains = domains.filter((domain) => {
    const ids = byDomain[domain].map((e) => e.id);
    return !checkins.some((c) => ids.includes(c.equivalent_id) && c.result === 'done' && isSameDay(new Date(c.occurred_at), now));
  });
  if (!dueDomains.length) return { all_done: true, big_picture: bigPicture }; // every domain already checked off today

  // R11: among domains due today, prioritize by completion rate — stable
  // sort means domains tied at the neutral (not-enough-data) score keep the
  // original seeded-then-custom order as their tiebreak.
  const dueDomain = dueDomains
    .map((domain, idx) => ({ domain, idx, score: domainCompletionRate(checkins, byDomain[domain].map((e) => e.id)) ?? 0.5 }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)[0].domain;

  const pool = byDomain[dueDomain].slice().sort((a, b) => a.effort_tier - b.effort_tier);
  const compounding = pool.filter((e) => e.compounds);
  if (!compounding.length) return { all_done: true, big_picture: bigPicture }; // everything in this domain got marked non-compounding

  // "Current" equivalent = whichever this user most recently interacted with
  // in this domain; if never, start at the lowest effort tier (the zero-typing
  // onboarding default).
  const domainIds = pool.map((e) => e.id);
  const mostRecentCheckin = checkins.find((c) => domainIds.includes(c.equivalent_id));
  let current = mostRecentCheckin
    ? pool.find((e) => e.id === mostRecentCheckin.equivalent_id) || compounding[0]
    : compounding[0];

  let ruleId = 'R_baseline_seed';
  let whyThis = 'A low-effort starting point for today.';

  const pair = lastTwoFor(checkins, current.id);
  if (bothSkipped(pair)) {
    const floor = compounding[0];
    if (current.id === floor.id) {
      // R9b: even the floor failed twice — stop shrinking, ask to pause.
      return {
        domain: dueDomain, equivalent: current, rule_id: 'R9b_floor_reached',
        ask_pause: true,
        message: `"${current.action_text}" hasn't landed the last two times, even at the smallest size. This isn't a size problem — want to pause the ${dueDomain} domain instead of keep offering it?`,
        action: null, why_this: 'Repeated misses at the smallest size usually mean timing or relevance, not effort.',
        alternates: alternates(pool, current.id),
        big_picture: bigPicture,
      };
    }
    // R9: substitute down to the next lower tier, R9a-tiebroken.
    const failedText = current.action_text;
    const lowerTier = Math.max(...compounding.filter((e) => e.effort_tier < current.effort_tier).map((e) => e.effort_tier));
    const candidates = compounding.filter((e) => e.effort_tier === lowerTier);
    current = pickByR9a(candidates);
    ruleId = 'R9_substitution';
    whyThis = `"${failedText}" didn't land twice — this is an easier equivalent, not a consolation prize.`;
  }

  const result = {
    domain: dueDomain, equivalent: current, rule_id: ruleId,
    action: fmtAction(current.action_text),
    message: ruleId === 'R9_substitution'
      ? `Let's switch it up: ${current.action_text}.`
      : `${fmtAction(current.action_text)}.`,
    why_this: whyThis,
    alternates: alternates(pool, current.id),
    big_picture: bigPicture,
    timer_seconds: current.timer_seconds || null,
  };

  // R10 (simplified proxy — see file header): only meaningful once there's
  // enough history, and only ever attached as a question, never a replacement.
  const domainObservations = checkins.filter((c) => domainIds.includes(c.equivalent_id) && (c.result === 'done' || c.result === 'skipped'));
  if (domainObservations.length >= 10) {
    const half = Math.floor(domainObservations.length / 2);
    const recent = domainObservations.slice(0, half);
    const earlier = domainObservations.slice(half);
    const rate = (rows) => rows.filter((r) => r.result === 'done').length / rows.length;
    if (rate(recent) <= rate(earlier)) {
      result.trend_check = {
        domain: dueDomain,
        message: `You've kept up with ${dueDomain} for a while, but it doesn't look like it's trending up. Still worth counting, or does something need to change?`,
      };
    }
  }

  return result;
}

function alternates(pool, excludeId) {
  return pool.filter((e) => e.id !== excludeId).slice(0, 3)
    .map((e) => ({ id: e.id, action_text: e.action_text, effort_tier: e.effort_tier, timer_seconds: e.timer_seconds || null }));
}

module.exports = { pickDomainIntervention };
