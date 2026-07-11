/**
 * Starter seed library — the default outcome_equivalents/domain_metrics a
 * brand-new user gets with zero typing, per Engine v8 + MVP1-SPEC-v2.
 *
 * Rewritten onto the Adaptive Allocation Engine's 6-axis spectrum
 * (foundation/relationships/achievement/finance/contribution/recreation)
 * instead of the original 5 ad-hoc domains (move/fuel/reset/progress/
 * connect) -- same vocabulary identity_checkins.identity_axis and
 * commitments.identity_axis already use, so a seeded starter task and a
 * manually-tagged commitment finally mean the same thing when they share a
 * domain/axis name. "Who curates this" is still a first pass, meant to be
 * edited/expanded, not a final curated set.
 *
 * timer_seconds is set on actions that are literally a fixed-duration
 * exercise (breathing, a short walk, a focused block) so the client can
 * show a real countdown with a completion alert instead of just a Done
 * button; left undefined (-> null) for open-ended ones where a hard
 * countdown wouldn't make sense (e.g. "check your balance").
 */
const STARTER_DOMAINS = {
  foundation: [
    { effort_tier: 1, action_text: 'Close your eyes and breathe slowly for 1 minute', timer_seconds: 60 },
    { effort_tier: 2, action_text: 'Drink a full glass of water' },
    { effort_tier: 3, action_text: 'Take a 10-minute walk outside', timer_seconds: 600 },
    { effort_tier: 4, action_text: 'Cook and eat a proper meal' },
  ],
  relationships: [
    { effort_tier: 1, action_text: 'Send one text to someone you care about' },
    { effort_tier: 2, action_text: 'Have a 5-minute conversation with someone', timer_seconds: 300 },
    { effort_tier: 3, action_text: 'Spend 15 minutes fully present with someone, no phone', timer_seconds: 900 },
    { effort_tier: 4, action_text: 'Plan a real hangout with someone who matters to you' },
  ],
  achievement: [
    { effort_tier: 1, action_text: "Open whatever you're working on and look at it for 2 minutes", timer_seconds: 120 },
    { effort_tier: 2, action_text: 'Do one small task on it for 15 minutes', timer_seconds: 900 },
    { effort_tier: 3, action_text: 'Work a focused 30 minutes on what matters most right now', timer_seconds: 1800 },
    { effort_tier: 4, action_text: 'A full 1+ hour session on your most important thing' },
  ],
  finance: [
    { effort_tier: 1, action_text: 'Check your account balance' },
    { effort_tier: 2, action_text: "Log today's spending in one line" },
    { effort_tier: 3, action_text: 'Move $5 into savings' },
    { effort_tier: 4, action_text: 'Review your spending from this week for 10 minutes', timer_seconds: 600 },
  ],
  contribution: [
    { effort_tier: 1, action_text: 'Send a thank-you or encouragement message to someone' },
    { effort_tier: 2, action_text: 'Tidy one small shared space for 2 minutes', timer_seconds: 120 },
    { effort_tier: 3, action_text: 'Help someone with a task for 15 minutes', timer_seconds: 900 },
    { effort_tier: 4, action_text: 'Volunteer or give real time to something bigger than yourself' },
  ],
  recreation: [
    { effort_tier: 1, action_text: 'Close your eyes and just listen to one song, no multitasking' },
    { effort_tier: 2, action_text: 'Take a 5-minute break to do something purely fun', timer_seconds: 300 },
    { effort_tier: 3, action_text: 'Spend 20 minutes on a hobby you enjoy', timer_seconds: 1200 },
    { effort_tier: 4, action_text: 'Give yourself a full guilt-free hour to do whatever sounds fun' },
  ],
};

const DOMAIN_DEFAULT_METRIC = {
  foundation: 'weekly_foundation_minutes',
  relationships: 'weekly_relationship_moments',
  achievement: 'weekly_achievement_sessions',
  finance: 'weekly_finance_checkins',
  contribution: 'weekly_contribution_moments',
  recreation: 'weekly_recreation_minutes',
};

const DOMAIN_ORDER = Object.keys(STARTER_DOMAINS);

// Only called for genuinely new users (checked by the caller) — seeding an
// existing user again would duplicate their whole pool every re-login.
async function seedDomainsForUser(sb, userId) {
  const eqRows = [];
  DOMAIN_ORDER.forEach((domain) => {
    STARTER_DOMAINS[domain].forEach((eq) => {
      eqRows.push({
        user_id: userId, domain, action_text: eq.action_text,
        effort_tier: eq.effort_tier, timer_seconds: eq.timer_seconds ?? null,
        compounds: true, created_by: 'system_suggested',
      });
    });
  });
  const metricRows = DOMAIN_ORDER.map((domain) => ({
    user_id: userId, domain, metric_name: DOMAIN_DEFAULT_METRIC[domain], created_by: 'system_suggested',
  }));
  // Errors here must not fail registration (a user should never be blocked by
  // seeding), but swallowing them silently means a broken seed goes unnoticed
  // until someone stares at an empty domain list much later — log instead.
  const [eqResult, metricResult] = await Promise.all([
    sb.from('outcome_equivalents').insert(eqRows),
    sb.from('domain_metrics').insert(metricRows),
  ]);
  if (eqResult.error) console.error('[seed] outcome_equivalents insert failed for user', userId, eqResult.error.message);
  if (metricResult.error) console.error('[seed] domain_metrics insert failed for user', userId, metricResult.error.message);
}

module.exports = { STARTER_DOMAINS, DOMAIN_DEFAULT_METRIC, DOMAIN_ORDER, seedDomainsForUser };
