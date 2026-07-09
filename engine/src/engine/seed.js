/**
 * Starter seed library — the default outcome_equivalents/domain_metrics a
 * brand-new user gets with zero typing, per Engine v8 + MVP1-SPEC-v2.
 * "Who curates this" is flagged as an open decision in the spec — this is a
 * first pass, meant to be edited/expanded, not a final curated set.
 */
const STARTER_DOMAINS = {
  move: [
    { effort_tier: 1, action_text: 'Stand up and move for 2 minutes' },
    { effort_tier: 2, action_text: 'Walk to the end of your street and back' },
    { effort_tier: 3, action_text: '10-minute walk outside' },
    { effort_tier: 4, action_text: '30-minute walk or light workout' },
  ],
  fuel: [
    { effort_tier: 1, action_text: 'Drink a full glass of water' },
    { effort_tier: 2, action_text: 'Eat one piece of fruit or a handful of nuts' },
    { effort_tier: 3, action_text: 'Prepare and eat a simple balanced snack' },
    { effort_tier: 4, action_text: 'Cook and eat a proper meal' },
  ],
  reset: [
    { effort_tier: 1, action_text: 'Close your eyes and breathe slowly for 1 minute' },
    { effort_tier: 2, action_text: 'Lie down for 5 minutes, no phone' },
    { effort_tier: 3, action_text: '15-minute quiet rest, no screens' },
    { effort_tier: 4, action_text: '20-minute nap or full break' },
  ],
  // Everyone's generic bootstrapped version of what became the founder's
  // hand-authored "build" domain -- make progress on whatever your own
  // thing is, without the engine knowing or needing to know what that is.
  progress: [
    { effort_tier: 1, action_text: "Open whatever you're working on and look at it for 2 minutes" },
    { effort_tier: 2, action_text: 'Do one small task on it for 15 minutes' },
    { effort_tier: 3, action_text: 'Work a focused 30 minutes on what matters most right now' },
    { effort_tier: 4, action_text: 'A full 1+ hour session on your most important thing' },
  ],
  // The one universal-need category the original 3 domains missed entirely.
  connect: [
    { effort_tier: 1, action_text: 'Send one text to someone you care about' },
    { effort_tier: 2, action_text: 'Have a 5-minute conversation with someone' },
    { effort_tier: 3, action_text: 'Spend 15 minutes fully present with someone, no phone' },
    { effort_tier: 4, action_text: 'Have an unhurried, meaningful conversation or spend real time with someone who matters to you' },
  ],
};

const DOMAIN_DEFAULT_METRIC = {
  move: 'weekly_active_minutes',
  fuel: 'weekly_balanced_meals',
  reset: 'weekly_rest_sessions',
  progress: 'weekly_progress_sessions',
  connect: 'weekly_connect_moments',
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
        effort_tier: eq.effort_tier, compounds: true, created_by: 'system_suggested',
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
