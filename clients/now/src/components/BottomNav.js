/**
 * Persistent bottom tab bar, visible on every post-onboarding screen.
 * Order left to right: "Identity" (the Adaptive Allocation Engine's
 * spectrum reflection), "New" (ProjectsScreen -- adding anything: quick
 * tasks, multi-step projects, whatever, plus what's already in flight),
 * "Week" (WeekScreen -- the visual of the whole week: identity balance
 * plus everything due_date-scheduled the next 7 days, invisible anywhere
 * else once it's not today), "I'm Stuck" (momentary unsticking triage),
 * "Now" (the day's shape -- TodayScreen, "95% of usage" per NowScreen's
 * own header comment). Now gets a filled pill instead of plain
 * icon+label, always on regardless of which tab is actually active --
 * it's the one this whole app is built around, and blending into 4
 * identically-styled tabs undersold that.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function BottomNav({ active, onStuck, onNow, onProjects, onIdentity, onWeek }) {
  return (
    <View style={s.bar}>
      <TouchableOpacity style={s.tab} onPress={onIdentity}>
        <Text style={s.icon}>🪞</Text>
        <Text style={[s.label, active === 'identity' && s.labelActive]}>Identity</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.tab} onPress={onProjects}>
        <Text style={s.icon}>➕</Text>
        <Text style={[s.label, active === 'projects' && s.labelActive]}>New</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.tab} onPress={onWeek}>
        <Text style={s.icon}>📅</Text>
        <Text style={[s.label, active === 'week' && s.labelActive]}>Week</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.tab} onPress={onStuck}>
        <Text style={s.icon}>🆘</Text>
        <Text style={[s.label, active === 'stuck' && s.labelActive]}>I'm Stuck</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.tab} onPress={onNow}>
        <View style={[s.nowPill, active === 'now' && s.nowPillActive]}>
          <Text style={s.nowIcon}>🎯</Text>
          <Text style={s.nowLabel}>Now</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', backgroundColor: '#111827', borderTopWidth: 1, borderTopColor: '#1e293b',
    paddingBottom: 22, paddingTop: 10,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  icon: { fontSize: 18 },
  label: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  labelActive: { color: '#818cf8' },
  nowPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#6366f1', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  nowPillActive: { backgroundColor: '#818cf8' },
  nowIcon: { fontSize: 15 },
  nowLabel: { fontSize: 12, fontWeight: '800', color: '#fff' },
});
