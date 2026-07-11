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
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { createCommitment } from '../api/engine';
import { showAlert } from '../utils/alert';

const STEP_TITLE = 0;
const STEP_AXIS = 1;
const STEP_RECURRENCE = 2;
const STEP_TIME = 3;

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

export default function AddPainPointScreen({ user, onCreated }) {
  const [step, setStep] = useState(STEP_TITLE);
  const [customTitle, setCustomTitle] = useState('');
  const [identityAxis, setIdentityAxis] = useState(null);
  const [cadence, setCadence] = useState('daily');
  const [time, setTime] = useState(defaultTime());
  const [pickingTime, setPickingTime] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [loading, setLoading] = useState(false);

  function continueFromTitle() {
    if (!customTitle.trim()) return;
    setStep(STEP_AXIS);
  }

  function chooseAxis(axisKey) {
    setIdentityAxis(axisKey);
    setStep(STEP_RECURRENCE);
  }

  function chooseCadence(value) {
    setCadence(value);
    setStep(STEP_TIME);
  }

  function handleCustomTimeChange(text) {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setCustomTime(digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`);
  }

  async function submit(finalTime) {
    if (!user?.id) return;
    setLoading(true);
    try {
      await createCommitment({
        user_id: user.id, title: customTitle.trim(), next_action: null,
        cadence, window_start: finalTime, window_end: addMinutesToTime(finalTime, 60),
        priority_tier: 'normal', identity_axis: identityAxis,
      });
      setStep(STEP_TITLE);
      setCustomTitle('');
      setIdentityAxis(null);
      setCadence('daily');
      setPickingTime(false);
      setCustomTime('');
      setTime(defaultTime());
      onCreated?.();
    } catch (e) {
      showAlert("Couldn't add that", e.message);
    } finally {
      setLoading(false);
    }
  }

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

  if (step === STEP_RECURRENCE) return (
    <View style={s.center}>
      <Text style={s.title}>Is this a one-time thing,{'\n'}or something you'll do{'\n'}regularly?</Text>
      <TouchableOpacity style={s.btn} onPress={() => chooseCadence('once')}>
        <Text style={s.btnText}>Just once</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseCadence('daily')}>
        <Text style={s.btnText}>Every day</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_TIME) return (
    <View style={s.center}>
      <Text style={s.title}>We'll nudge you{'\n'}around{'\n'}{formatDisplayTime(time)}.</Text>
      <Text style={s.hint}>Good?</Text>

      {!pickingTime ? (
        <>
          <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} disabled={loading} onPress={() => submit(time)}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sounds good →</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setPickingTime(true)} disabled={loading}>
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
            style={[s.btn, loading && s.btnDisabled]} disabled={loading}
            onPress={() => { const t = normalizeTime(customTime.trim()) || time; setTime(t); submit(t); }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Set and continue →</Text>}
          </TouchableOpacity>
        </>
      )}
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
});
