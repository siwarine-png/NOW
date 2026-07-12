/**
 * "I'm busy" -- an on-demand, ad-hoc version of quiet hours: mark yourself
 * unavailable starting now, for a chosen duration, instead of only being
 * able to schedule quiet hours ahead of time. Confirming does two things:
 *  - sets users.busy_until, which GET /interventions/now and every
 *    proactive push tick (scheduler.js) check first and suppress on;
 *  - records the moment as a real is_fixed=true identity check-in
 *    (Adaptive Allocation Engine, engine/src/engine/identityAggregate.js)
 *    for whichever axis this time belongs to -- the "seamlessly integrate
 *    fixed/unavailable time into the timepool" half of the ask, not just a
 *    do-not-disturb toggle with no memory of what the time was for.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { updateUser, postIdentityCheckin } from '../api/engine';

const AXES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'achievement', label: 'Achievement' },
  { key: 'finance', label: 'Finance' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'recreation', label: 'Recreation' },
];

const DURATIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: 'Rest of day', minutes: null },
];

function endOfDay() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function ImBusyButton({ userId, onSet }) {
  const [stage, setStage] = useState('idle'); // idle | axis | duration
  const [axis, setAxis] = useState(null);
  const [saving, setSaving] = useState(false);

  function chooseAxis(key) {
    setAxis(key);
    setStage('duration');
  }

  async function chooseDuration(minutes) {
    if (!userId) return;
    setSaving(true);
    const until = minutes ? new Date(Date.now() + minutes * 60_000) : endOfDay();
    try {
      await Promise.all([
        updateUser(userId, { busy_until: until.toISOString() }),
        postIdentityCheckin(userId, axis, true),
      ]);
    } catch (e) { /* best-effort -- worst case the busy state doesn't stick this time */ }
    setSaving(false);
    setStage('idle');
    setAxis(null);
    onSet?.();
  }

  if (stage === 'idle') {
    return (
      <TouchableOpacity style={s.openBtn} onPress={() => setStage('axis')}>
        <Text style={s.openBtnText}>🔕 I'm busy</Text>
      </TouchableOpacity>
    );
  }

  if (stage === 'axis') {
    return (
      <View style={s.pickWrap}>
        <Text style={s.pickLabel}>What's this for?</Text>
        <View style={s.chipRow}>
          {AXES.map(a => (
            <TouchableOpacity key={a.key} style={s.chip} onPress={() => chooseAxis(a.key)}>
              <Text style={s.chipText}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={s.pickWrap}>
      <Text style={s.pickLabel}>For how long?</Text>
      <View style={s.chipRow}>
        {DURATIONS.map(d => (
          <TouchableOpacity key={d.label} style={s.chip} disabled={saving} onPress={() => chooseDuration(d.minutes)}>
            {saving ? <ActivityIndicator color="#a5b4fc" /> : <Text style={s.chipText}>{d.label}</Text>}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  openBtn: { backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
  openBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '800' },
  pickWrap: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
  pickLabel: { fontSize: 13, fontWeight: '700', color: '#94a3b8', marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  chip: { backgroundColor: '#0f172a', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#334155' },
  chipText: { color: '#c7d2fe', fontSize: 13, fontWeight: '700' },
});
