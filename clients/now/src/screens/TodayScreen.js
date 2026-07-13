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
import { getInterventionNow, getTodaySchedule, postCheckin, getIdentityCheckinStatus, updateCommitment, getStalledProjects } from '../api/engine';
import { enqueue } from '../store/queue';
import IdentityCheckinPrompt, { shouldShowIdentityCheckin } from '../components/IdentityCheckinPrompt';
import StaleProjectPrompt from '../components/StaleProjectPrompt';
import RingProgress from '../components/RingProgress';

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

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Time blindness -- losing track of how much of the day is left, not just
// "what's the current task" -- is the specific ADHD pain point these two
// cues exist for, so both stay visible up top regardless of what card is
// showing below, not tucked inside DO THIS NOW (which already disappears
// whenever nothing is actively due).

// Nearest not-yet-started item, in whichever section actually has a
// window_start today -- coming_up is the common case, but a fresh page
// load can catch something still sitting in earlier_today's overdue bucket
// too, so both are searched rather than assuming section placement.
function findNextScheduled(schedule) {
  if (!schedule) return null;
  const candidates = [...(schedule.sections.coming_up || [])].filter(c => c.minutes_until != null);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.minutes_until - b.minutes_until);
  return candidates[0];
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// "Your day" as wake_time-to-sleep_time, not literal midnight -- plain
// calendar-day awareness deliberately isn't tied to the schedule (anchoring
// to the last scheduled item broke down on a light day), but midnight
// itself is dead time nobody's awake for, which made "83% of your day
// left" misleading at 4am. Same wrap-past-midnight handling as the
// engine's own wakingMinutes/isWithinWakingHours (identityCheckin.js), so
// an overnight sleep_time (e.g. 01:00) is treated the same way everywhere.
function dayWindow(user) {
  const wake = timeToMinutes(user?.wake_time || '07:00');
  const sleep = timeToMinutes(user?.sleep_time || '23:00');
  const span = sleep > wake ? sleep - wake : (1440 - wake) + sleep;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const withinDay = sleep > wake ? (nowMin >= wake && nowMin < sleep) : (nowMin >= wake || nowMin < sleep);

  if (!withinDay) {
    // Two distinct "not your day yet/anymore" cases only exist when
    // wake/sleep don't wrap past midnight -- before wake vs after bedtime
    // are different clock segments. In the overnight-bedtime case there's
    // just one contiguous asleep gap between sleep and wake, no separate
    // "hasn't started" segment to distinguish.
    const state = (sleep > wake && nowMin < wake) ? 'before_wake' : 'asleep';
    return { minutesLeft: 0, span, state };
  }
  const elapsedSinceWake = nowMin >= wake ? nowMin - wake : (1440 - wake) + nowMin;
  return { minutesLeft: Math.max(0, span - elapsedSinceWake), span, state: 'awake' };
}

function axisLabel(axis) {
  if (!axis) return null;
  return axis.charAt(0).toUpperCase() + axis.slice(1);
}

