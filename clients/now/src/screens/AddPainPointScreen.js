/**
 * "Something new to track" — reached via the secondary link at the bottom
 * of StuckScreen (the "I'm Stuck" tab's primary action is now a momentary
 * unsticking triage, not this).
 *
 * No preset options anymore (the old "Remembering medicine" button is
 * gone) -- straight to a blank input with a short guiding hint, since a
 * fixed list of presets implicitly narrows what people think they're
 * "allowed" to type. Medication reminders specifically still exist, just
 * via the Adaptive Nudge Engine's own reuse flow in Settings ("Remind me
 * to take medication"), which is the actually-adherence-aware path for
 * that -- this screen is only ever the 6-axis want/need spectrum now.
 *
 * STEP_AXIS tags the new commitment with an Adaptive Allocation Engine
 * identity_axis (migration 016) -- one tap, no typing.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { createCommitment, getStalledProjects } from '../api/engine';
import { showAlert } from '../utils/alert';

const STEP_CHECKING = -1;
const STEP_STALE_NUDGE = -2;
const STEP_TITLE = 0;
const STEP_AXIS = 1;
const STEP_URGENCY = 2;
const STEP_RECURRENCE = 3;
const STEP_TIME = 4;
const STEP_TIME_MEANING = 5;
const STEP_DURATION = 6;

const DURATIONS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
];

const AXES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'achievement', label: 'Achievement' },
  { key: 'finance', label: 'Finance' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'recreation', label: 'Recreation' },
];

function addMinutesToTime(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function defaultTime() {
  const d = new Date();
  const roundedMin = d.getMinutes() < 30 ? 30 : 0;
  const hour = (d.getMinutes() < 30 ? d.getHours() : d.getHours() + 1) % 24;
  return `${String(hour).padStart(2, '0')}:${String(roundedMin).padStart(2, '0')}`;
}

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

// secondaryActionLabel/onSecondaryAction: optional, shown only on the blank
// STEP_TITLE screen -- used by OnboardingScreen's day-1 "add as many real
// things as apply to you, or nothing at all" open loop (see its own header
// comment) to offer an explicit way out at exactly the point where someone
// either has nothing more to add, or nothing to begin with. Normal usage
// from the New tab doesn't pass these and renders exactly as before.
export default function AddPainPointScreen({ user, onCreated, secondaryActionLabel, onSecondaryAction }) {
  const [step, setStep] = useState(STEP_CHECKING);
  const [staleProjects, setStaleProjects] = useState([]);
  const [customTitle, setCustomTitle] = useState('');
  const [identityAxis, setIdentityAxis] = useState(null);
  const [cadence, setCadence] = useState('daily');
  const [time, setTime] = useState(defaultTime());
  const [pickingTime, setPickingTime] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [loading, setLoading] = useState(false);

  // Soft nudge, not a gate -- every path out of here (including a failed
  // check) lands on the normal STEP_TITLE flow; this only ever adds one
  // extra screen in front of it, never blocks adding something new.
  useEffect(() => {
    if (!user?.id) { setStep(STEP_TITLE); return; }
    getStalledProjects(user.id)
      .then(({ stalled }) => {
        setStaleProjects(stalled || []);
        setStep(stalled?.length ? STEP_STALE_NUDGE : STEP_TITLE);
      })
      .catch(() => setStep(STEP_TITLE));
  }, [user?.id]);

  function continueFromTitle() {
    if (!customTitle.trim()) return;
    setStep(STEP_AXIS);
  }

  function chooseAxis(axisKey) {
    setIdentityAxis(axisKey);
    setStep(STEP_URGENCY);
  }

  function chooseCadence(value) {
    setCadence(value);
    setStep(STEP_TIME);
  }

  function handleCustomTimeChange(text) {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setCustomTime(digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`);
  }

  function resetAll() {
    setStep(STEP_TITLE);
    setCustomTitle('');
    setIdentityAxis(null);
    setCadence('daily');
    setPickingTime(false);
    setCustomTime('');
    setTime(defaultTime());
  }

  async function createAndReset(payload) {
    if (!user?.id) return;
    setLoading(true);
    try {
      await createCommitment({
        user_id: user.id, title: customTitle.trim(), next_action: null,
        cadence, priority_tier: 'normal', identity_axis: identityAxis,
        ...payload,
      });
      resetAll();
      onCreated?.();
    } catch (e) {
      showAlert("Couldn't add that", e.message);
    } finally {
      setLoading(false);
    }
  }

  // "Right now" skips scheduling entirely -- priority_tier: 'critical' is
  // the same mechanism a medication reminder uses (R9_critical_override,
  // engine/src/engine/rules.js): it always surfaces first on NOW, ahead of
  // the domain rotation and everything else, checked before either. No
  // window_start means the rule matches immediately regardless of time of
  // day, which is exactly "can't wait" -- asking for a scheduled time here
  // would be friction against the thing that was just declared urgent.
  function submitUrgent() {
    return createAndReset({ cadence: 'once', priority_tier: 'critical', window_start: null, window_end: null });
  }

  // {time} is when to start — the plain "we'll nudge you around then" case.
  function submit(finalTime) {
    return createAndReset({ window_start: finalTime, window_end: addMinutesToTime(finalTime, 60) });
  }

  // {deadlineTime} is when it must be DONE by, not when to start -- back the
  // notification off by the estimated duration so there's actually enough
  // time left to finish, instead of nudging at the deadline itself. Also
  // sets the real `deadline` field (unused by the plain start-time path)
  // so R7_deadline_proximity's own escalation can pick this up too.
  function submitWithDeadline(deadlineTime, durationMinutes) {
    const startTime = addMinutesToTime(deadlineTime, -durationMinutes);
    const [dh, dm] = deadlineTime.split(':').map(Number);
    const deadlineDate = new Date();
    deadlineDate.setHours(dh, dm, 0, 0);
    return createAndReset({
      window_start: startTime, window_end: deadlineTime,
      deadline: deadlineDate.toISOString(),
    });
  }

  if (step === STEP_CHECKING) return (
    <View style={s.center}><ActivityIndicator color="#6366f1" /></View>
  );

  if (step === STEP_STALE_NUDGE) return (
    <View style={s.center}>
      <Text style={s.title}>Before adding{'\n'}something new...</Text>
      <Text style={s.hint}>These haven't moved in a while:</Text>
      <View style={s.staleList}>
        {staleProjects.map(p => (
          <View key={p.commitment_id} style={s.staleRow}>
            <Text style={s.staleTitle}>{p.title}</Text>
            <Text style={s.staleDays}>quiet {p.days_stalled}d</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity style={s.btn} onPress={() => setStep(STEP_TITLE)}>
        <Text style={s.btnText}>Continue anyway →</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_AXIS) return (
    <View style={s.center}>
      <Text style={s.title}>Which part of your life{'\n'}does this belong to?</Text>
      <View style={s.chipGrid}>
        {AXES.map(a => (
          <TouchableOpacity key={a.key} style={s.chip} onPress={() => chooseAxis(a.key)}>
            <Text style={s.chipText}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (step === STEP_URGENCY) return (
    <View style={s.center}>
      <Text style={s.title}>How urgent{'\n'}is this?</Text>
      <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} disabled={loading} onPress={submitUrgent}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Right now — can't wait</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => setStep(STEP_RECURRENCE)} disabled={loading}>
        <Text style={s.btnText}>Not urgent — I'll schedule it</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_RECURRENCE) return (
    <View style={s.center}>
      <Text style={s.title}>Is this a one-time thing,{'\n'}or something you'll do{'\n'}regularly?</Text>
      <TouchableOpacity style={s.btn} onPress={() => chooseCadence('once')}>
        <Text style={s.btnText}>Just once</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseCadence('daily')}>
        <Text style={s.btnText}>Every day</Text>
      </TouchableOpacity>
      {/* Without this, something genuinely monthly (e.g. "send provision
          budget to sister") had no correct option and defaulted to 'daily' --
          nagging every single day instead of going quiet once done until
          next month. Reuses the same time-of-day question below; 'monthly'
          just changes when it resets (see stats.js's cadence-aware period). */}
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseCadence('monthly')}>
        <Text style={s.btnText}>Once a month</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_TIME) return (
    <View style={s.center}>
      <Text style={s.title}>What time{'\n'}are we talking about?{'\n'}{formatDisplayTime(time)}</Text>
      <Text style={s.hint}>Good?</Text>

      {!pickingTime ? (
        <>
          <TouchableOpacity style={s.btn} onPress={() => setStep(STEP_TIME_MEANING)}>
            <Text style={s.btnText}>Sounds good →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setPickingTime(true)}>
            <Text style={s.linkBtnText}>Pick a different time</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={s.input} value={customTime} onChangeText={handleCustomTimeChange}
            keyboardType="number-pad" placeholder="e.g. 1830 for 6:30 PM" placeholderTextColor="#475569" autoFocus
          />
          <TouchableOpacity
            style={s.btn}
            onPress={() => { const t = normalizeTime(customTime.trim()) || time; setTime(t); setStep(STEP_TIME_MEANING); }}
          >
            <Text style={s.btnText}>Set and continue →</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // Does {time} mean "start around then" or "must be DONE by then"? These
  // need very different scheduling: a deadline has to back the actual nudge
  // off by however long the thing takes, or it fires too late to be useful
  // (see submitWithDeadline).
  if (step === STEP_TIME_MEANING) return (
    <View style={s.center}>
      <Text style={s.title}>Is {formatDisplayTime(time)}{'\n'}when you'll start —{'\n'}or the deadline to finish by?</Text>
      <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} disabled={loading} onPress={() => submit(time)}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>I'll start around then</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => setStep(STEP_DURATION)} disabled={loading}>
        <Text style={s.btnText}>Must be done by then</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_DURATION) return (
    <View style={s.center}>
      <Text style={s.title}>About how long{'\n'}will it take?</Text>
      <Text style={s.hint}>We'll nudge you with enough time left before {formatDisplayTime(time)}.</Text>
      <View style={s.chipGrid}>
        {DURATIONS.map(d => (
          <TouchableOpacity key={d.minutes} style={s.chip} disabled={loading} onPress={() => submitWithDeadline(time, d.minutes)}>
            <Text style={s.chipText}>{d.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={s.center}>
      <Text style={s.title}>What's the one thing{'\n'}you want help with{'\n'}right now?</Text>
      <Text style={s.hint}>Big or small — whatever's actually on your mind.</Text>

      <TextInput
        style={s.input} value={customTitle} onChangeText={setCustomTitle}
        placeholder="e.g. finishing my taxes" placeholderTextColor="#475569" autoFocus
        onSubmitEditing={continueFromTitle} returnKeyType="next"
      />
      <TouchableOpacity
        style={[s.btn, !customTitle.trim() && s.btnDisabled]} disabled={!customTitle.trim()}
        onPress={continueFromTitle}
      >
        <Text style={s.btnText}>Continue →</Text>
      </TouchableOpacity>
      {onSecondaryAction && (
        <TouchableOpacity style={s.linkBtn} onPress={onSecondaryAction}>
          <Text style={s.linkBtnText}>{secondaryActionLabel || "That's it for now →"}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 28 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 34, marginBottom: 8 },
  hint: { fontSize: 15, color: '#64748b', marginBottom: 32, textAlign: 'center' },
  input: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, fontSize: 16, color: '#f1f5f9', marginBottom: 16, borderWidth: 1, borderColor: '#334155', width: 240, textAlign: 'center' },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 10, minWidth: 220 },
  btnSecondary: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkBtn: { paddingVertical: 14 },
  linkBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, maxWidth: 340 },
  chip: { backgroundColor: '#1e293b', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#334155' },
  chipText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  staleList: { width: '100%', maxWidth: 300, marginBottom: 24 },
  staleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  staleTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '700', flex: 1, marginRight: 10 },
  staleDays: { color: '#f59e0b', fontSize: 12, fontWeight: '700' },
});
