/**
 * "What's your ONE thing today?" -- the morning half of the daily ritual
 * (see EveningDebriefPrompt for the evening half). Shown once per calendar
 * day (server-gated via daily_briefs.morning_completed_at, see
 * TodayScreen's morningBriefDue) once the day has actually started.
 *
 * Leads with a pick-from-what-already-exists list (Projects/Events/
 * Habits/Todos, same grouping ProjectsScreen's New tab uses) rather than a
 * blank text box -- the whole point of naming ONE focus is committing to
 * something real already in flight, not describing a new thing from
 * scratch (that's Parking Lot's job). The text field stays underneath as
 * a fallback/refinement, not the primary path.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { postMorningBrief, getCommitments } from '../api/engine';
import { groupCommitments } from '../screens/ProjectsScreen';

function PickGroup({ label, items, getTitle, focus, onPick }) {
  if (!items.length) return null;
  return (
    <View style={s.pickGroup}>
      <Text style={s.pickLabel}>{label}</Text>
      {items.map((item, i) => {
        const title = getTitle(item);
        const selected = focus.trim() === title;
        return (
          <TouchableOpacity key={i} style={[s.pickRow, selected && s.pickRowSelected]} onPress={() => onPick(title)}>
            <Text style={[s.pickRowText, selected && s.pickRowTextSelected]} numberOfLines={1}>{title}</Text>
            {selected && <Text style={s.pickCheck}>✓</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function MorningBriefPrompt({ user, suggestedFocus, onDone }) {
  const [focus, setFocus] = useState(suggestedFocus || '');
  const [saving, setSaving] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [groups, setGroups] = useState({ projects: [], events: [], habits: [], todos: [] });

  useEffect(() => {
    let cancelled = false;
    getCommitments(user.id, 'active')
      .then(all => {
        if (cancelled) return;
        const { projectRows, eventRows, quickRows } = groupCommitments(all || []);
        setGroups({
          projects: projectRows.map(r => r.project),
          events: eventRows,
          habits: quickRows.filter(c => c.cadence !== 'once'),
          todos: quickRows.filter(c => c.cadence === 'once'),
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingItems(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

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
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.title}>Good morning.{'\n'}What's your ONE thing today?</Text>
            <Text style={s.hint}>Pick one already in flight, or write your own below.</Text>

            {loadingItems ? (
              <ActivityIndicator color="#6366f1" style={s.loadingSpinner} />
            ) : (
              <>
                <PickGroup label="PROJECTS" items={groups.projects} getTitle={p => p.title} focus={focus} onPick={setFocus} />
                <PickGroup label="EVENTS" items={groups.events} getTitle={e => e.title} focus={focus} onPick={setFocus} />
                <PickGroup label="HABITS" items={groups.habits} getTitle={h => h.title} focus={focus} onPick={setFocus} />
                <PickGroup label="TODOS" items={groups.todos} getTitle={t => t.title} focus={focus} onPick={setFocus} />
              </>
            )}

            <TextInput
              style={s.input} value={focus} onChangeText={setFocus}
              placeholder="Or write your own focus..." placeholderTextColor="#475569"
              multiline
            />
            <TouchableOpacity style={[s.btn, (saving || !focus.trim()) && s.btnDisabled]} disabled={saving || !focus.trim()} onPress={submit}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>That's the one →</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.dismissBtn} disabled={saving} onPress={submit}>
              <Text style={s.dismissText}>Skip for today</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#1e293b', borderRadius: 18, padding: 22, width: '100%', maxWidth: 360, maxHeight: '85%' },
  title: { fontSize: 19, fontWeight: '900', color: '#f1f5f9', marginBottom: 6, lineHeight: 25 },
  hint: { fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 17 },
  loadingSpinner: { marginVertical: 12 },
  pickGroup: { marginBottom: 10 },
  pickLabel: { fontSize: 10, fontWeight: '800', color: '#475569', letterSpacing: 0.6, marginBottom: 4 },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 3 },
  pickRowSelected: { backgroundColor: '#312e81' },
  pickRowText: { fontSize: 13, color: '#cbd5e1', fontWeight: '600', flex: 1, marginRight: 8 },
  pickRowTextSelected: { color: '#c7d2fe', fontWeight: '800' },
  pickCheck: { color: '#818cf8', fontSize: 13, fontWeight: '900' },
  input: { backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', padding: 12, fontSize: 14, color: '#f1f5f9', minHeight: 54, textAlignVertical: 'top', marginTop: 4, marginBottom: 16 },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  dismissBtn: { paddingVertical: 12, alignItems: 'center' },
  dismissText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
});
