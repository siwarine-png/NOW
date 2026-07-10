/**
 * "What are you doing right now?" — the client half of the Adaptive
 * Allocation Engine's experience-sampling window (see
 * engine/src/engine/identityCheckin.js for the server-side due logic and
 * why this is capped at ~5/day for 7 days, not fired more often).
 *
 * Shown as an overlay on top of whatever screen is active, not a separate
 * tab -- it needs to interrupt in the moment to be useful data, same reason
 * it's a push notification in the first place. "Not now" dismisses without
 * recording and won't re-prompt for a short cooldown (purely client-side,
 * AsyncStorage-backed) so a skip doesn't just immediately re-show the
 * instant the status endpoint is polled again.
 *
 * Up to 2 axes per check-in, not a full duration breakdown: a 3-hour gap
 * between prompts often really did involve two things, but asking "how many
 * minutes on each" would ask users to reconstruct time -- exactly the thing
 * ESM point-sampling exists to avoid, and exactly what's hardest for ADHD
 * users specifically (time blindness). Two taps, still zero estimation.
 * Each selected axis is recorded as its own row via postIdentityCheckin --
 * no schema change, aggregation just treats both as real samples from this
 * moment.
 *
 * "Not sure" is a decision-support detour, not a 7th axis: type what you're
 * doing, Groq suggests which of the same 6 axes it fits (engine/src/engine/
 * groq.js), and Accept records it (merged with any axis already tapped)
 * through the exact same postIdentityCheckin call a manual chip tap would
 * use. Reject it and you slide back to the chip picker -- the suggestion is
 * never itself the record.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { postIdentityCheckin, suggestIdentityAxis } from '../api/engine';

const DISMISS_KEY = 'identity_checkin_dismissed_at_v1';
const DISMISS_COOLDOWN_MIN = 20;
const MAX_AXES = 2;

const STAGE_PICK = 'pick';
const STAGE_NOT_SURE = 'not_sure';
const STAGE_SUGGESTED = 'suggested';

const AXES = [
  { key: 'foundation', label: 'Foundation', hint: 'sleep, meals, movement' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'achievement', label: 'Achievement' },
  { key: 'finance', label: 'Finance' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'recreation', label: 'Recreation' },
];

const AXIS_LABEL = Object.fromEntries(AXES.map(a => [a.key, a.label]));

export async function shouldShowIdentityCheckin() {
  const raw = await AsyncStorage.getItem(DISMISS_KEY);
  if (!raw) return true;
  const dismissedAt = Number(raw);
  return (Date.now() - dismissedAt) / 60_000 >= DISMISS_COOLDOWN_MIN;
}

export default function IdentityCheckinPrompt({ visible, user, onDone }) {
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState(STAGE_PICK);
  const [selected, setSelected] = useState([]);
  const [text, setText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedAxis, setSuggestedAxis] = useState(null);
  const [suggestError, setSuggestError] = useState(false);

  function reset() {
    setStage(STAGE_PICK);
    setSelected([]);
    setText('');
    setSuggestedAxis(null);
    setSuggestError(false);
  }

  function toggleAxis(axisKey) {
    if (saving) return;
    setSelected(prev => {
      if (prev.includes(axisKey)) return prev.filter(k => k !== axisKey);
      if (prev.length >= MAX_AXES) return prev;
      return [...prev, axisKey];
    });
  }

  async function submitAll(axesArr) {
    if (!user?.id || !axesArr.length || saving) return;
    setSaving(true);
    try {
      for (const axisKey of axesArr) {
        await postIdentityCheckin(user.id, axisKey);
      }
    } catch (e) {
      // Best-effort — this is a sampling signal, not a critical write. A
      // missed sample just means one fewer data point, not a broken flow.
    } finally {
      setSaving(false);
      reset();
      onDone?.();
    }
  }

  async function dismiss() {
    await AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
    reset();
    onDone?.();
  }

  async function askGroq() {
    if (!text.trim() || suggesting) return;
    setSuggesting(true);
    setSuggestError(false);
    try {
      const { axis } = await suggestIdentityAxis(text.trim());
      setSuggestedAxis(axis);
      setStage(STAGE_SUGGESTED);
    } catch (e) {
      setSuggestError(true);
    } finally {
      setSuggesting(false);
    }
  }

  function acceptSuggestion() {
    const combined = Array.from(new Set([...selected, suggestedAxis])).slice(0, MAX_AXES);
    submitAll(combined);
  }

  function backToPick() {
    setStage(STAGE_PICK);
    setText('');
    setSuggestedAxis(null);
    setSuggestError(false);
  }

  const atCap = selected.length >= MAX_AXES;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          {stage === STAGE_PICK && (
            <>
              <Text style={s.title}>What are you doing right now?</Text>
              <Text style={s.hint}>Tap up to 2, if it was more than one thing.</Text>
              <View style={s.grid}>
                {AXES.map(axis => {
                  const isSelected = selected.includes(axis.key);
                  return (
                    <TouchableOpacity
                      key={axis.key}
                      style={[s.chip, isSelected && s.chipSelected]}
                      disabled={saving || (atCap && !isSelected)}
                      onPress={() => toggleAxis(axis.key)}
                    >
                      <Text style={[s.chipText, isSelected && s.chipSelectedText]}>{axis.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[s.chip, s.chipGhost]}
                  disabled={saving || atCap}
                  onPress={() => setStage(STAGE_NOT_SURE)}
                >
                  <Text style={[s.chipText, s.chipGhostText]}>Not sure</Text>
                </TouchableOpacity>
              </View>
              {selected.length > 0 && (
                <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} disabled={saving} onPress={() => submitAll(selected)}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Log {selected.map(k => AXIS_LABEL[k]).join(' + ')} →</Text>}
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.dismissBtn} disabled={saving} onPress={dismiss}>
                <Text style={s.dismissText}>Not now</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === STAGE_NOT_SURE && (
            <>
              <Text style={s.title}>What are you doing?</Text>
              <Text style={s.hint}>Describe it in a few words — we'll suggest which one it fits.</Text>
              <TextInput
                style={s.input}
                value={text}
                onChangeText={setText}
                placeholder="e.g. building my app"
                placeholderTextColor="#475569"
                autoFocus
              />
              {suggestError && <Text style={s.errorText}>Couldn't get a suggestion — try again or pick manually.</Text>}
              <TouchableOpacity
                style={[s.btn, (!text.trim() || suggesting) && s.btnDisabled]}
                disabled={!text.trim() || suggesting}
                onPress={askGroq}
              >
                {suggesting ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Suggest →</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.dismissBtn} disabled={suggesting} onPress={backToPick}>
                <Text style={s.dismissText}>← Pick manually instead</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === STAGE_SUGGESTED && (
            <>
              <Text style={s.title}>This sounds like</Text>
              <Text style={s.suggestion}>{AXIS_LABEL[suggestedAxis]}</Text>
              {selected.length > 0 && (
                <Text style={s.hint}>Along with {selected.map(k => AXIS_LABEL[k]).join(' + ')}</Text>
              )}
              <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} disabled={saving} onPress={acceptSuggestion}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Accept</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.dismissBtn} disabled={saving} onPress={backToPick}>
                <Text style={s.dismissText}>← Not that, pick manually</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#1e293b', borderRadius: 18, padding: 22, width: '100%', maxWidth: 340, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  title: { fontSize: 18, fontWeight: '900', color: '#fff', textAlign: 'center', marginBottom: 4 },
  hint: { fontSize: 12, color: '#64748b', marginBottom: 16, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 14 },
  chip: { backgroundColor: '#0f172a', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#334155' },
  chipSelected: { backgroundColor: '#312e81', borderColor: '#6366f1' },
  chipText: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
  chipSelectedText: { color: '#c7d2fe' },
  chipGhost: { borderColor: '#6366f1', borderStyle: 'dashed' },
  chipGhostText: { color: '#818cf8' },
  dismissBtn: { paddingVertical: 8 },
  dismissText: { color: '#6366f1', fontSize: 13, fontWeight: '700' },
  input: { backgroundColor: '#0f172a', borderRadius: 10, padding: 12, fontSize: 15, color: '#f1f5f9', marginBottom: 12, borderWidth: 1, borderColor: '#334155', width: '100%', textAlign: 'center' },
  errorText: { color: '#f87171', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, padding: 14, alignItems: 'center', width: '100%', marginBottom: 4 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  suggestion: { fontSize: 22, fontWeight: '900', color: '#818cf8', marginBottom: 6 },
});
