/**
 * Onboarding — first launch only. Adaptive Nudge Engine spec: seed 2
 * candidate anchors from 2 tap-only questions (daily anchor, energy window)
 * instead of testing 6+ blind, then confirm/adjust the inferred cue time --
 * same "accept the default or pick a different one" shape the old
 * checkin-time step used, just driving the anchor test instead of a fixed
 * daily time. Zero typing required; "Something else" is the one optional
 * exception, same as the spec allows for Q1.
 *
 * STEP_IDENTITY (after the nudge-timing steps) seeds the Adaptive Allocation
 * Engine's identity spectrum -- relative priority (1-5, tap +/- only, no
 * typing) per want axis, not precise hour targets. This is a proxy for
 * desired_hours_per_week until the Allocation Engine itself exists to
 * translate it; see migration 014_identity_priorities.sql. It's also the
 * last onboarding step now -- the old pain-point question (Step 5) was
 * removed as redundant with "I'm Stuck" (AddPainPointScreen), which asks
 * the identical question at the moment someone actually needs it, not
 * hypothetically before they've used the app at all. Registering with no
 * pain_point_type falls through to the same "not sure yet" default
 * (seedDomainsForUser) the picker's third option used to call explicitly.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { registerUser } from '../api/engine';
import { setUser, markOnboarded } from '../store/session';
import { flushQueue } from '../store/queue';
import { showAlert } from '../utils/alert';

WebBrowser.maybeCompleteAuthSession();

const STEP_INTRO = 0;
const STEP_ANCHOR = 1;
const STEP_ENERGY = 2;
const STEP_CONFIRM_TIME = 3;
const STEP_IDENTITY = 4;
const TOTAL_STEPS = 4;

// Mirrors engine/src/engine/nudgeEngine.js's ANCHOR_TIMES -- kept in sync by
// hand since it's a small, stable display default, not logic the client
// needs to compute authoritatively (the engine is the source of truth for
// what candidate actually gets tested).
const ANCHORS = [
  { key: 'wake_alarm', label: 'Wake alarm', time: '07:00' },
  { key: 'coffee', label: 'Coffee', time: '07:30' },
  { key: 'shower', label: 'Shower', time: '07:45' },
  { key: 'breakfast', label: 'Breakfast', time: '08:00' },
  { key: 'commute', label: 'Commute', time: '08:30' },
  { key: 'lunch', label: 'Lunch', time: '12:30' },
  { key: 'brushing_teeth', label: 'Brushing teeth', time: '21:30' },
  { key: 'bedtime', label: 'Bedtime', time: '22:30' },
];
const ENERGY_OPTIONS = [
  { key: 'morning', label: 'Morning' },
  { key: 'midday', label: 'Midday' },
  { key: 'evening', label: 'Evening' },
];
const DEFAULT_TIME_BY_ENERGY = { morning: '08:00', midday: '13:00', evening: '19:00' };

// Adaptive Allocation Engine's identity spectrum (engine-specs/
// adaptive-allocation-engine-v1.1.md §2.3) minus Foundation -- Foundation's
// desired value is prescribed (BLOCK_GUIDELINES' healthy-range max), not
// user-set, so it has no place in a "how much do you want this" question.
// 1-5 relative priority, no typing, same tap-only shape as the rest of
// onboarding -- a proxy for desired_hours_per_week until the Allocation
// Engine exists to translate it (see migration 014's comment).
const IDENTITY_AXES = [
  { key: 'relationships', label: 'Relationships' },
  { key: 'achievement', label: 'Achievement' },
  { key: 'finance', label: 'Finance' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'recreation', label: 'Recreation' },
];
const DEFAULT_IDENTITY_PRIORITIES = { relationships: 3, achievement: 3, finance: 3, contribution: 3, recreation: 3 };

// Foundation gets a status question, not a priority weight -- "how much do
// you want this" doesn't apply to sleep/meals/movement the way it does to
// the five want axes above. This just tells the Allocation Engine's gap
// tracking (v1.3) whether to start Foundation's flex-hour competition
// assuming a real gap from week one, instead of guessing cold.
const FOUNDATION_STATUS_OPTIONS = [
  { key: 'solid', label: "It's solid" },
  { key: 'rebuilding', label: 'I need to rebuild it' },
];

// Accepts "630", "1830", "6", "18:30" etc. and normalizes to "HH:MM" — no ":"
// key needed. 1-2 digits = hour only ("6" -> 06:00); 3-4 digits = hour+minutes,
// last two digits are minutes ("600" -> 06:00, "1830" -> 18:30).
function normalizeTime(raw) {
  if (!raw) return raw;
  if (raw.includes(':')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  const hours = Math.min(parseInt(digits.length <= 2 ? digits : digits.slice(0, -2), 10) || 0, 23);
  const mins = Math.min(digits.length <= 2 ? 0 : parseInt(digits.slice(-2), 10) || 0, 59);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDisplayTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(STEP_INTRO);
  const [loading, setLoading] = useState(false);

  // Google's stable per-account ID becomes external_ref, so the same person
  // always maps to the same backend user record across reinstalls/devices —
  // this is the "global user identity" the engine's data model is built around.
  const [googleProfile, setGoogleProfile] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [request, response, promptAsync] = Google.useAuthRequest({
    // On web, expo-auth-session's own invariant check throws synchronously
    // if webClientId is falsy -- unlike native, there's no other client id it
    // could fall back to, and it throws before our own "not configured, dev
    // fallback" branch below ever gets a chance to hide the button. A
    // placeholder string prevents the crash; it's harmless because the
    // button that would ever use it stays hidden until a real web client id
    // is configured (see googleConfigured below).
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'not-configured',
    // Real Android OAuth client (package name + SHA-1 of the EAS build's
    // signing cert) — required for a proper fixed-scheme redirect instead of
    // Expo Go's dynamic exp:// address, which Google can't accept a stable
    // registration for. Falls back to the web client id if not set yet, so
    // the app doesn't crash before this exists.
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    setSigningIn(true);
    fetch('https://www.googleapis.com/userinfo/v2/me', {
      headers: { Authorization: `Bearer ${response.authentication.accessToken}` },
    })
      .then(r => r.json())
      .then(profile => { setGoogleProfile(profile); setStep(STEP_ANCHOR); })
      .catch(() => showAlert('Sign-in failed', 'Could not fetch your Google profile. Try again.'))
      .finally(() => setSigningIn(false));
  }, [response]);

  const [anchorKey, setAnchorKey] = useState(null);
  const [customAnchor, setCustomAnchor] = useState('');
  const [showCustomAnchor, setShowCustomAnchor] = useState(false);
  const [energyWindow, setEnergyWindow] = useState(null);

  const [anchorTime, setAnchorTime] = useState(DEFAULT_TIME_BY_ENERGY.evening);
  const [pickingTime, setPickingTime] = useState(false);
  const [customTime, setCustomTime] = useState('');

  const [identityPriorities, setIdentityPriorities] = useState(DEFAULT_IDENTITY_PRIORITIES);
  const [foundationStatus, setFoundationStatus] = useState(null);

  function adjustPriority(axisKey, delta) {
    setIdentityPriorities(p => ({ ...p, [axisKey]: Math.max(1, Math.min(5, p[axisKey] + delta)) }));
  }

  function handleCustomTimeChange(text) {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setCustomTime(digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`);
  }

  function chooseAnchor(anchor) {
    setAnchorKey(anchor.key);
    setShowCustomAnchor(false);
    setStep(STEP_ENERGY);
  }

  function chooseEnergy(energy) {
    setEnergyWindow(energy.key);
    const known = ANCHORS.find(a => a.key === anchorKey);
    setAnchorTime(known?.time || DEFAULT_TIME_BY_ENERGY[energy.key]);
    setStep(STEP_CONFIRM_TIME);
  }

  // No pain-point question here anymore -- with no pain_point_type sent,
  // engine/src/routes/users.js falls through to seedDomainsForUser, the same
  // "not sure yet" default the old picker's third option called explicitly.
  // A real pain point is captured later, from "I'm Stuck", at the moment
  // someone actually has one -- not guessed at during onboarding.
  async function finish() {
    setLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      // Google profile id is the durable identity; the random fallback only
      // applies if EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID isn't configured yet, so
      // dev/testing isn't blocked on OAuth setup.
      const ref = googleProfile ? `google_${googleProfile.id}` : `now_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const anchorAnswer = anchorKey ? ANCHORS.find(a => a.key === anchorKey)?.label : customAnchor.trim();
      const user = await registerUser(ref, tz, undefined, undefined, undefined, {
        anchor_answer: anchorAnswer,
        anchor_time: anchorTime,
        energy_window: energyWindow,
        delivery_method: 'push',
        identity_priorities: { ...identityPriorities, foundation_status: foundationStatus || 'solid' },
      });
      await setUser(user);
      await markOnboarded();
      await flushQueue();
      onComplete(user);
    } catch (e) {
      showAlert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  // On native, Android is the actual target platform -- webClientId is only
  // ever a fallback there (see the useAuthRequest call above), so gating on
  // it alone was wrong: it hid real Sign-In even when the Android client id
  // was correctly configured. On web there is no Android client id to fall
  // back to, so only a real web client id counts.
  const googleConfigured = Platform.OS === 'web'
    ? !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    : !!(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);

  if (step === STEP_INTRO) return (
    <View style={s.center}>
      <Text style={s.brandName}>DESIRED</Text>
      <Text style={s.brandTagline}>Identity to Reality</Text>
      <Text style={s.headline}>What do I do{'\n'}right now?</Text>
      <Text style={s.sub}>No task list. No productivity system.{'\n'}Just the next small step — toward who you're{'\n'}actually trying to become.</Text>
      {googleConfigured ? (
        <TouchableOpacity style={s.btn} disabled={!request || signingIn} onPress={() => promptAsync()}>
          {signingIn ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sign in with Google →</Text>}
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity style={s.btn} onPress={() => setStep(STEP_ANCHOR)}>
            <Text style={s.btnText}>Let's go →</Text>
          </TouchableOpacity>
          <Text style={s.devNote}>Google sign-in not configured — continuing without a persistent account (dev/testing only).</Text>
        </>
      )}
    </View>
  );

  if (step === STEP_ANCHOR) return (
    <ScrollView contentContainerStyle={s.centerScroll}>
      <Text style={s.stepLabel}>Step 1 of {TOTAL_STEPS}</Text>
      <Text style={s.title}>What's something you do{'\n'}every single day,{'\n'}no matter what?</Text>
      <View style={s.chipGrid}>
        {ANCHORS.map(a => (
          <TouchableOpacity key={a.key} style={s.chip} onPress={() => chooseAnchor(a)}>
            <Text style={s.chipText}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!showCustomAnchor ? (
        <TouchableOpacity style={s.linkBtn} onPress={() => setShowCustomAnchor(true)}>
          <Text style={s.linkBtnText}>Something else</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.customAnchorRow}>
          <TextInput
            style={s.input}
            value={customAnchor}
            onChangeText={setCustomAnchor}
            placeholder="e.g. walking the dog"
            placeholderTextColor="#475569"
            autoFocus
          />
          <TouchableOpacity
            style={[s.btn, !customAnchor.trim() && s.btnDisabled]}
            disabled={!customAnchor.trim()}
            onPress={() => { setAnchorKey(null); setStep(STEP_ENERGY); }}
          >
            <Text style={s.btnText}>Continue →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );

  if (step === STEP_ENERGY) return (
    <View style={s.center}>
      <Text style={s.stepLabel}>Step 2 of {TOTAL_STEPS}</Text>
      <Text style={s.title}>When do you have{'\n'}the most mental energy?</Text>
      {ENERGY_OPTIONS.map(e => (
        <TouchableOpacity key={e.key} style={s.btn} onPress={() => chooseEnergy(e)}>
          <Text style={s.btnText}>{e.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (step === STEP_CONFIRM_TIME) return (
    <View style={s.center}>
      <Text style={s.stepLabel}>Step 3 of {TOTAL_STEPS}</Text>
      <Text style={s.title}>We'll try nudging you{'\n'}around{'\n'}{formatDisplayTime(anchorTime)}.</Text>
      <Text style={s.hint}>Good?</Text>

      {!pickingTime ? (
        <>
          <TouchableOpacity style={s.btn} onPress={() => setStep(STEP_IDENTITY)}>
            <Text style={s.btnText}>Sounds good →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setPickingTime(true)}>
            <Text style={s.linkBtnText}>Pick a different time</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={s.input}
            value={customTime}
            onChangeText={handleCustomTimeChange}
            keyboardType="number-pad"
            placeholder="e.g. 730 for 7:30 AM"
            placeholderTextColor="#475569"
            autoFocus
          />
          <TouchableOpacity
            onPress={() => {
              const t = normalizeTime(customTime.trim()) || anchorTime;
              setAnchorTime(t);
              setStep(STEP_IDENTITY);
            }}
            style={s.btn}
          >
            <Text style={s.btnText}>Set and continue →</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  if (step === STEP_IDENTITY) return (
    <ScrollView contentContainerStyle={s.centerScroll}>
      <Text style={s.stepLabel}>Step 4 of {TOTAL_STEPS}</Text>
      <Text style={s.title}>Where are you{'\n'}starting from?</Text>

      <View style={s.priorityList}>
        <View style={s.priorityRow}>
          <Text style={s.priorityLabel}>Foundation</Text>
          <Text style={s.foundationHint}>sleep, meals, movement</Text>
        </View>
        <View style={s.foundationOptions}>
          {FOUNDATION_STATUS_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[s.foundationOptionBtn, foundationStatus === opt.key && s.foundationOptionBtnActive]}
              onPress={() => setFoundationStatus(opt.key)}
            >
              <Text style={[s.foundationOptionText, foundationStatus === opt.key && s.foundationOptionTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={[s.title, { fontSize: 20, marginTop: 8 }]}>What matters most{'\n'}to you right now?</Text>
      <Text style={s.hint}>Tap + or − for each. No wrong answer.</Text>

      <View style={s.priorityList}>
        {IDENTITY_AXES.map(axis => (
          <View key={axis.key} style={s.priorityRow}>
            <Text style={s.priorityLabel}>{axis.label}</Text>
            <View style={s.priorityControl}>
              <TouchableOpacity
                style={s.priorityBtn}
                disabled={identityPriorities[axis.key] <= 1}
                onPress={() => adjustPriority(axis.key, -1)}
              >
                <Text style={s.priorityBtnText}>−</Text>
              </TouchableOpacity>
              <View style={s.priorityDots}>
                {[1, 2, 3, 4, 5].map(n => (
                  <View key={n} style={[s.priorityDot, n <= identityPriorities[axis.key] && s.priorityDotFilled]} />
                ))}
              </View>
              <TouchableOpacity
                style={s.priorityBtn}
                disabled={identityPriorities[axis.key] >= 5}
                onPress={() => adjustPriority(axis.key, 1)}
              >
                <Text style={s.priorityBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} disabled={loading} onPress={finish}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Finish →</Text>}
      </TouchableOpacity>
    </ScrollView>
  );

  return null;
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 28 },
  centerScroll: { flexGrow: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 28, paddingTop: 64 },
  brandName: { fontSize: 13, fontWeight: '900', color: '#818cf8', letterSpacing: 3, marginBottom: 2 },
  brandTagline: { fontSize: 12, color: '#64748b', marginBottom: 28 },
  headline: { fontSize: 40, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 46, marginBottom: 20 },
  sub: { fontSize: 15, color: '#94a3b8', textAlign: 'center', lineHeight: 22, marginBottom: 40 },
  devNote: { fontSize: 11, color: '#f59e0b', textAlign: 'center', marginTop: 14, lineHeight: 16 },
  stepLabel: { fontSize: 11, fontWeight: '700', color: '#6366f1', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 34, marginBottom: 8 },
  hint: { fontSize: 15, color: '#64748b', marginBottom: 32 },
  input: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, fontSize: 16, color: '#f1f5f9', marginBottom: 16, borderWidth: 1, borderColor: '#334155', width: 240, textAlign: 'center' },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 10, minWidth: 220 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkBtn: { paddingVertical: 14 },
  linkBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 20, maxWidth: 340 },
  chip: { backgroundColor: '#1e293b', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#334155' },
  chipText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  customAnchorRow: { alignItems: 'center', marginTop: 4 },
  priorityList: { width: '100%', maxWidth: 340, marginBottom: 24 },
  priorityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  priorityLabel: { fontSize: 15, fontWeight: '700', color: '#f1f5f9' },
  priorityControl: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priorityBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  priorityBtnText: { color: '#818cf8', fontSize: 16, fontWeight: '800' },
  priorityDots: { flexDirection: 'row', gap: 4 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  priorityDotFilled: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  foundationHint: { fontSize: 11, color: '#64748b' },
  foundationOptions: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  foundationOptionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1e293b', alignItems: 'center' },
  foundationOptionBtnActive: { borderColor: '#6366f1', backgroundColor: '#312e81' },
  foundationOptionText: { fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  foundationOptionTextActive: { color: '#e0e7ff' },
});
