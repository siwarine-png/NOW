/**
 * Adaptive Nudge Engine (MVP1 per spec): seed 2 candidate anchors from 2
 * onboarding questions, run a time-boxed test, lock in a reusable profile,
 * then reuse+revalidate it for a second behavior (medication). Deliberately
 * NOT a bandit / open-ended experiment -- see the spec's own non-goals.
 *
 * Ongoing delivery after a test concludes is handed off to systems that
 * already exist and are already proven reliable, instead of this module
 * owning delivery forever:
 *   - app_open lock-in writes the winning time into users.checkin_time, so
 *     the existing daily push tick (scheduler.js) takes over.
 *   - medication confirmation leaves the commitment active, so the existing
 *     risk-scored R1-R8 proactive nudge system (runSchedulerTick) takes over.
 * This module only drives tests that are still `active`.
 */
const { pickDomainIntervention } = require('./domainRules');
const { nowMinutesInTz } = require('./rules');
// sendCheckinPush is lazy-required inside fireDueTests, not here:
// scheduler.js requires this module to drive its tick, so a top-level
// require here would deadlock on module load (each file's exports would
// still be empty while the other is mid-require).

const ANCHOR_TIMES = {
  wake_alarm: '07:00',
  coffee: '07:30',
  shower: '07:45',
  breakfast: '08:00',
  commute: '08:30',
  lunch: '12:30',
  brushing_teeth: '21:30',
  bedtime: '22:30',
};

