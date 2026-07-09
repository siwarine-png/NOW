/**
 * "I'm Stuck" tab — add a new pain point at any time, not just once at
 * onboarding. Same shape as the pain-point question in OnboardingScreen
 * (medicine vs. something else vs. a chosen time), just reachable again
 * later via POST /commitments directly instead of only at registration.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { createCommitment } from '../api/engine';

const STEP_CHOOSE = 0;
const STEP_TIME = 1;

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
  const [step, setStep] = useState(STEP_CHOOSE);
  const [painPointType, setPainPointType] = useState(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [time, setTime] = useState(defaultTime());
  const [pickingTime, setPickingTime] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [loading, setLoading] = useState(false);

  function choose(type) {
    setPainPointType(type);
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
      const payload = painPointType === 'medicine'
        ? {
            user_id: user.id, title: 'Take medication', next_action: 'Take your medication',
            cadence: 'daily', window_start: finalTime, window_end: addMinutesToTime(finalTime, 30),
            priority_tier: 'critical',
          }
        : {
            user_id: user.id, title: customTitle.trim(), next_action: null,
            cadence: 'daily', window_start: finalTime, window_end: addMinutesToTime(finalTime, 60),
            priority_tier: 'normal',
          };
      await createCommitment(payload);
      setStep(STEP_CHOOSE);
      setPainPointType(null);
      setCustomTitle('');
      setShowCustom(false);
      setPickingTime(false);
      setCustomTime('');
      setTime(defaultTime());
      onCreated?.();
    } catch (e) {
      Alert.alert("Couldn't add that", e.message);
    } finally {
      setLoading(false);
    }
  }

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

      {!showCustom ? (
        <>
          <TouchableOpacity style={s.btn} onPress={() => choose('medicine')}>
            <Text style={s.btnText}>Remembering medicine</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setShowCustom(true)}>
            <Text style={s.linkBtnText}>Something else</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={s.input} value={customTitle} onChangeText={setCustomTitle}
            placeholder="e.g. finishing my taxes" placeholderTextColor="#475569" autoFocus
          />
          <TouchableOpacity
            style={[s.btn, !customTitle.trim() && s.btnDisabled]} disabled={!customTitle.trim()}
            onPress={() => choose('custom')}
          >
            <Text style={s.btnText}>Continue →</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 28 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 34, marginBottom: 8 },
  hint: { fontSize: 15, color: '#64748b', marginBottom: 32 },
  input: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, fontSize: 16, color: '#f1f5f9', marginBottom: 16, borderWidth: 1, borderColor: '#334155', width: 240, textAlign: 'center' },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 10, minWidth: 220 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkBtn: { paddingVertical: 14 },
  linkBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
});
