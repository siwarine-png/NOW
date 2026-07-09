/**
 * Identity — reflection tab surfacing the Adaptive Allocation Engine's
 * spectrum (see engine-specs/adaptive-allocation-engine-v1.1.md §2.3/§4):
 * desired vs. actually-measured hours per axis, and the gap between them.
 *
 * MOCK DATA NOTE: the Allocation Engine itself isn't built server-side yet
 * (spec only, as of v1.2) — there's no `/v1/identity` endpoint to call. This
 * screen renders MOCK_SPECTRUM below so the visual/interaction design is
 * real and reviewable tonight. Swap MOCK_SPECTRUM for a real API call (same
 * shape as the spec's §4 output) once the engine ships — everything below
 * `load()` should keep working unchanged.
 *
 * The reflection journal at the bottom is intentionally local-only
 * (AsyncStorage, never sent to the server) — same "no read access into this
 * engine" rule the spec gives affect/mood input in §2.2, applied here too.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Keyboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const JOURNAL_KEY = 'identity_reflection_v1';

// Shape matches engine-specs/adaptive-allocation-engine-v1.1.md §4's output,
// per-axis, plus `floor_hours_per_week` where §2.3 defines one.
const MOCK_SPECTRUM = {
  foundation: { label: 'Foundation', reserved_hours_per_week: 63 }, // sleep/meals/movement/hygiene — never competes
  axes: [
    { axis: 'relationships', label: 'Relationships', floor_hours_per_week: 3, desired_hours_per_week: 18, current_hours_per_week: 12 },
    { axis: 'achievement', label: 'Achievement', desired_hours_per_week: 32, current_hours_per_week: 22.5 },
    { axis: 'finance', label: 'Finance', floor_hours_per_week: 2, desired_hours_per_week: 8, current_hours_per_week: 6.5 },
    { axis: 'contribution', label: 'Contribution', desired_hours_per_week: 6, current_hours_per_week: 5.5 },
    { axis: 'recreation', label: 'Recreation', desired_hours_per_week: 7, current_hours_per_week: 2 },
  ],
};

function AxisBar({ item }) {
  const pct = item.desired_hours_per_week > 0
    ? Math.min(100, Math.round((item.current_hours_per_week / item.desired_hours_per_week) * 100))
    : 0;
  const gap = Math.max(0, item.desired_hours_per_week - item.current_hours_per_week);
  const onTrack = gap < 1;

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <Text style={s.axisLabel}>{item.label}</Text>
        <Text style={[s.axisHours, onTrack && s.axisHoursOnTrack]}>
          {item.current_hours_per_week}h <Text style={s.axisHoursDim}>/ {item.desired_hours_per_week}h</Text>
        </Text>
      </View>

      {item.floor_hours_per_week != null && (
        <Text style={s.floorNote}>includes a {item.floor_hours_per_week}h baseline that's always reserved</Text>
      )}

      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }, onTrack && s.fillOnTrack]} />
        {item.floor_hours_per_week != null && item.desired_hours_per_week > 0 && (
          <View style={[s.floorMark, { left: `${Math.min(100, (item.floor_hours_per_week / item.desired_hours_per_week) * 100)}%` }]} />
        )}
      </View>

      <Text style={s.gapNote}>
        {onTrack ? '✓ on track this week' : `${gap.toFixed(1)}h short of your own goal`}
      </Text>
    </View>
  );
}

export default function IdentityScreen({ onBack }) {
  const [spectrum, setSpectrum] = useState(null);
  const [journal, setJournal] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    // TODO: replace with a real call once the Allocation Engine ships, e.g.
    //   const data = await getIdentitySpectrum(user.id);
    setSpectrum(MOCK_SPECTRUM);
    const raw = await AsyncStorage.getItem(JOURNAL_KEY);
    if (raw) setJournal(JSON.parse(raw).text || '');
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveJournal() {
    await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify({ text: journal, saved_at: Date.now() }));
    Keyboard.dismiss();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!spectrum) return null;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Identity</Text>
            <Text style={s.subtitle}>Where you are vs. who you're becoming</Text>
          </View>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={s.backBtn}>
              <Text style={s.backIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={s.explainer}>
          Measured from what you actually did this week, not how it felt —
          same as everywhere else in this app.
        </Text>

        <View style={s.foundationNote}>
          <Text style={s.foundationText}>
            🔒 {spectrum.foundation.reserved_hours_per_week}h/week reserved for {spectrum.foundation.label.toLowerCase()}
            (sleep, meals, movement) — never competes with anything below.
          </Text>
        </View>

        {spectrum.axes.map(item => <AxisBar key={item.axis} item={item} />)}

        <View style={s.journalSection}>
          <Text style={s.journalLabel}>Reflection</Text>
          <Text style={s.journalHint}>
            Private — stays on this device, never read by the app's scheduling.
          </Text>
          <TextInput
            style={s.journalInput}
            multiline
            placeholder="How does this week actually feel?"
            placeholderTextColor="#475569"
            value={journal}
            onChangeText={setJournal}
          />
          <TouchableOpacity style={s.saveBtn} onPress={saveJournal}>
            <Text style={s.saveBtnText}>{saved ? '✓ Saved' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '900', color: '#f1f5f9' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  backBtn: { padding: 8 },
  backIcon: { fontSize: 18, color: '#475569' },
  explainer: { fontSize: 12, color: '#64748b', lineHeight: 17, marginBottom: 18 },

  foundationNote: { backgroundColor: '#1e293b', borderRadius: 12, padding: 12, marginBottom: 16 },
  foundationText: { fontSize: 12, color: '#94a3b8', lineHeight: 17 },

  card: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#273449' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  axisLabel: { fontSize: 15, fontWeight: '800', color: '#f1f5f9' },
  axisHours: { fontSize: 14, fontWeight: '800', color: '#f59e0b' },
  axisHoursOnTrack: { color: '#34d399' },
  axisHoursDim: { fontWeight: '600', color: '#64748b' },
  floorNote: { fontSize: 11, color: '#64748b', marginBottom: 8 },

  track: { height: 8, borderRadius: 4, backgroundColor: '#0f172a', marginTop: 8, overflow: 'visible' },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#f59e0b' },
  fillOnTrack: { backgroundColor: '#34d399' },
  floorMark: { position: 'absolute', top: -2, width: 2, height: 12, backgroundColor: '#475569' },

  gapNote: { fontSize: 12, color: '#94a3b8', marginTop: 8 },

  journalSection: { marginTop: 24 },
  journalLabel: { fontSize: 13, fontWeight: '800', color: '#f1f5f9', marginBottom: 2 },
  journalHint: { fontSize: 11, color: '#64748b', marginBottom: 10 },
  journalInput: {
    backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#273449',
    padding: 14, minHeight: 90, fontSize: 14, color: '#f1f5f9', textAlignVertical: 'top',
  },
  saveBtn: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#6366f1' },
  saveBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
});