// [start, end) in minutes-since-midnight, used only to pick a sensible
// backup anchor -- not a scheduling window in its own right.
const ENERGY_WINDOWS = {
  morning: [5 * 60, 12 * 60],
  midday: [11 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

// A short, self-reported daily habit is a stronger anchor than something
// occasional -- used as the tiebreak when more than one known anchor falls
// in the user's stated energy window.
const ANCHOR_STRENGTH_ORDER = ['wake_alarm', 'bedtime', 'coffee', 'breakfast', 'brushing_teeth', 'shower', 'commute', 'lunch'];

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function normalizeAnchor(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// candidate_a = the user's own answer (their explicit pick beats anything
// inferred); candidate_b = the strongest *other* known anchor whose default
// time falls in their stated energy window, so day 4-7 tests something
// genuinely different rather than a near-duplicate of A.
function resolveCandidates(anchorAnswer, anchorTime, energyWindow) {
  const normalized = normalizeAnchor(anchorAnswer);
  const window = ENERGY_WINDOWS[energyWindow] || ENERGY_WINDOWS.evening;
  const aTime = anchorTime || ANCHOR_TIMES[normalized] || minutesToTime((window[0] + window[1]) / 2);

  const inWindow = ANCHOR_STRENGTH_ORDER.filter(name => {
    if (name === normalized) return false;
    const t = timeToMinutes(ANCHOR_TIMES[name]);
    return t >= window[0] && t < window[1];
  });
  const backupName = inWindow[0] || ANCHOR_STRENGTH_ORDER.find(n => n !== normalized) || 'bedtime';

  return {
    candidate_a: anchorAnswer || normalized,
    candidate_a_time: aTime,
    candidate_b: backupName,
    candidate_b_time: ANCHOR_TIMES[backupName],
  };
}

async function startAppOpenTest(sb, userId, anchorAnswer, anchorTime, energyWindow, deliveryMethod) {
  const candidates = resolveCandidates(anchorAnswer, anchorTime, energyWindow);

  await sb.from('nudge_profiles').upsert({
    user_id: userId,
    delivery_method: deliveryMethod || 'push',
  }, { onConflict: 'user_id' });

  const { data, error } = await sb.from('nudge_tests').insert({
    user_id: userId,
    behavior: 'app_open',
    candidate_a: candidates.candidate_a,
    candidate_a_time: candidates.candidate_a_time,
    candidate_b: candidates.candidate_b,
    candidate_b_time: candidates.candidate_b_time,
    active_candidate: 'A',
    test_length_days: 7,
  }).select().single();

  if (error) throw new Error(error.message);
  return data;
}

// Reuse: the profile must already be established (a completed app_open test
// or a user override), and re-validates on this specific behavior rather
// than trusting the transfer blindly -- pills need to be physically present,
// which "opens the app" never had to prove.
async function establishMedication(sb, userId, frequency) {
  const { data: profile } = await sb.from('nudge_profiles').select('*').eq('user_id', userId).single();
  // established_at, not confidence_score -- a user override deliberately
  // sets confidence_score to null (it wasn't test-validated) while still
  // being a real, established profile per the spec's own "a user override
  // always beats another silent test cycle."
  if (!profile || profile.established_at == null) {
    throw new Error('No established nudge profile yet -- the app-open anchor test must complete first.');
  }

  const { data: existing } = await sb.from('nudge_tests')
    .select('*').eq('user_id', userId).eq('behavior', 'medication')
    .order('created_at', { ascending: false }).limit(1).single();
  if (existing && existing.status !== 'escalated') {
    const { data: commitment } = await sb.from('commitments').select('*').eq('id', existing.commitment_id).single();
    return { test: existing, commitment };
  }

  const windowMin = profile.timing_window_minutes || 30;
  const startMin = timeToMinutes(profile.primary_anchor_time);
  const { data: commitment, error: cErr } = await sb.from('commitments').insert({
    user_id: userId,
    title: 'Take medication',
    next_action: 'Take your medication',
    cadence: frequency || 'daily',
    window_start: profile.primary_anchor_time,
    window_end: minutesToTime(startMin + windowMin),
    // See rules.js R9_critical_override / interventions.js's /now handler:
    // medication overrides both the domain system and normal risk rotation.
    priority_tier: 'critical',
  }).select().single();
  if (cErr) throw new Error(cErr.message);

  const { data: test, error: tErr } = await sb.from('nudge_tests').insert({
    user_id: userId,
    behavior: 'medication',
    commitment_id: commitment.id,
    candidate_a: profile.primary_anchor,
    candidate_a_time: profile.primary_anchor_time,
    candidate_b: profile.backup_anchor,
    candidate_b_time: profile.backup_anchor_time,
    active_candidate: 'A',
    test_length_days: 3,
  }).select().single();
  if (tErr) throw new Error(tErr.message);

  return { test, commitment };
}

// A user's own pick always beats another silent test cycle (spec §1c/§3.6).
// For app_open this locks the profile directly; for medication it restarts
// the test fresh on the anchor the user just chose.
async function overrideAnchor(sb, userId, behavior, anchor, anchorTime) {
  if (behavior === 'app_open') {
    const today = new Date().toISOString().slice(0, 10);
    await sb.from('nudge_profiles').upsert({
      user_id: userId,
      primary_anchor: anchor,
      primary_anchor_time: anchorTime,
      confidence_score: null, // user-chosen, not test-validated
      established_at: today,
      last_validated_at: today,
    }, { onConflict: 'user_id' });
    await sb.from('users').update({ checkin_time: anchorTime }).eq('id', userId);
    await sb.from('nudge_tests')
      .update({ status: 'locked_in', result_anchor: anchor })
      .eq('user_id', userId).eq('behavior', 'app_open').eq('status', 'awaiting_override');
    return { ok: true };
  }

  // medication (or any future non-app_open behavior): restart on the
  // user-picked anchor instead of escalating further.
  const { data: test } = await sb.from('nudge_tests')
    .select('*').eq('user_id', userId).eq('behavior', behavior).eq('status', 'escalated')
    .order('created_at', { ascending: false }).limit(1).single();
  if (!test) throw new Error(`No escalated ${behavior} test to override`);

  await sb.from('nudge_tests').update({
    candidate_a: anchor, candidate_a_time: anchorTime,
    active_candidate: 'A', started_at: new Date().toISOString().slice(0, 10), status: 'active',
  }).eq('id', test.id);
  return { ok: true };
}

async function getStatus(sb, userId, behavior) {
  const { data: test } = await sb.from('nudge_tests')
    .select('*').eq('user_id', userId).eq('behavior', behavior)
    .order('created_at', { ascending: false }).limit(1).single();
  const { data: profile } = await sb.from('nudge_profiles').select('*').eq('user_id', userId).single();
  return { test: test || null, profile: profile || null };
}

function dateKeyInTz(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function daysBetween(startDateStr, now, timezone) {
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const todayKey = dateKeyInTz(now, timezone);
  const today = new Date(`${todayKey}T00:00:00Z`);
  return Math.round((today - start) / 86400000);
}

function composeMessage(behavior, tone, anchorLabel) {
  const label = anchorLabel.replace(/_/g, ' ');
  if (behavior === 'medication') {
    return tone === 'direct'
      ? `Take your medication now — anchored to ${label}.`
      : `Quick one: meds time, right around ${label}. No rush, just don't forget.`;
  }
  return tone === 'direct'
    ? `Open NOW — it's ${label} time.`
    : `Hey — it's about ${label} time. What's the smallest useful thing right now?`;
}

async function fireDueTests(sb) {
  const { sendCheckinPush } = require('./scheduler');
  const { data: tests } = await sb.from('nudge_tests').select('*').eq('status', 'active');
  if (!tests?.length) return;

  const userIds = [...new Set(tests.map(t => t.user_id))];
  const { data: users } = await sb.from('users').select('id, push_token, timezone').in('id', userIds);
  const usersById = Object.fromEntries((users || []).map(u => [u.id, u]));

  for (const test of tests) {
    const user = usersById[test.user_id];
    if (!user?.push_token) continue;

    const nowMin = nowMinutesInTz(user.timezone);
    const now = new Date();

    // app_open flips A->B automatically at the day boundary; medication only
    // flips via the checkpoint pass below (a deliberate fallback, not a timer).
    let activeCandidate = test.active_candidate;
    if (test.behavior === 'app_open') {
      const dayIndex = daysBetween(test.started_at, now, user.timezone) + 1;
      activeCandidate = dayIndex <= 3 ? 'A' : 'B';
      if (activeCandidate !== test.active_candidate) {
        await sb.from('nudge_tests').update({ active_candidate: activeCandidate }).eq('id', test.id);
      }
    }

    const anchor = activeCandidate === 'A' ? test.candidate_a : test.candidate_b;
    const anchorTime = activeCandidate === 'A' ? test.candidate_a_time : test.candidate_b_time;
    if (!anchor || !anchorTime) continue;

    const anchorMin = timeToMinutes(anchorTime);
    const { data: profile } = await sb.from('nudge_profiles').select('timing_window_minutes').eq('user_id', test.user_id).single();
    const windowMin = profile?.timing_window_minutes || 30;
    if (nowMin < anchorMin || nowMin >= anchorMin + windowMin) continue;

    const todayKey = dateKeyInTz(now, user.timezone);
    const { data: firedToday } = await sb.from('nudge_events')
      .select('id').eq('test_id', test.id).gte('fired_at', `${todayKey}T00:00:00Z`).limit(1);
    if (firedToday?.length) continue;

    const { data: lastEvent } = await sb.from('nudge_events')
      .select('tone_variant').eq('test_id', test.id).order('fired_at', { ascending: false }).limit(1).single();
    const tone = lastEvent?.tone_variant === 'friendly' ? 'direct' : 'friendly';

    let body = composeMessage(test.behavior, tone, anchor);
    if (test.behavior === 'app_open') {
      try {
        const domainResult = await pickDomainIntervention(sb, test.user_id);
        if (domainResult?.message) body = domainResult.message;
      } catch (e) { /* fall back to the anchor-framed message above */ }
    }

    await sendCheckinPush(test.user_id, user.push_token, test.behavior === 'medication' ? 'Medication time' : 'Check-in time', body);
    await sb.from('nudge_events').insert({
      test_id: test.id, user_id: test.user_id, behavior: test.behavior,
      anchor, tone_variant: tone, window_minutes: windowMin,
    });
  }
}

async function evaluatePendingEvents(sb) {
  const { data: pending } = await sb.from('nudge_events').select('*').is('hit', null);
  if (!pending?.length) return;

  const now = Date.now();
  for (const ev of pending) {
    const windowCloses = new Date(ev.fired_at).getTime() + ev.window_minutes * 60000;
    if (now < windowCloses) continue;

    let hit = false;
    if (ev.behavior === 'app_open') {
      const { data } = await sb.from('events')
        .select('id').eq('user_id', ev.user_id).eq('type', 'session.opened')
        .gte('created_at', ev.fired_at).lte('created_at', new Date(windowCloses).toISOString()).limit(1);
      hit = !!data?.length;
    } else {
      const { data: test } = await sb.from('nudge_tests').select('commitment_id').eq('id', ev.test_id).single();
      if (test?.commitment_id) {
        const { data } = await sb.from('checkins')
          .select('id').eq('commitment_id', test.commitment_id).in('result', ['done', 'partial'])
          .gte('occurred_at', ev.fired_at).lte('occurred_at', new Date(windowCloses).toISOString()).limit(1);
        hit = !!data?.length;
      }
    }

    await sb.from('nudge_events').update({ hit, evaluated_at: new Date().toISOString() }).eq('id', ev.id);
  }
}

async function checkpointTests(sb) {
  const { data: tests } = await sb.from('nudge_tests').select('*').eq('status', 'active');
  if (!tests?.length) return;

  for (const test of tests) {
    const { data: events } = await sb.from('nudge_events')
      .select('*').eq('test_id', test.id).not('hit', 'is', null).order('fired_at', { ascending: true });
    if (!events?.length) continue;

    if (test.behavior === 'app_open') {
      const currentCandidateEvents = events.filter(e => e.anchor === (test.active_candidate === 'A' ? test.candidate_a : test.candidate_b));
      const last6 = currentCandidateEvents.slice(-6);
      const earlyWin = last6.length === 6 && last6.filter(e => e.hit).length >= 5;

      const { data: user } = await sb.from('users').select('timezone').eq('id', test.user_id).single();
      const dayIndex = daysBetween(test.started_at, new Date(), user?.timezone) + 1;

      if (earlyWin || dayIndex > test.test_length_days) {
        const aEvents = events.filter(e => e.anchor === test.candidate_a);
        const bEvents = events.filter(e => e.anchor === test.candidate_b);
        const rate = (arr) => arr.length ? arr.filter(e => e.hit).length / arr.length : 0;
        const rateA = rate(aEvents), rateB = rate(bEvents);

        const winnerIsA = earlyWin ? test.active_candidate === 'A' : (rateA === rateB ? true : rateA > rateB);
        const winRate = earlyWin ? rate(currentCandidateEvents) : Math.max(rateA, rateB);

        if (!earlyWin && rateA < 0.5 && rateB < 0.5) {
          await sb.from('nudge_tests').update({ status: 'awaiting_override' }).eq('id', test.id);
          continue;
        }

        const winnerAnchor = winnerIsA ? test.candidate_a : test.candidate_b;
        const winnerTime = winnerIsA ? test.candidate_a_time : test.candidate_b_time;
        const loserAnchor = winnerIsA ? test.candidate_b : test.candidate_a;
        const loserTime = winnerIsA ? test.candidate_b_time : test.candidate_a_time;
        const winnerEvents = winnerIsA ? aEvents : bEvents;
        const directHits = winnerEvents.filter(e => e.tone_variant === 'direct' && e.hit).length;
        const directTotal = winnerEvents.filter(e => e.tone_variant === 'direct').length;
        const friendlyHits = winnerEvents.filter(e => e.tone_variant === 'friendly' && e.hit).length;
        const friendlyTotal = winnerEvents.filter(e => e.tone_variant === 'friendly').length;
        const directRate = directTotal ? directHits / directTotal : 0;
        const friendlyRate = friendlyTotal ? friendlyHits / friendlyTotal : 0;

        const today = new Date().toISOString().slice(0, 10);
        await sb.from('nudge_profiles').upsert({
          user_id: test.user_id,
          primary_anchor: winnerAnchor, primary_anchor_time: winnerTime,
          backup_anchor: loserAnchor, backup_anchor_time: loserTime,
          notification_style: directRate > friendlyRate ? 'direct' : 'friendly',
          confidence_score: winRate,
          established_at: today, last_validated_at: today,
        }, { onConflict: 'user_id' });
        await sb.from('users').update({ checkin_time: winnerTime }).eq('id', test.user_id);
        await sb.from('nudge_tests').update({ status: 'locked_in', result_anchor: winnerAnchor }).eq('id', test.id);
      }
      continue;
    }

    // medication: sequential 3-day checkpoints, no A/B split, no early win --
    // just "is this anchor working" (spec §3.5-3.6).
    const { data: user } = await sb.from('users').select('timezone').eq('id', test.user_id).single();
    const dayIndex = daysBetween(test.started_at, new Date(), user?.timezone) + 1;
    if (dayIndex < test.test_length_days) continue;

    // Filter to the currently active candidate's own events -- if this test
    // already fell back from A to B, B's events shouldn't be diluted by A's
    // (different anchor, different physical reality) tail end.
    const activeAnchor = test.active_candidate === 'A' ? test.candidate_a : test.candidate_b;
    const activeEvents = events.filter(e => e.anchor === activeAnchor);
    const last3 = activeEvents.slice(-3);
    const hitRate = last3.length ? last3.filter(e => e.hit).length / last3.length : 0;

    if (hitRate >= 2 / 3) {
      const confirmedAnchor = test.active_candidate === 'A' ? test.candidate_a : test.candidate_b;
      await sb.from('nudge_tests').update({ status: 'confirmed', result_anchor: confirmedAnchor }).eq('id', test.id);
    } else if (test.active_candidate === 'A' && test.candidate_b) {
      await sb.from('nudge_tests').update({
        active_candidate: 'B', started_at: new Date().toISOString().slice(0, 10),
      }).eq('id', test.id);
    } else {
      await sb.from('nudge_tests').update({ status: 'escalated' }).eq('id', test.id);
    }
  }
}

async function runNudgeTestsTick(sb) {
  await fireDueTests(sb);
  await evaluatePendingEvents(sb);
  await checkpointTests(sb);
}

module.exports = {
  resolveCandidates, startAppOpenTest, establishMedication, overrideAnchor, getStatus, runNudgeTestsTick,
};
