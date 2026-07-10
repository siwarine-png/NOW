/**
 * Today — the app's home screen. NowScreen (the single-focus "what do I do
 * right now" card) answers one question well, but answering only that
 * question left users feeling like they'd lost the whole day's shape ("on a
 * boat in the ocean"). This screen shows the day: a highlighted "do this
 * now" card (still powered by the same /interventions/now money endpoint),
 * then the day's other commitments bucketed into earlier/happening
 * now/coming up, each with a quick Done button. "I'm stuck?" and the
 * highlighted card both drop into NowScreen for the focused single-action
 * flow -- this screen doesn't reimplement that, it just adds the context
 * around it.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, AppState } from 'react-native';
import { getInterventionNow, getTodaySchedule, postCheckin, getIdentityCheckinStatus } from '../api/engine';
import { enqueue } from '../store/queue';
import IdentityCheckinPrompt, { shouldShowIdentityCheckin } from '../components/IdentityCheckinPrompt';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function fmtMinutesUntil(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `in ${m}m`;
  if (m === 0) return `in ${h}h`;
  return `in ${h}h ${m}m`;
}

function Row({ item, onDone, acting }) {
  return (
    <View style={s.row}>
      <View style={s.rowBar} />
      <View style={s.rowBody}>
        <Text style={s.rowTitle}>{item.title}</Text>
        <Text style={s.rowTime}>
          {item.window_start ? `${fmtTime(item.window_start)}–${fmtTime(item.window_end)}` : 'Anytime'}
          {item.minutes_until != null ? ` · ${fmtMinutesUntil(item.minutes_until)}` : ''}
        </Text>
      </View>
      {item.done ? (
        <Text style={s.doneBadge}>✓ Done</Text>
      ) : (
        <TouchableOpacity style={s.doneBtn} disabled={acting} onPress={() => onDone(item.commitment_id)}>
          <Text style={s.doneBtnText}>✓ Done</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function Section({ label, items, onDone, acting }) {
  if (!items?.length) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      {items.map(item => <Row key={item.commitment_id} item={item} onDone={onDone} acting={acting} />)}
    </View>
  );
}

export default function TodayScreen({ user, onOpenNow, onSettings }) {
  const [doNow, setDoNow] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [checkinDue, setCheckinDue] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [now, today] = await Promise.all([getInterventionNow(user.id), getTodaySchedule(user.id)]);
      setDoNow(now);
      setSchedule(today);
    } catch { /* keep whatever was last shown rather than a broken empty screen */ }
    finally { setLoading(false); }

    // Best-effort, separate from the main load so a failure here never
    // blocks the actual home screen -- this is a sampling signal, not core.
    try {
      const [status, locallyOk] = await Promise.all([getIdentityCheckinStatus(user.id), shouldShowIdentityCheckin()]);
      setCheckinDue(!!status?.due && locallyOk);
    } catch { /* stay silent, this is optional data collection */ }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  async function handleDone(commitmentId) {
    setActing(true);
    try {
      await postCheckin(commitmentId, 'done', null, null);
    } catch {
      await enqueue({ type: 'checkin', commitment_id: commitmentId, result: 'done', energy: null, intervention_id: null });
    }
    setActing(false);
    load();
  }

  const doneCount = schedule?.done_count ?? 0;
  const totalCount = schedule?.total_count ?? 0;
  const segments = Array.from({ length: Math.max(totalCount, 1) }, (_, i) => i < doneCount);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>{greeting()} 👋</Text>
            <Text style={s.subtitle}>Now</Text>
          </View>
          <TouchableOpacity onPress={onSettings} style={s.settingsBtn}>
            <Text style={s.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        {totalCount > 0 && (
          <>
            <View style={s.progressRow}>
              {segments.map((done, i) => <View key={i} style={[s.segment, done && s.segmentDone]} />)}
            </View>
            <Text style={s.progressLabel}>{doneCount}/{totalCount} done</Text>
          </>
        )}

        {loading && !doNow ? <ActivityIndicator color="#6366f1" style={{ marginTop: 24 }} /> : null}

        {doNow && doNow.state !== 'clear' && (
          <TouchableOpacity style={s.doNowCard} onPress={onOpenNow}>
            <Text style={s.doNowLabel}>🎯 DO THIS NOW</Text>
            <Text style={s.doNowTitle}>{doNow.action || doNow.message}</Text>
          </TouchableOpacity>
        )}

        {schedule && (
          <>
            <Section label="Earlier today" items={schedule.sections.earlier_today} onDone={handleDone} acting={acting} />
            <Section label="Happening now" items={schedule.sections.happening_now} onDone={handleDone} acting={acting} />
            <Section label="Coming up" items={schedule.sections.coming_up} onDone={handleDone} acting={acting} />
            <Section label="Anytime" items={schedule.sections.anytime} onDone={handleDone} acting={acting} />
          </>
        )}
      </ScrollView>

      <IdentityCheckinPrompt
        visible={checkinDue}
        user={user}
        onDone={() => setCheckinDue(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  greeting: { fontSize: 24, fontWeight: '900', color: '#f1f5f9' },
  subtitle: { fontSize: 13, color: '#475569', marginTop: 2 },
  settingsBtn: { padding: 8 },
  settingsIcon: { fontSize: 20, color: '#475569' },
  progressRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#1e293b' },
  segmentDone: { backgroundColor: '#34d399' },
  progressLabel: { fontSize: 11, color: '#64748b', marginTop: 6, textAlign: 'right' },
  doNowCard: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#6366f1', padding: 18, marginTop: 20, marginBottom: 8 },
  doNowLabel: { fontSize: 11, fontWeight: '800', color: '#818cf8', letterSpacing: 0.8, marginBottom: 8 },
  doNowTitle: { fontSize: 19, fontWeight: '800', color: '#fff', lineHeight: 25 },
  section: { marginTop: 22 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#475569', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  rowBar: { width: 3, height: 32, borderRadius: 2, backgroundColor: '#334155', marginRight: 12 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#f1f5f9' },
  rowTime: { fontSize: 12, color: '#64748b', marginTop: 2 },
  doneBtn: { borderWidth: 1, borderColor: '#334155', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  doneBtnText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  doneBadge: { color: '#34d399', fontSize: 12, fontWeight: '700' },
});
