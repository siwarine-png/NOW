const { Router } = require('express');
const sb = require('../db/client');
const { log } = require('../engine/events');
const { seedDomainsForUser } = require('../engine/seed');
const { startAppOpenTest } = require('../engine/nudgeEngine');

const router = Router();

function addMinutesToTime(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// POST /users — register end user
router.post('/', async (req, res) => {
  const {
    external_ref, timezone, wake_time, sleep_time, checkin_time,
    anchor_answer, anchor_time, energy_window, delivery_method,
    pain_point_type, pain_point_title, identity_priorities,
  } = req.body;
  if (!external_ref) return res.status(400).json({ error: 'external_ref required' });

  // Checked before the upsert so we only seed the starter domain library once,
  // for genuinely new users — an upsert alone can't tell insert from update,
  // and re-seeding on every Google re-login would duplicate the whole pool.
  const { data: existing } = await sb
    .from('users').select('id')
    .eq('app_id', req.app_id).eq('external_ref', external_ref).single();
  const isNewUser = !existing;

  const wt = wake_time || '07:00', st = sleep_time || '23:00', ct = checkin_time || '18:00';
  const { data, error } = await sb
    .from('users')
    // Quiet hours default to the mirror of the real wake/sleep answer (asleep =
    // quiet) rather than the schema's generic 22:00-07:00 default, since nothing
    // in onboarding captures quiet hours separately yet.
    .upsert({ app_id: req.app_id, external_ref, timezone: timezone || 'UTC',
               wake_time: wt, sleep_time: st, quiet_start: st, quiet_end: wt, checkin_time: ct,
               ...(identity_priorities ? { identity_priorities } : {}),
               // Only a genuinely new user starts the 7-day identity-checkin
               // sampling window -- same re-login guard as domain seeding
               // and the app-open nudge test just below.
               ...(isNewUser ? { identity_checkin_started_at: new Date().toISOString() } : {}) },
             { onConflict: 'app_id,external_ref' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Start with the pain point, not the generic domain library: a stated
  // pain point becomes one real, immediately-actionable commitment. The
  // 5-domain starter library is now an explicit fallback ("not sure yet"),
  // not the default for everyone regardless of what they actually need.
  if (isNewUser) {
    if (pain_point_type === 'medicine') {
      await sb.from('commitments').insert({
        user_id: data.id, title: 'Take medication', next_action: 'Take your medication',
        cadence: 'daily',
        window_start: anchor_time || null,
        window_end: anchor_time ? addMinutesToTime(anchor_time, 30) : null,
        priority_tier: 'critical', // see rules.js R9_critical_override
      });
    } else if (pain_point_type === 'custom' && pain_point_title) {
      await sb.from('commitments').insert({
        user_id: data.id, title: pain_point_title, next_action: null, // R4_ambiguous_action asks for the first step
        cadence: 'daily',
        window_start: anchor_time || null,
        window_end: anchor_time ? addMinutesToTime(anchor_time, 60) : null,
      });
    } else {
      await seedDomainsForUser(sb, data.id);
    }
  }

  // Adaptive Nudge Engine: only a genuinely new user starts a fresh app-open
  // test -- a re-login shouldn't restart a test that's already in progress
  // or already locked in, same reasoning as the domain-seeding guard above.
  if (isNewUser && anchor_answer) {
    try {
      await startAppOpenTest(sb, data.id, anchor_answer, anchor_time, energy_window, delivery_method);
    } catch (e) {
      console.error('[users] failed to start app-open nudge test', e.message);
    }
  }

  log(req.app_id, data.id, 'user.registered', { external_ref, timezone, wake_time: wt, sleep_time: st, checkin_time: ct, anchor_answer, energy_window, pain_point_type, seeded: isNewUser });
  res.status(201).json(data);
});

// PATCH /users/:id — update timezone / quiet hours
router.patch('/:id', async (req, res) => {
  const allowed = ['timezone', 'wake_time', 'sleep_time', 'quiet_start', 'quiet_end', 'checkin_time', 'push_token', 'web_push_subscription', 'identity_priorities'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const { data, error } = await sb
    .from('users')
    .update(updates)
    .eq('id', req.params.id)
    .eq('app_id', req.app_id)
    .select()
    .single();

  // A real Postgres/PostgREST error (bad payload, RLS, etc.) was previously
  // collapsed into the same generic "Not found" as a genuinely missing row,
  // which is actively misleading -- "Not found" told a user their account
  // didn't exist when the real problem might be something else entirely.
  // PGRST116 is PostgREST's actual "0 (or >1) rows matched .single()" code --
  // only that case is a real 404; anything else gets its real message back.
  if (error) {
    console.error('[users] PATCH failed', { id: req.params.id, updates, error: error.message, code: error.code });
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: error.message, code: error.code });
  }
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

// DELETE /users/:id — permanently erase a user and everything tied to them.
// commitments cascade to their own checkins/interventions automatically, but
// equivalent_id on checkins is ON DELETE SET NULL (deliberately, so deleting
// one equivalent during normal use doesn't erase history) -- a full account
// delete has to remove those checkins explicitly instead of relying on that.
// events.user_id has no cascade at all, so it must go first or the final
// delete on `users` fails on a foreign-key violation.
router.delete('/:id', async (req, res) => {
  const { data: user } = await sb
    .from('users').select('id').eq('id', req.params.id).eq('app_id', req.app_id).single();
  if (!user) return res.status(404).json({ error: 'Not found' });

  const { data: equivalents } = await sb.from('outcome_equivalents').select('id').eq('user_id', user.id);
  const equivalentIds = (equivalents || []).map(e => e.id);
  if (equivalentIds.length) await sb.from('checkins').delete().in('equivalent_id', equivalentIds);

  await sb.from('events').delete().eq('user_id', user.id);
  await sb.from('commitments').delete().eq('user_id', user.id); // cascades checkins + interventions
  await sb.from('outcome_equivalents').delete().eq('user_id', user.id);
  await sb.from('domain_metrics').delete().eq('user_id', user.id);

  const { error } = await sb.from('users').delete().eq('id', user.id);
  if (error) return res.status(500).json({ error: error.message });

  res.status(204).end();
});

module.exports = router;
