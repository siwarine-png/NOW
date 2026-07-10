/**
 * Engine API client for the NOW app.
 * All logic lives server-side; this file only wraps fetch calls.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENGINE_URL = process.env.EXPO_PUBLIC_ENGINE_URL || 'https://api.example.com';
const ENGINE_KEY = process.env.EXPO_PUBLIC_ENGINE_KEY || '';

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${ENGINE_KEY}`,
};

async function request(method, path, body, version = 'v1') {
  const res = await fetch(`${ENGINE_URL}/${version}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Users ──────────────────────────────────────────────────────────────────
// anchorInfo (optional): { anchor_answer, anchor_time, energy_window, delivery_method,
// pain_point_type, pain_point_title } -- starts the Adaptive Nudge Engine's
// app-open test AND creates the pain-point commitment for a genuinely new user.
export async function registerUser(external_ref, timezone, wake_time, sleep_time, checkin_time, anchorInfo) {
  return request('POST', '/users', { external_ref, timezone, wake_time, sleep_time, checkin_time, ...(anchorInfo || {}) });
}

// ── Adaptive Nudge Engine ────────────────────────────────────────────────
export async function getBehaviorStatus(user_id, behavior) {
  const params = new URLSearchParams({ user_id });
  return request('GET', `/behaviors/${behavior}/status?${params}`);
}

export async function establishBehavior(user_id, behavior, frequency = 'daily') {
  return request('POST', '/behaviors/establish', { user_id, behavior, frequency });
}

export async function overrideNudgeAnchor(user_id, behavior, anchor, anchor_time) {
  return request('POST', '/nudge/override', { user_id, behavior, anchor, anchor_time });
}

// Permanent, server-side account deletion — everything tied to user_id is
// erased, not just the local cache. See engine/src/routes/users.js.
export async function deleteAccount(user_id) {
  return request('DELETE', `/users/${user_id}`);
}

export async function updateUser(user_id, updates) {
  return request('PATCH', `/users/${user_id}`, updates);
}

// ── Interventions ──────────────────────────────────────────────────────────
export async function getInterventionNow(user_id, energy = null) {
  const params = new URLSearchParams({ user_id });
  if (energy !== null) params.set('energy', String(energy));
  return request('GET', `/interventions/now?${params}`);
}

// ── Today (full-day schedule, not just the single focused card) ────────────
export async function getTodaySchedule(user_id) {
  const params = new URLSearchParams({ user_id });
  return request('GET', `/commitments/today?${params}`);
}

// ── Commitments ──────────────────────────────────────────────────────────
// Used by the "I'm Stuck" tab to add a new pain point at any time (not just
// once at onboarding) -- same shape engine/src/routes/users.js builds for
// pain_point_type at registration, just callable again later.
export async function createCommitment(payload) {
  return request('POST', '/commitments', payload);
}

// ── Check-ins ──────────────────────────────────────────────────────────────
export async function postCheckin(commitment_id, result, energy, intervention_id) {
  return request('POST', '/checkins', {
    commitment_id,
    result,
    energy,
    context: { intervention_id, source: 'now_app' },
  });
}

// Snooze is its own first-class event (not a "partial" done) — it suppresses
// this commitment for `minutes` (or the rest of today if minutes is null),
// then the same intervention can fire again. See engine/routes/checkins.js.
export async function postSnooze(commitment_id, minutes, intervention_id) {
  return request('POST', '/checkins', {
    commitment_id,
    result: 'snoozed',
    energy: null,
    context: { snooze_minutes: minutes, intervention_id, source: 'now_app' },
  });
}

// Engine v8 domain system — check in against an outcome_equivalent instead of
// a commitment. No intervention_id: the domain path doesn't persist an
// `interventions` row (see engine/routes/interventions.js).
export async function postEquivalentCheckin(equivalent_id, result, energy = null) {
  return request('POST', '/checkins', {
    equivalent_id,
    result,
    energy,
    context: { source: 'now_app' },
  });
}

// ── Identity check-ins (Adaptive Allocation Engine's experience-sampling
// window, engine/src/engine/identityCheckin.js) — mounted under /v2, not
// /v1, per the v1 endpoint-count freeze (MVP1-SPEC-v3.md). ─────────────────
export async function getIdentityCheckinStatus(user_id) {
  const params = new URLSearchParams({ user_id });
  return request('GET', `/identity-checkins/status?${params}`, undefined, 'v2');
}

export async function postIdentityCheckin(user_id, identity_axis) {
  return request('POST', '/identity-checkins', { user_id, identity_axis }, 'v2');
}

// "Not sure" path — Groq suggests which of the same 6 axes a free-text
// description belongs to. Suggestion only; nothing is recorded until the
// user taps Accept, which calls postIdentityCheckin above like any other pick.
export async function suggestIdentityAxis(text) {
  return request('POST', '/identity-checkins/suggest-axis', { text }, 'v2');
}
