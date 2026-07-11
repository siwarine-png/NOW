/**
 * Identity — reflection tab surfacing the Adaptive Allocation Engine's
 * spectrum (see engine-specs/adaptive-allocation-engine-v1.1.md §2.3/§4):
 * desired vs. actually-measured hours per axis, and the gap between them.
 *
 * current_hours_per_week is now real, computed from actual identity_checkins
 * (GET /v2/identity-checkins/spectrum, engine/src/engine/identityAggregate.js)
 * over a rolling window -- no longer mocked. desired_hours_per_week and
 * floor_hours_per_week are still MOCK_SPECTRUM constants: computing a real
 * desired figure needs the Phase 1/2 baseline+flex allocation engine from
 * the spec, which is designed but not implemented anywhere yet. Swap those
 * two fields in once that ships; current_hours_per_week already won't need
 * to change.
 *
 * The reflection journal at the bottom is intentionally local-only
 * (AsyncStorage, never sent to the server) — same "no read access into this
 * engine" rule the spec gives affect/mood input in §2.2, applied here too.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Keyboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateUser, getIdentitySpectrum } from '../api/engine';
import { showAlert } from '../utils/alert';

const JOURNAL_KEY = 'identity_reflection_v1';

// Accepts "2300", "11", "23:00" etc., same shape as the time inputs already
// used in OnboardingScreen.js/AddPainPointScreen.js -- not shared via a
// common module in this codebase, so duplicated locally like those are.
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

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Handles the overnight wrap (sleep 23:00 -> wake 07:00 = 8h, not negative).
function sleepDurationHours(sleepTime, wakeTime) {
  const s = timeToMinutes(sleepTime), w = timeToMinutes(wakeTime);
  const mins = w > s ? w - s : (1440 - s) + w;
  return Math.round((mins / 60) * 10) / 10;
}

// Shape matches engine-specs/adaptive-allocation-engine-v1.1.md §4's output,
// per-axis, plus `floor_hours_per_week` where §2.3 defines one. Foundation's
// sleep window is real now (wake_time/sleep_time already exist on `users`,
// just were never actually surfaced/editable anywhere until this screen).
// desired_hours_per_week / floor_hours_per_week below are still mock
// placeholders (see header comment) -- current_hours_per_week gets
// overwritten with real data from getIdentitySpectrum once it loads.
const MOCK_SPECTRUM = {
  axes: [
    // Foundation used to be shown only via the sleep-schedule box below, with
    // no bar of its own -- inconsistent with the other 5 axes and easy to
    // misread as "not tracked." It's sampled by identity_checkins exactly
    // like the rest (see identityCheckin.js's AXES), just never rendered
    // the same way. desired_hours_per_week here is a placeholder same as
    // everywhere else in this mock (see header comment) -- Foundation's real
    // desired figure should eventually be prescribed, not user-set, per the
    // spec, which still isn't built.
    { axis: 'foundation', label: 'Foundation', desired_hours_per_week: 10, current_hours_per_week: 8 },
    { axis: 'relationships', label: 'Relationships', floor_hours_per_week: 3, desired_hours_per_week: 18, current_hours_per_week: 12 },
    { axis: 'achievement', label: 'Achievement', desired_hours_per_week: 32, current_hours_per_week: 22.5 },
    { axis: 'finance', label: 'Finance', floor_hours_per_week: 2, desired_hours_per_week: 8, current_hours_per_week: 6.5 },
    { axis: 'contribution', label: 'Contribution', desired_hours_per_week: 6, current_hours_per_week: 5.5 },
    { axis: 'recreation', label: 'Recreation', desired_hours_per_week: 7, current_hours_per_week: 2 },
  ],
};

function AxisBar({ item }) {
  // No real samples yet for this axis -- show a distinct "not enough data"
  // state rather than mixing a real 0h with the still-mock desired figure,
  // which would misleadingly read as "measured zero" instead of "unmeasured."
  if (item.sample_count === 0) {
    return (
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.axisLabel}>{item.label}</Text>
        </View>
        <Text style={s.gapNote}>Still collecting data — answer a few more check-ins to see this.</Text>
        {item.logged_hours_per_week > 0 && (
          <Text style={s.loggedNote}>{item.logged_hours_per_week}h logged this month from completed tasks tagged to this axis</Text>
        )}
      </View>
    );
  }

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
      {item.low_confidence && (
        <Text style={s.lowConfidenceNote}>
          Based on only {item.sample_count} check-in{item.sample_count === 1 ? '' : 's'} so far — this estimate will settle down with more data.
        </Text>
      )}
      {item.fixed_hours_per_week > 0 && (
        <Text style={s.fixedNote}>{item.fixed_hours_per_week}h of that is fixed/non-negotiable time</Text>
      )}
      {item.logged_hours_per_week > 0 && (
        <Text style={s.loggedNote}>{item.logged_hours_per_week}h logged this month from completed tasks tagged to this axis</Text>
      )}
    </View>
  );
}

export default function IdentityScreen({ onBack, user }) {
  const [spectrum, setSpectrum] = useState(null);
  const [journal, setJournal] = useState('');
  const [saved, setSaved] = useState(false);

  const [wakeTime, setWakeTime] = useState(user?.wake_time || '07:00');
  const [sleepTime, setSleepTime] = useState(user?.sleep_time || '23:00');
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [wakeInput, setWakeInput] = useState('');
  const [sleepInput, setSleepInput] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const load = useCallback(async () => {
    // desired/floor stay mock (see header comment); current_hours_per_week
    // and fixed_hours_per_week get overwritten with real measured data below.
    let axes = MOCK_SPECTRUM.axes;
    if (user?.id) {
      try {
        const real = await getIdentitySpectrum(user.id);
        axes = MOCK_SPECTRUM.axes.map(item => ({
          ...item,
          current_hours_per_week: real.axes[item.axis]?.current_hours_per_week ?? item.current_hours_per_week,
          fixed_hours_per_week: real.axes[item.axis]?.fixed_hours_per_week ?? 0,
          sample_count: real.axes[item.axis]?.sample_count ?? 0,
          logged_hours_per_week: real.axes[item.axis]?.logged_hours_per_week ?? 0,
          low_confidence: real.axes[item.axis]?.low_confidence ?? false,
        }));
      } catch (e) { /* keep the mock fallback rather than a broken screen */ }
    }
    setSpectrum({ axes });
    const raw = await AsyncStorage.getItem(JOURNAL_KEY);
    if (raw) setJournal(JSON.parse(raw).text || '');
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  async function saveJournal() {
    await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify({ text: journal, saved_at: Date.now() }));
    Keyboard.dismiss();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function openScheduleEdit() {
    setWakeInput(wakeTime.replace(':', ''));
    setSleepInput(sleepTime.replace(':', ''));
    setEditingSchedule(true);
  }

  async function saveSchedule() {
    const wt = normalizeTime(wakeInput) || wakeTime;
    const st = normalizeTime(sleepInput) || sleepTime;
    setSavingSchedule(true);
    try {
      // Quiet hours mirror the real sleep window here too, same reasoning
      // registration already uses when wake/sleep is first set (asleep =
      // quiet) -- editing the schedule later should keep that in sync.
      if (user?.id) await updateUser(user.id, { wake_time: wt, sleep_time: st, quiet_start: st, quiet_end: wt });
      setWakeTime(wt);
      setSleepTime(st);
      setEditingSchedule(false);
    } catch (e) {
      // Keep the edit form open with what was typed rather than silently
      // discarding it on a failed save.
      showAlert("Couldn't save", e.message);
    } finally {
      setSavingSchedule(false);
    }
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
          {!editingSchedule ? (
            <>
              <Text style={s.foundationText}>
                🔒 Sleep {formatDisplayTime(sleepTime)}–{formatDisplayTime(wakeTime)}
                {' '}({sleepDurationHours(sleepTime, wakeTime)}h/night, {Math.round(sleepDurationHours(sleepTime, wakeTime) * 7)}h/week reserved)
                {' '}— never competes with anything below.
              </Text>
              <TouchableOpacity onPress={openScheduleEdit} style={s.foundationEditBtn}>
                <Text style={s.foundationEditBtnText}>Edit sleep schedule</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.foundationText}>What time do you actually wake up and go to sleep?</Text>
              <View style={s.scheduleRow}>
                <View style={s.scheduleField}>
                  <Text style={s.scheduleFieldLabel}>Wake</Text>
                  <TextInput
                    style={s.scheduleInput}
                    value={wakeInput}
                    onChangeText={t => setWakeInput(t.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    placeholder="e.g. 700"
                    placeholderTextColor="#475569"
                  />
                </View>
                <View style={s.scheduleField}>
                  <Text style={s.scheduleFieldLabel}>Sleep</Text>
                  <TextInput
                    style={s.scheduleInput}
                    value={sleepInput}
                    onChangeText={t => setSleepInput(t.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    placeholder="e.g. 2300"
                    placeholderTextColor="#475569"
                  />
                </View>
              </View>
              <View style={s.scheduleActions}>
                <TouchableOpacity onPress={() => setEditingSchedule(false)} style={s.linkBtn} disabled={savingSchedule}>
                  <Text style={s.linkBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveSchedule} style={s.saveBtn} disabled={savingSchedule}>
                  <Text style={s.saveBtnText}>{savingSchedule ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
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
  foundationEditBtn: { marginTop: 8, alignSelf: 'flex-start' },
  foundationEditBtnText: { fontSize: 12, fontWeight: '700', color: '#818cf8' },
  scheduleRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  scheduleField: { flex: 1 },
  scheduleFieldLabel: { fontSize: 11, color: '#64748b', marginBottom: 4 },
  scheduleInput: { backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', padding: 10, fontSize: 14, color: '#f1f5f9', textAlign: 'center' },
  scheduleActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 12 },
  linkBtn: { paddingVertical: 6 },
  linkBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '700' },

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
  fixedNote: { fontSize: 11, color: '#64748b', marginTop: 4 },
  loggedNote: { fontSize: 11, color: '#818cf8', marginTop: 4 },
  lowConfidenceNote: { fontSize: 11, color: '#f59e0b', marginTop: 4 },

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
