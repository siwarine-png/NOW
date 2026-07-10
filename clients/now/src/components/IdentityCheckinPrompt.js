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
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { postIdentityCheckin } from '../api/engine';

const DISMISS_KEY = 'identity_checkin_dismissed_at_v1';
const DISMISS_COOLDOWN_MIN = 20;

const AXES = [
  { key: 'foundation', label: 'Foundation', hint: 'sleep, meals, movement' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'achievement', label: 'Achievement' },
  { key: 'finance', label: 'Finance' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'recreation', label: 'Recreation' },
];

export async function shouldShowIdentityCheckin() {
  const raw = await AsyncStorage.getItem(DISMISS_KEY);
  if (!raw) return true;
  const dismissedAt = Number(raw);
  return (Date.now() - dismissedAt) / 60_000 >= DISMISS_COOLDOWN_MIN;
}

export default function IdentityCheckinPrompt({ visible, user, onDone }) {
  const [saving, setSaving] = useState(false);

  async function choose(axisKey) {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await postIdentityCheckin(user.id, axisKey);
    } catch (e) {
      // Best-effort — this is a sampling signal, not a critical write. A
      // missed sample just means one fewer data point, not a broken flow.
    } finally {
      setSaving(false);
      onDone?.();
    }
  }

  async function dismiss() {
    await AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
    onDone?.();
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>What are you doing right now?</Text>
          <Text style={s.hint}>Tap one. Takes a second.</Text>
          <View style={s.grid}>
            {AXES.map(axis => (
              <TouchableOpacity key={axis.key} style={s.chip} disabled={saving} onPress={() => choose(axis.key)}>
                <Text style={s.chipText}>{axis.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.dismissBtn} disabled={saving} onPress={dismiss}>
            <Text style={s.dismissText}>Not now</Text>
          </TouchableOpacity>
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
  chipText: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
  dismissBtn: { paddingVertical: 8 },
  dismissText: { color: '#6366f1', fontSize: 13, fontWeight: '700' },
});
