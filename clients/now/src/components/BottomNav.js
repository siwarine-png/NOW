/**
 * Persistent bottom tab bar, visible on every post-onboarding screen.
 * 3 tabs: "I'm Stuck" (add a new pain point, any time -- not just once at
 * onboarding), "Now" (the day's shape -- TodayScreen), and "Identity" (the
 * Adaptive Allocation Engine's spectrum reflection -- IdentityScreen).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function BottomNav({ active, onStuck, onNow, onIdentity }) {
  return (
    <View style={s.bar}>
      <TouchableOpacity style={s.tab} onPress={onStuck}>
        <Text style={s.icon}>🆘</Text>
        <Text style={[s.label, active === 'stuck' && s.labelActive]}>I'm Stuck</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.tab} onPress={onNow}>
        <Text style={s.icon}>🎯</Text>
        <Text style={[s.label, active === 'now' && s.labelActive]}>Now</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.tab} onPress={onIdentity}>
        <Text style={s.icon}>🪞</Text>
        <Text style={[s.label, active === 'identity' && s.labelActive]}>Identity</Text>
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
});