// snoozed_until is a full ISO timestamp (unlike window_start's plain HH:MM),
// since a snooze can push something into tomorrow -- "Today" only if it
// actually resolves today, otherwise the date needs to be visible too or
// "until 9:00 AM" would misleadingly read as a few minutes away instead of
// tomorrow morning.
function fmtSnoozedUntil(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `until ${time}`;
  return `until ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function SnoozedRow({ item, onUnsnooze, acting }) {
  return (
    <View style={s.row}>
      <View style={s.rowBar} />
      <View style={s.rowBody}>
        <Text style={s.rowTitle}>{item.title}</Text>
        <Text style={s.rowTime}>
          {fmtSnoozedUntil(item.snoozed_until)}
          {item.identity_axis ? ` · ${axisLabel(item.identity_axis)}` : ''}
        </Text>
      </View>
      <TouchableOpacity style={s.doneBtn} disabled={acting} onPress={() => onUnsnooze(item.commitment_id)}>
        <Text style={s.doneBtnText}>Wake up now</Text>
      </TouchableOpacity>
    </View>
  );
}

// A "Morning Routine" isn't its own concept anywhere server-side -- no new
// field, no migration. It's just Foundation-axis commitments whose window
// starts before noon, grouped into one glanceable card instead of scattered
// across the Earlier/Happening/Coming-up buckets below. Purely a client-side
// read of data GET /commitments/today already returns.
function isMorningFoundation(item) {
  if (item.identity_axis !== 'foundation' || !item.window_start) return false;
  const hour = Number(item.window_start.split(':')[0]);
  return hour < 12;
}

function MorningRoutineCard({ items, onDone, acting }) {
  if (!items.length) return null;
  const doneCount = items.filter(i => i.done).length;
  return (
    <View style={s.morningCard}>
      <View style={s.morningHeader}>
        <Text style={s.morningTitle}>🌅 Morning routine</Text>
        <Text style={s.morningCount}>{doneCount}/{items.length}</Text>
      </View>
      {items.map(item => (
        <TouchableOpacity
          key={item.commitment_id}
          style={s.morningItem}
          disabled={item.done || acting}
          onPress={() => onDone(item.commitment_id)}
        >
          <Text style={[s.morningCheck, item.done && s.morningCheckDone]}>{item.done ? '✓' : '○'}</Text>
          <Text style={[s.morningItemText, item.done && s.morningItemTextDone]}>{item.title}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Row({ item, onDone, onRemove, acting }) {
  return (
    <View style={s.row}>
      <View style={s.rowBar} />
      <View style={s.rowBody}>
        <Text style={[s.rowTitle, item.done && s.rowTitleDone]}>{item.title}</Text>
        <Text style={[s.rowTime, item.done && s.rowTimeDone]}>
          {item.window_start ? `${fmtTime(item.window_start)}–${fmtTime(item.window_end)}` : 'Anytime'}
          {item.minutes_until != null ? ` · ${fmtMinutesUntil(item.minutes_until)}` : ''}
          {item.identity_axis ? ` · ${axisLabel(item.identity_axis)}` : ''}
        </Text>
      </View>
      {item.done ? (
        <Text style={s.doneBadge}>✓ Done</Text>
      ) : (
        <View style={s.rowActions}>
          <TouchableOpacity style={s.doneBtn} disabled={acting} onPress={() => onDone(item.commitment_id)}>
            <Text style={s.doneBtnText}>✓ Done</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={acting} onPress={() => onRemove(item.commitment_id)}>
            <Text style={s.removeBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Section({ label, items, onDone, onRemove, acting }) {
  if (!items?.length) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      {items.map(item => <Row key={item.commitment_id} item={item} onDone={onDone} onRemove={onRemove} acting={acting} />)}
    </View>
  );
}

export default function TodayScreen({ user, onOpenNow, onSettings }) {
  const [doNow, setDoNow] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [checkinDue, setCheckinDue] = useState(false);
  const [staleProject, setStaleProject] = useState(null);
  // Forces a re-render every 30s purely so the two countdown pills tick
  // down on their own -- schedule itself only reloads on AppState changes,
  // which would otherwise leave "in 10m" frozen at whatever it read on load.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // Independent try/catch per call, not Promise.all around both -- these
    // are two unrelated data sources (the single "do this now" card vs. the
    // whole day's schedule), and Promise.all fails fast: one throwing used
    // to blank out BOTH, discarding a perfectly good schedule fetch just
    // because the other one 404'd or 500'd. Each should only ever affect
    // its own piece of the screen.
    const nowPromise = getInterventionNow(user.id).then(setDoNow).catch(() => {});
    const schedulePromise = getTodaySchedule(user.id).then(setSchedule).catch(() => {});
    await Promise.all([nowPromise, schedulePromise]);
    setLoading(false);

    // Best-effort, separate from the main load so a failure here never
    // blocks the actual home screen -- this is a sampling signal, not core.
    try {
      const [status, locallyOk] = await Promise.all([getIdentityCheckinStatus(user.id), shouldShowIdentityCheckin()]);
      setCheckinDue(!!status?.due && locallyOk);
    } catch { /* stay silent, this is optional data collection */ }

    // The "periodic check if a project has no progress" ask -- server-side
    // 7-day re-ask suppression (needsReviewOnly) already keeps this from
    // repeating every time Today loads once it's been answered once.
    try {
      const { stalled } = await getStalledProjects(user.id, true);
      setStaleProject(stalled?.[0] || null);
    } catch { /* best-effort -- worst case it just asks again next open */ }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

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

  // "Remove" -- for duplicates from re-attempting a time/title, or anything
  // no longer wanted. Sets status to 'abandoned' rather than deleting, so it
  // just drops out of every active-commitment query (here, NOW, the push
  // scheduler) without losing its history. No confirmation dialog: unlike
  // account deletion this is trivially low-stakes and specific to one item.
  async function handleRemove(commitmentId) {
    setActing(true);
    try {
      await updateCommitment(commitmentId, { status: 'abandoned' });
    } catch { /* best-effort -- worst case it just shows up again until retried */ }
    setActing(false);
    load();
  }

  // Previously the only way to bring a snoozed item back early was to wait
  // it out or hand-edit the database -- SNOOZED is its own section now (see
  // GET /commitments/today), with this as the one real action on it.
  async function handleUnsnooze(commitmentId) {
    setActing(true);
    try {
      await updateCommitment(commitmentId, { snoozed_until: null });
    } catch { /* best-effort -- worst case it just stays snoozed until retried */ }
    setActing(false);
    load();
  }

  const doneCount = schedule?.done_count ?? 0;
  const totalCount = schedule?.total_count ?? 0;
  const segments = Array.from({ length: Math.max(totalCount, 1) }, (_, i) => i < doneCount);

  const nextScheduled = findNextScheduled(schedule);
  // Ring "remaining" fraction for NEXT -- full disk means "not urgent yet,"
  // drained means it's arriving now. A wider horizon (e.g. 3h) makes the
  // drain too subtle to read at a glance (95% full looks the same as
  // 100%) -- a 60min window means the ring stays full until genuinely
  // close, then visibly empties through the final stretch.
  const NEXT_HORIZON_MIN = 60;
  const nextRemaining = nextScheduled ? clamp01(nextScheduled.minutes_until / NEXT_HORIZON_MIN) : 1;
  const dayW = dayWindow(user);
  const dayRemaining = dayW.state === 'before_wake' ? 1 : clamp01(dayW.minutesLeft / dayW.span);

  const morningItems = schedule ? [
    ...(schedule.sections.earlier_today || []),
    ...(schedule.sections.happening_now || []),
    ...(schedule.sections.coming_up || []),
    ...(schedule.sections.anytime || []),
  ].filter(isMorningFoundation) : [];

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

        <View style={s.timeCuesRow}>
          {nextScheduled && (
            <View style={s.timeCue}>
              <RingProgress
                fraction={nextRemaining} color="#f59e0b"
                label={fmtMinutesUntil(nextScheduled.minutes_until).replace('in ', '')}
              />
              <View style={s.timeCueTextCol}>
                <Text style={s.timeCueLabel}>NEXT</Text>
                <Text style={s.timeCueSub} numberOfLines={1}>{nextScheduled.title}</Text>
              </View>
            </View>
          )}
          <View style={s.timeCue}>
            <RingProgress
              fraction={dayRemaining} color="#6366f1"
              label={dayW.state === 'awake' ? fmtDuration(dayW.minutesLeft) : '💤'}
            />
            <View style={s.timeCueTextCol}>
              <Text style={s.timeCueLabel}>TIME LEFT</Text>
              <Text style={s.timeCueSub} numberOfLines={1}>
                {dayW.state === 'awake' ? 'left in your day'
                  : dayW.state === 'before_wake' ? "day hasn't started" : 'asleep'}
              </Text>
            </View>
          </View>
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

        <MorningRoutineCard items={morningItems} onDone={handleDone} acting={acting} />

        {doNow && doNow.state === 'busy' && (
          <TouchableOpacity style={s.busyCard} onPress={onOpenNow}>
            <Text style={s.busyLabel}>🔕 YOU'RE BUSY</Text>
            <Text style={s.busyTitle}>Marked unavailable until {fmtTime(new Date(doNow.busy_until).toTimeString().slice(0, 5))}</Text>
          </TouchableOpacity>
        )}

        {doNow && doNow.state !== 'clear' && doNow.state !== 'busy' && (
          <TouchableOpacity style={s.doNowCard} onPress={onOpenNow}>
            <Text style={s.doNowLabel}>🎯 DO THIS NOW</Text>
            <Text style={s.doNowTitle}>{doNow.action || doNow.message}</Text>
          </TouchableOpacity>
        )}

        {schedule && (
          <>
            <Section label="Earlier today" items={schedule.sections.earlier_today} onDone={handleDone} onRemove={handleRemove} acting={acting} />
            <Section label="Happening now" items={schedule.sections.happening_now} onDone={handleDone} onRemove={handleRemove} acting={acting} />
            <Section label="Coming up" items={schedule.sections.coming_up} onDone={handleDone} onRemove={handleRemove} acting={acting} />
            <Section label="Anytime" items={schedule.sections.anytime} onDone={handleDone} onRemove={handleRemove} acting={acting} />
            {schedule.sections.snoozed?.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Snoozed</Text>
                {schedule.sections.snoozed.map(item => (
                  <SnoozedRow key={item.commitment_id} item={item} onUnsnooze={handleUnsnooze} acting={acting} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <IdentityCheckinPrompt
        visible={checkinDue}
        user={user}
        onDone={() => setCheckinDue(false)}
      />

      {!checkinDue && staleProject && (
        <StaleProjectPrompt project={staleProject} onResolved={() => setStaleProject(null)} />
      )}
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
  timeCuesRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  timeCue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#273449', paddingVertical: 10, paddingHorizontal: 12 },
  timeCueTextCol: { flex: 1 },
  timeCueLabel: { fontSize: 9, fontWeight: '800', color: '#475569', letterSpacing: 0.6, marginBottom: 3 },
  timeCueSub: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  progressRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#1e293b' },
  segmentDone: { backgroundColor: '#34d399' },
  progressLabel: { fontSize: 11, color: '#64748b', marginTop: 6, textAlign: 'right' },
  doNowCard: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#6366f1', padding: 18, marginTop: 20, marginBottom: 8 },
  doNowLabel: { fontSize: 11, fontWeight: '800', color: '#818cf8', letterSpacing: 0.8, marginBottom: 8 },
  doNowTitle: { fontSize: 19, fontWeight: '800', color: '#fff', lineHeight: 25 },
  busyCard: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#334155', padding: 18, marginTop: 20, marginBottom: 8 },
  busyLabel: { fontSize: 11, fontWeight: '800', color: '#64748b', letterSpacing: 0.8, marginBottom: 8 },
  busyTitle: { fontSize: 16, fontWeight: '700', color: '#94a3b8', lineHeight: 22 },
  section: { marginTop: 22 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#475569', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  rowBar: { width: 3, height: 32, borderRadius: 2, backgroundColor: '#334155', marginRight: 12 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#f1f5f9' },
  rowTitleDone: { color: '#64748b', textDecorationLine: 'line-through' },
  rowTime: { fontSize: 12, color: '#64748b', marginTop: 2 },
  rowTimeDone: { color: '#475569' },
  rowActions: { alignItems: 'flex-end', gap: 6 },
  doneBtn: { borderWidth: 1, borderColor: '#334155', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  doneBtnText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  doneBadge: { color: '#34d399', fontSize: 12, fontWeight: '700' },
  removeBtnText: { color: '#475569', fontSize: 11, fontWeight: '600' },
  morningCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 16, marginTop: 20 },
  morningHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  morningTitle: { fontSize: 15, fontWeight: '800', color: '#f1f5f9' },
  morningCount: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  morningItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  morningCheck: { fontSize: 18, color: '#475569', marginRight: 10, width: 22, textAlign: 'center' },
  morningCheckDone: { color: '#34d399' },
  morningItemText: { fontSize: 14, fontWeight: '600', color: '#f1f5f9' },
  morningItemTextDone: { color: '#64748b', textDecorationLine: 'line-through' },
});
