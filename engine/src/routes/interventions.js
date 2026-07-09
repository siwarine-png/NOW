const { Router } = require('express');
const sb = require('../db/client');
const { loadStats } = require('../engine/stats');
const { scoreRisk } = require('../engine/risk');
const { evaluate, isWithinWindow, nowMinutesInTz } = require('../engine/rules');
const { pickDomainIntervention } = require('../engine/domainRules');
const { log } = require('../engine/events');

const router = Router();

// GET /interventions/now?user_id=&energy=&context=
// Money endpoint — returns single best intervention or 204
router.get('/now', async (req, res) => {
  const { user_id, energy, context } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Verify user belongs to this app
  const { data: user } = await sb
    .from('users')
    .select('id, timezone')
    .eq('id', user_id)
    .eq('app_id', req.app_id)
    .single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // The client calls this endpoint every time the app opens or returns to the
  // foreground (see NowScreen's load/AppState effects) — piggyback session-open
  // tracking here instead of adding a dedicated endpoint for it.
  log(req.app_id, user_id, 'session.opened', { screen: 'now' });

  const energyNum = energy ? Number(energy) : null;
  const nowMin = nowMinutesInTz(user.timezone);

  // Load every active commitment once. A parent with open (active) children
  // is never itself surfaceable -- decomposition means only the current
  // smallest step shows, not the umbrella task ("MVP1 is too complicated").
  const { data: allCommitments } = await sb
    .from('commitments').select('*').eq('user_id', user_id).eq('status', 'active');
  const parentIdsWithOpenChildren = new Set(
    (allCommitments || []).filter(c => c.parent_commitment_id).map(c => c.parent_commitment_id)
  );
  const surfaceable = (allCommitments || []).filter(c => !parentIdsWithOpenChildren.has(c.id));

  // Critical commitments (e.g. a medication reminder established via the
  // Adaptive Nudge Engine) override the domain system below AND the normal
  // risk-based commitment rotation further down -- checked here, before
  // either, so "I forget to take prescribed medicine" can't lose a rotation
  // fight to a domain task just because its computed risk score is lower.
  const criticalCommitments = surfaceable.filter(c => c.priority_tier === 'critical');
  for (const c of criticalCommitments) {
    const stats = await loadStats(c.id);
    if (stats.checkedInToday) continue;
    const ctx = { commitment: c, stats, energy: energyNum, checkedInToday: false, nowMin };
    const result = evaluate(ctx);
    if (!result) continue;

    const { data: intervention } = await sb
      .from('interventions')
      .insert({ commitment_id: c.id, rule_id: result.rule_id, payload: result.payload })
      .select().single();

    log(req.app_id, user_id, 'intervention.issued', {
      intervention_id: intervention?.id, rule_id: result.rule_id, commitment_id: c.id, critical: true,
    });

    return res.json({
      commitment_id: c.id,
      action: result.payload.action,
      framing: result.payload.framing,
      message: result.payload.message,
      friction_reduction: result.payload.friction_reduction || null,
      why_this: result.payload.why_this,
      risk: null,
      rule_id: result.rule_id,
      intervention_id: intervention?.id,
      notify_partner_flag: result.payload.notify_partner_flag || false,
    });
  }

  // Engine v8: the domain/outcome_equivalents system takes over for any user
  // who has entered it at all — this is how MVP1-SPEC-v2's zero-typing
  // onboarding works, since it seeds equivalents and never creates a
  // commitment. Falls back to the original commitment-based R1-R8 rules only
  // for users with no domain data (i.e. never seeded / pre-v8).
  const { data: hasEquivalents } = await sb
    .from('outcome_equivalents').select('id').eq('user_id', user_id).limit(1);

  if (hasEquivalents && hasEquivalents.length) {
    const domainResult = await pickDomainIntervention(sb, user_id);
    if (!domainResult || domainResult.all_done) {
      return res.status(200).json({
        state: 'clear', message: 'All caught up for today.', next_at: null,
        big_picture: domainResult?.big_picture || null,
      });
    }

    log(req.app_id, user_id, 'intervention.issued', {
      rule_id: domainResult.rule_id, domain: domainResult.domain,
      equivalent_id: domainResult.equivalent.id,
    });

    return res.json({
      domain: domainResult.domain,
      equivalent_id: domainResult.equivalent.id,
      action: domainResult.action,
      message: domainResult.message,
      why_this: domainResult.why_this,
      rule_id: domainResult.rule_id,
      alternates: domainResult.alternates,
      ask_pause: domainResult.ask_pause || false,
      trend_check: domainResult.trend_check || null,
      big_picture: domainResult.big_picture,
    });
  }

  // Non-critical active commitments (critical ones were already tried above
  // and, if we're here, didn't match -- e.g. checked in already, or window
  // not open yet -- so they're excluded from the ordinary rotation too).
  const commitments = surfaceable.filter(c => c.priority_tier !== 'critical');

  if (!commitments || commitments.length === 0) return res.status(204).end();

  // Snoozed commitments stay out of rule evaluation until their snooze expires —
  // otherwise the same intervention would just re-fire on the next poll.
  const now = new Date();
  const notSnoozed = commitments.filter(c => !c.snoozed_until || new Date(c.snoozed_until) <= now);
  const snoozed = commitments.filter(c => c.snoozed_until && new Date(c.snoozed_until) > now);

  // "Only nudge me for this between X-Y" — computed in the user's own
  // timezone, not the server's, and handles windows that cross midnight.
  // This must gate every rule, not just the ones that already looked at the
  // window (R1/R3) — otherwise R2/R4/R6/R7/R8 fire at any hour regardless of
  // what the user configured.
  const available = notSnoozed.filter(c => isWithinWindow(nowMin, c.window_start, c.window_end));
  const outsideWindow = notSnoozed.filter(c => !isWithinWindow(nowMin, c.window_start, c.window_end));

  if (available.length === 0) {
    const nextWake = snoozed.map(c => c.snoozed_until).sort()[0];
    return res.status(200).json({
      state: 'clear',
      message: nextWake
        ? 'Snoozed — check back soon.'
        : outsideWindow.length > 0
          ? 'Outside your nudge windows right now.'
          : 'All caught up. Check back later.',
      next_at: nextWake || null,
    });
  }

  // Score all commitments, pick highest risk
  const scored = await Promise.all(
    available.map(async c => {
      const stats = await loadStats(c.id);
      const { score, top_factor, factors } = scoreRisk(c, stats);
      return { commitment: c, stats, score, top_factor, factors };
    })
  );

  scored.sort((a, b) => b.score - a.score);

  // Try each commitment in risk order until one triggers a rule
  let matched = null;
  let matchedCtx = null;

  for (const item of scored) {
    const ctx = {
      commitment: item.commitment,
      stats: item.stats,
      energy: energyNum,
      checkedInToday: item.stats.checkedInToday,
      nowMin,
      context: context || null,
    };
    const result = evaluate(ctx);
    if (result) {
      matched = { ...item, ...result };
      matchedCtx = ctx;
      break;
    }
  }

  if (!matched) {
    // Nothing actionable — find when the next window opens
    const nextWindow = available
      .filter(c => c.window_start)
      .map(c => c.window_start)
      .sort()[0];
    return res.status(200).json({
      state: 'clear',
      message: nextWindow
        ? `Nothing right now — next window opens at ${nextWindow}.`
        : 'All caught up. Check back later.',
      next_at: nextWindow || null,
    });
  }

  // Personalization v0: if ≥10 closed outcomes, pick best framing
  // (simple GROUP BY — not ML)
  const { data: outcomes } = await sb
    .from('interventions')
    .select('payload->framing, outcome')
    .eq('commitment_id', matched.commitment.id)
    .not('outcome', 'is', null);

  let preferredFraming = null;
  if (outcomes && outcomes.length >= 10) {
    const framingScores = {};
    outcomes.forEach(o => {
      const f = o.framing;
      if (!f) return;
      framingScores[f] = framingScores[f] || { acted: 0, total: 0 };
      framingScores[f].total++;
      if (o.outcome === 'acted') framingScores[f].acted++;
    });
    preferredFraming = Object.keys(framingScores).reduce((best, f) => {
      const rate = framingScores[f].acted / framingScores[f].total;
      const bestRate = framingScores[best]?.acted / framingScores[best]?.total ?? 0;
      return rate > bestRate ? f : best;
    });
  }

  if (preferredFraming && preferredFraming !== matched.payload.framing) {
    matched.payload.framing = preferredFraming + '_personalized';
  }

  // Persist intervention record
  const { data: intervention } = await sb
    .from('interventions')
    .insert({
      commitment_id: matched.commitment.id,
      rule_id: matched.rule_id,
      payload: matched.payload,
    })
    .select()
    .single();

  log(req.app_id, user_id, 'intervention.issued', {
    intervention_id: intervention?.id,
    rule_id: matched.rule_id,
    commitment_id: matched.commitment.id,
    risk: matched.score,
  });

  res.json({
    commitment_id: matched.commitment.id,
    action: matched.payload.action,
    framing: matched.payload.framing,
    message: matched.payload.message,
    friction_reduction: matched.payload.friction_reduction || null,
    why_this: matched.payload.why_this,
    risk: Math.round(matched.score * 100) / 100,
    rule_id: matched.rule_id,
    intervention_id: intervention?.id,
    notify_partner_flag: matched.payload.notify_partner_flag || false,
  });
});

module.exports = router;
