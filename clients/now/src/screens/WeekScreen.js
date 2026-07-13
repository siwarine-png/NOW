/**
 * Week — the "visual of the week" the other tabs don't give you. Today only
 * ever shows today, and it deliberately hides anything due_date-scheduled
 * for a later day (see migration 025 / commitments.js's isDueByToday) --
 * without this screen, a task due Thursday was invisible everywhere from
 * the moment it was created until Thursday itself. Two halves:
 *
 *  - Identity balance: same per-axis desired-vs-current data the Identity
 *    tab shows, but read through two flags instead of raw numbers --
 *    "too many" (findCrowdedAxes, ProjectsScreen's own crowding signal:
 *    >2 simultaneously active projects on one axis) and "room to add"
 *    (current meaningfully below desired, i.e. there's real headroom to
 *    put something there). The two questions this whole screen exists to
 *    answer: what should I optimize/trim, and what could I actually add.
 *  - Scheduled this week: today through six days out, each day's due_date-
 *    tagged commitments. Not a full calendar -- just enough to see the
 *    week's shape at a glance, same "big picture, not another single-focus
 *    screen" gap Today's own full-day view filled for a single day.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { getIdentitySpectrum, getCommitments } from '../api/engine';
import { groupCommitments, findCrowdedAxes } from './ProjectsScreen';

const AXES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'achievement', label: 'Achievement' },
  { key: 'finance', label: 'Finance' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'recreation', label: 'Recreation' },
];

// Meaningfully below your own stated goal, not just imprecision noise --
// smaller than this and the axis reads as "on track" instead of "room to
// add," same spirit as IdentityScreen's own onTrack (gap < 1) just a
// slightly wider band since this screen is a coarser, at-a-glance read.
const ROOM_TO_ADD_THRESHOLD = 2;

function dateToKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysDateKey(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateToKey(d);
}

function formatDayLabel(dateKey, offset) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatDisplayTime(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fmtHours(min) {
  const h = min / 60;
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

// Same wake_time/sleep_time framing as Today's TIME LEFT ring -- "the day"
// worth showing a time-block breakdown for is the waking window, not
// literal midnight-to-midnight, and the same overnight-bedtime wrap
// handling as the engine's own wakingMinutes/isWithinWakingHours.
function wakingWindow(user) {
  const wake = timeToMinutes(user?.wake_time || '07:00');
  const sleep = timeToMinutes(user?.sleep_time || '23:00');
  const span = sleep > wake ? sleep - wake : (1440 - wake) + sleep;
  return { wake, span };
}

// Maps a raw HH:MM clock time onto "minutes since wake," wrapping past
// midnight the same way the span itself does, then clamps into [0, span]
// -- a step that starts before wake or runs past sleep still shows, just
// pinned to the visible edge instead of overflowing the bar.
function normalizeToWaking(hhmm, wake, span) {
  const min = timeToMinutes(hhmm);
  const sinceWake = min >= wake ? min - wake : min + (1440 - wake);
  return Math.max(0, Math.min(span, sinceWake));
}

// One horizontal bar's worth of blocks for a single day -- is_fixed items
// (events, migration 026) get their own color from ordinary tasks/habits,
// since "an appointment you attend" and "work you allocated yourself" read
// as different kinds of time-not-free. Untimed items (no window_start/end)
// don't occupy a slot at all -- there's no clock position to place them at.
function dayTimeBlocks(items, wake, span) {
  const timed = items.filter(c => c.window_start && c.window_end);
  const blocks = timed.map(c => {
    const start = normalizeToWaking(c.window_start, wake, span);
    const end = Math.max(start, normalizeToWaking(c.window_end, wake, span));
    return { id: c.id, fixed: !!c.is_fixed, startMin: start, minutes: end - start, leftPct: (start / span) * 100, widthPct: Math.max(((end - start) / span) * 100, 1) };
  }).filter(b => b.minutes > 0 || b.widthPct > 0);
  const allocatedMin = blocks.filter(b => !b.fixed).reduce((sum, b) => sum + b.minutes, 0);
  const fixedMin = blocks.filter(b => b.fixed).reduce((sum, b) => sum + b.minutes, 0);
  const freeMin = Math.max(0, span - allocatedMin - fixedMin);
  return { blocks, allocatedMin, fixedMin, freeMin };
}

export default function WeekScreen({ user }) {
  const [loading, setLoading] = useState(true);
  const [axes, setAxes] = useState([]);
  const [crowded, setCrowded] = useState([]);
  const [days, setDays] = useState([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [spectrum, active, paused] = await Promise.all([
        getIdentitySpectrum(user.id).catch(() => null),
        getCommitments(user.id, 'active'),
        getCommitments(user.id, 'paused'),
      ]);

      const all = [...(active || []), ...(paused || [])];
      const { projectRows } = groupCommitments(all);
      setCrowded(findCrowdedAxes(projectRows));

      if (spectrum?.axes) {
        setAxes(AXES.map(a => ({ ...a, ...spectrum.axes[a.key] })));
      }

      const weekKeys = Array.from({ length: 7 }, (_, i) => addDaysDateKey(i));
      const byDate = {};
      weekKeys.forEach(k => { byDate[k] = []; });
      all.forEach(c => { if (c.due_date && byDate[c.due_date]) byDate[c.due_date].push(c); });
      // A daily-recurring commitment (habit or event) has no single due_date
      // -- that's correct, it doesn't happen on one specific day -- but it
      // genuinely belongs on every day shown here, not nowhere. Weekly/
      // monthly recurrence has no stored day-of-week/day-of-month to place
      // it on a specific day with, so those still only show if they also
      // happen to have a due_date (a one-time task/event, not a real
      // recurring one) -- unresolved, not a bug, just not attempted here.
      const dailyRecurring = all.filter(c => c.cadence === 'daily' && !c.due_date);
      weekKeys.forEach(k => { byDate[k].push(...dailyRecurring); });
      setDays(weekKeys.map((k, i) => ({ key: k, label: formatDayLabel(k, i), items: byDate[k] })));
    } catch { /* keep whatever was last shown rather than a broken empty screen */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#6366f1" /></View>;

  const { wake, span } = wakingWindow(user);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>Week</Text>
        <Text style={s.subtitle}>Your 168 hours at a glance</Text>

        <Text style={s.sectionLabel}>IDENTITY BALANCE</Text>
        {axes.length === 0 ? (
          <Text style={s.emptyText}>Still collecting data — check the Identity tab as check-ins come in.</Text>
        ) : (
          <View style={s.section}>
            {axes.map(a => {
              const isCrowded = crowded.some(c => c.axis === a.key);
              const hasData = a.sample_count > 0;
              const gap = hasData ? Math.max(0, (a.desired_hours_per_week || 0) - (a.current_hours_per_week || 0)) : 0;
              const roomToAdd = hasData && !isCrowded && gap >= ROOM_TO_ADD_THRESHOLD;
              const pct = hasData && a.desired_hours_per_week > 0
                ? Math.min(100, Math.round((a.current_hours_per_week / a.desired_hours_per_week) * 100))
                : 0;

              return (
                <View key={a.key} style={s.axisCard}>
                  <View style={s.axisHeader}>
                    <Text style={s.axisLabel}>{a.label}</Text>
                    {isCrowded && <Text style={s.crowdedTag}>too many — consider trimming</Text>}
                    {roomToAdd && <Text style={s.roomTag}>room to add</Text>}
                  </View>
                  {hasData ? (
                    <>
                      <View style={s.track}>
                        <View style={[s.fill, { width: `${pct}%` }, isCrowded && s.fillCrowded]} />
                      </View>
                      <Text style={s.axisHours}>{a.current_hours_per_week}h / {a.desired_hours_per_week}h this week</Text>
                    </>
                  ) : (
                    <Text style={s.axisHoursDim}>collecting data…</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Text style={s.sectionLabel}>SCHEDULED THIS WEEK</Text>
        <View style={s.legendRow}>
          <View style={s.legendItem}><View style={[s.legendDot, s.blockFixed]} /><Text style={s.legendText}>Fixed</Text></View>
          <View style={s.legendItem}><View style={[s.legendDot, s.blockAllocated]} /><Text style={s.legendText}>Allocated</Text></View>
          <View style={s.legendItem}><View style={[s.legendDot, s.legendDotFree]} /><Text style={s.legendText}>Free</Text></View>
        </View>
        <View style={s.section}>
          {days.map(d => {
            const { blocks, allocatedMin, fixedMin, freeMin } = dayTimeBlocks(d.items, wake, span);
            return (
              <View key={d.key} style={s.dayCard}>
                <Text style={s.dayLabel}>{d.label}</Text>

                <View style={s.timeline}>
                  {blocks.map(b => (
                    <View
                      key={b.id}
                      style={[s.timelineBlock, b.fixed ? s.blockFixed : s.blockAllocated, { left: `${b.leftPct}%`, width: `${b.widthPct}%` }]}
                    />
                  ))}
                </View>
                <Text style={s.timelineSummary}>
                  {fixedMin > 0 ? `${fmtHours(fixedMin)} fixed · ` : ''}
                  {allocatedMin > 0 ? `${fmtHours(allocatedMin)} allocated · ` : ''}
                  {fmtHours(freeMin)} free
                </Text>

                {d.items.length === 0 ? (
                  <Text style={s.dayEmpty}>Nothing scheduled</Text>
                ) : d.items.map(item => (
                  <View key={item.id} style={s.dayItem}>
                    <Text style={s.dayItemTitle}>{item.title}</Text>
                    {formatDisplayTime(item.window_start) && (
                      <Text style={s.dayItemTime}>{formatDisplayTime(item.window_start)}</Text>
                    )}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: '900', color: '#f1f5f9' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2, marginBottom: 20 },
  emptyText: { fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#475569', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  section: { marginBottom: 20 },
  axisCard: { backgroundColor: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#273449' },
  axisHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
  axisLabel: { fontSize: 14, fontWeight: '800', color: '#f1f5f9' },
  crowdedTag: { fontSize: 11, fontWeight: '800', color: '#f59e0b' },
  roomTag: { fontSize: 11, fontWeight: '800', color: '#34d399' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#0f172a', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: '#6366f1' },
  fillCrowded: { backgroundColor: '#f59e0b' },
  axisHours: { fontSize: 12, color: '#94a3b8', marginTop: 6 },
  axisHoursDim: { fontSize: 12, color: '#475569', fontStyle: 'italic' },
  dayCard: { backgroundColor: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#273449' },
  dayLabel: { fontSize: 13, fontWeight: '800', color: '#818cf8', marginBottom: 8 },
  dayEmpty: { fontSize: 13, color: '#475569', fontStyle: 'italic' },
  dayItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#273449' },
  dayItemTitle: { fontSize: 14, color: '#f1f5f9', fontWeight: '600', flex: 1, marginRight: 8 },
  dayItemTime: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendDotFree: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  legendText: { fontSize: 11, color: '#64748b', fontWeight: '700' },
  timeline: { height: 14, borderRadius: 7, backgroundColor: '#0f172a', overflow: 'hidden', position: 'relative', marginBottom: 6 },
  timelineBlock: { position: 'absolute', top: 0, bottom: 0 },
  blockFixed: { backgroundColor: '#f59e0b' },
  blockAllocated: { backgroundColor: '#6366f1' },
  timelineSummary: { fontSize: 11, color: '#64748b', fontWeight: '600', marginBottom: 8 },
});
