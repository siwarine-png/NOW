/**
 * "Periodically check if a project has no progress: still going, or pause
 * it, and why" -- shown on Today (whenever it loads and a project qualifies,
 * see getStalledProjects's needsReviewOnly filter) rather than as a push
 * notification, to avoid needing a separate push-dedup scheme on top of the
 * 7-day re-ask suppression the API already does. Opening the app and seeing
 * this is the "periodic check"; answering it (either way) resets the clock
 * for another 7 days.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { reviewStaleProject } from '../api/engine';

export default function StaleProjectPrompt({ project, onResolved }) {
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function answer(action) {
    setSaving(true);
    try {
      await reviewStaleProject(project.commitment_id, action, action === 'pause' ? reason.trim() : undefined);
    } catch (e) { /* best-effort -- worst case it asks again next time */ }
    setSaving(false);
    onResolved();
  }

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>Still going?</Text>
          <Text style={s.body}>
            "{project.title}" has been quiet for {project.days_stalled} days.
          </Text>

          {!pausing ? (
            <>
              <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} disabled={saving} onPress={() => answer('continue')}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Still going</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => setPausing(true)} disabled={saving}>
                <Text style={s.btnText}>Pause it</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.hint}>What's the reason? (optional)</Text>
              <TextInput
                style={s.input}
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. waiting on something else first"
                placeholderTextColor="#475569"
                multiline
                autoFocus
              />
              <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} disabled={saving} onPress={() => answer('pause')}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Confirm pause</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.linkBtn} onPress={() => setPausing(false)} disabled={saving}>
                <Text style={s.linkBtnText}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#1e293b', borderRadius: 18, padding: 22, width: '100%', maxWidth: 340 },
  title: { fontSize: 19, fontWeight: '900', color: '#f1f5f9', marginBottom: 8 },
  body: { fontSize: 14, color: '#94a3b8', lineHeight: 20, marginBottom: 20 },
  hint: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  input: { backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', padding: 12, fontSize: 14, color: '#f1f5f9', minHeight: 60, textAlignVertical: 'top', marginBottom: 16 },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  btnSecondary: { backgroundColor: '#334155' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  linkBtn: { paddingVertical: 12, alignItems: 'center' },
  linkBtnText: { color: '#818cf8', fontSize: 13, fontWeight: '700' },
});
