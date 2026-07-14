/**
 * "What's your ONE thing today?" -- the morning half of the daily ritual
 * (see EveningDebriefPrompt for the evening half). Shown once per calendar
 * day (server-gated via daily_briefs.morning_completed_at, see
 * TodayScreen's morningBriefDue) once the day has actually started.
 * suggestedFocus (today's current DO-THIS-NOW pick) prefills the field so
 * confirming is the default path, not typing from scratch -- but this is
 * the user's OWN stated focus, not a copy of the algorithm's pick, which is
 * exactly what Evening Debrief compares "what I did" against later.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { postMorningBrief } from '../api/engine';

export default function MorningBriefPrompt({ user, suggestedFocus, onDone }) {
  const [focus, setFocus] = useState(suggestedFocus || '');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await postMorningBrief(user.id, focus.trim() || null);
    } catch (e) { /* best-effort -- worst case it asks again next open */ }
    setSaving(false);
    onDone();
  }

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>Good morning.{'\n'}What's your ONE thing today?</Text>
          <Text style={s.hint}>One focus, not a list -- you can always add to it later.</Text>
          <TextInput
            style={s.input} value={focus} onChangeText={setFocus}
            placeholder="e.g. Ship the Etsy listing" placeholderTextColor="#475569"
            multiline autoFocus
          />
          <TouchableOpacity style={[s.btn, (saving || !focus.trim()) && s.btnDisabled]} disabled={saving || !focus.trim()} onPress={submit}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>That's the one →</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.dismissBtn} disabled={saving} onPress={submit}>
            <Text style={s.dismissText}>Skip for today</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#1e293b', borderRadius: 18, padding: 22, width: '100%', maxWidth: 340 },
  title: { fontSize: 19, fontWeight: '900', color: '#f1f5f9', marginBottom: 6, lineHeight: 25 },
  hint: { fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 17 },
  input: { backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', padding: 12, fontSize: 14, color: '#f1f5f9', minHeight: 54, textAlignVertical: 'top', marginBottom: 16 },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  dismissBtn: { paddingVertical: 12, alignItems: 'center' },
  dismissText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
});
