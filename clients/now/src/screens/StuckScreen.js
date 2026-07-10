/**
 * "I'm Stuck" tab's primary screen — a momentary unsticking triage, not the
 * "register something new to track" flow that used to live directly behind
 * this tab (that's now AddPainPointScreen, reached via the secondary link
 * at the bottom). The distinction matters: being stuck right now is a
 * task-initiation / executive-function problem, not a "what should I be
 * tracking" problem, and the two need different tools.
 *
 * Every branch below is a fixed template, not generated text -- same
 * "deterministic-only in the intervention path" principle as the rest of
 * the engine, just applied client-side. Each category maps to one
 * evidence-based mechanism for ADHD task initiation:
 *   - "I don't know where to start" / "It's too big" -> task decomposition
 *     (show the smallest next concrete step, nothing else)
 *   - "Too many choices" -> choice reduction (top 3 only, hide the rest)
 *   - "I got distracted"  -> re-surface the current do-now action
 *   - "I forgot"          -> surface what's overdue
 *   - "I'm overwhelmed"   -> environmental restructuring (exactly one thing)
 * All of them reuse data the engine already produces (GET /interventions/now,
 * GET /commitments/today) -- no new backend surface needed.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { getInterventionNow, getTodaySchedule, postCheckin, postEquivalentCheckin } from '../api/engine';

const CATEGORIES = [
  { key: 'start', label: "I don't know where to start" },
  { key: 'big', label: "It's too big" },
  { key: 'choices', label: 'Too many choices' },
  { key: 'distracted', label: 'I got distracted' },
  { key: 'forgot', label: 'I forgot' },
  { key: 'overwhelmed', label: "I'm overwhelmed" },
];

const HEADINGS = {
  start: 'Just the first step',
  big: "Let's shrink it down",
  distracted: 'Back to it',
  overwhelmed: 'Just this one thing',
};

function fmtAction(text) { return text ? text.charAt(0).toUpperCase() + text.slice(1) : text; }

export default function StuckScreen({ user, onAddNew }) {
  const [loading, setLoading] = useState(true);
  const [intervention, setIntervention] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [stage, setStage] = useState('triage'); // triage | start | big | choices | distracted | forgot | overwhelmed | typed | done
  const [focusedItem, setFocusedItem] = useState(null); // a picked list item, when stage is choices/forgot
  const [customStep, setCustomStep] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [now, today] = await Promise.all([getInterventionNow(user.id), getTodaySchedule(user.id)]);
      setIntervention(now);
      setSchedule(today);
    } catch { /* keep whatever was last shown */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Runs once per arrival at "done" (not on every render) -- a setTimeout
  // called directly in the render body would re-arm on every re-render.
  useEffect(() => {
    if (stage !== 'done') return;
    const t = setTimeout(() => { backToTriage(); load(); }, 1600);
    return () => clearTimeout(t);
  }, [stage]);

  function backToTriage() {
    setStage('triage');
    setFocusedItem(null);
    setCustomStep('');
  }

  async function completeIntervention() {
    if (!intervention || acting) return;
    setActing(true);
    try {
      if (intervention.domain) {
        await postEquivalentCheckin(intervention.equivalent_id, 'done', null);
      } else if (intervention.commitment_id) {
        await postCheckin(intervention.commitment_id, 'done', null, intervention.intervention_id);
      }
    } catch { /* best-effort, same tolerance as the Now tab's own Done button */ }
    setActing(false);
    setStage('done');
  }

  async function completeItem(commitmentId) {
    if (acting) return;
    setActing(true);
    try {
      await postCheckin(commitmentId, 'done', null, null);
    } catch { /* best-effort */ }
    setActing(false);
    setStage('done');
  }

  const hasLiveAction = intervention && intervention.state !== 'clear' && intervention.action;

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#6366f1" /></View>;

  if (stage === 'done') {
    return (
      <View style={s.screen}>
        <View style={s.center}>
          <Text style={s.doneEmoji}>🎯</Text>
          <Text style={s.doneText}>Done.</Text>
        </View>
      </View>
    );
  }

  if (stage === 'triage') return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>What's stopping you{'\n'}right now?</Text>
        <View style={s.list}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity key={cat.key} style={s.optionBtn} onPress={() => setStage(cat.key)}>
              <Text style={s.optionText}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={s.linkBtn} onPress={onAddNew}>
          <Text style={s.linkBtnText}>Something new to track →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  if (stage === 'start' || stage === 'big' || stage === 'distracted' || stage === 'overwhelmed') {
    if (!hasLiveAction) return (
      <View style={s.screen}>
        <ScrollView contentContainerStyle={s.scroll}>
          {!customStep ? (
            <>
              <Text style={s.title}>Nothing's due right now.{'\n'}What's the smallest thing{'\n'}you could do?</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. open the document"
                placeholderTextColor="#475569"
                onSubmitEditing={e => setCustomStep(e.nativeEvent.text.trim())}
                returnKeyType="done"
                autoFocus
              />
              <Text style={s.hint}>Type it and hit enter.</Text>
            </>
          ) : (
            <View style={s.center}>
              <Text style={s.actionLabel}>DO EXACTLY THIS</Text>
              <Text style={s.bigAction}>{customStep}</Text>
              <Text style={s.hint}>Nothing else. Just that.</Text>
            </View>
          )}
          <TouchableOpacity style={s.linkBtn} onPress={backToTriage}>
            <Text style={s.linkBtnText}>← Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );

    return (
      <View style={s.screen}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.title}>{HEADINGS[stage]}</Text>
          <View style={s.actionBox}>
            <Text style={s.actionLabel}>START HERE</Text>
            <Text style={s.action}>{intervention.action}</Text>
          </View>
          <TouchableOpacity style={[s.doneBtn, acting && s.btnDisabled]} disabled={acting} onPress={completeIntervention}>
            {acting ? <ActivityIndicator color="#fff" /> : <Text style={s.doneBtnText}>Done ✓</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={backToTriage} disabled={acting}>
            <Text style={s.linkBtnText}>← Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (stage === 'choices' || stage === 'forgot') {
    const candidates = stage === 'choices'
      ? [...(schedule?.sections.happening_now || []), ...(schedule?.sections.coming_up || [])].filter(i => !i.done).slice(0, 3)
      : (schedule?.sections.earlier_today || []).filter(i => !i.done).slice(0, 3);

    if (focusedItem) return (
      <View style={s.screen}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.title}>Just this one</Text>
          <View style={s.actionBox}>
            <Text style={s.actionLabel}>START HERE</Text>
            <Text style={s.action}>{fmtAction(focusedItem.title)}</Text>
          </View>
          <TouchableOpacity
            style={[s.doneBtn, acting && s.btnDisabled]} disabled={acting}
            onPress={() => completeItem(focusedItem.commitment_id)}
          >
            {acting ? <ActivityIndicator color="#fff" /> : <Text style={s.doneBtnText}>Done ✓</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setFocusedItem(null)} disabled={acting}>
            <Text style={s.linkBtnText}>← Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );

    return (
      <View style={s.screen}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.title}>{stage === 'choices' ? 'Choose one.' : "What's overdue"}</Text>
          {candidates.length === 0 ? (
            <Text style={s.hint}>{stage === 'choices' ? "Nothing waiting right now — you're clear." : 'Nothing overdue. Nice.'}</Text>
          ) : (
            <View style={s.list}>
              {candidates.map((item, i) => (
                <TouchableOpacity key={item.commitment_id} style={s.optionBtn} onPress={() => setFocusedItem(item)}>
                  <Text style={s.optionNum}>{i + 1}</Text>
                  <Text style={s.optionText}>{item.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity style={s.linkBtn} onPress={backToTriage}>
            <Text style={s.linkBtnText}>← Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return null;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 24, paddingTop: 60, paddingBottom: 48, flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  title: { fontSize: 24, fontWeight: '900', color: '#f1f5f9', lineHeight: 31, marginBottom: 24, textAlign: 'center' },
  list: { gap: 10 },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1e293b', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#334155' },
  optionNum: { color: '#6366f1', fontSize: 15, fontWeight: '900', width: 18 },
  optionText: { color: '#f1f5f9', fontSize: 15, fontWeight: '700', flex: 1 },
  linkBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  linkBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 12 },
  input: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, fontSize: 16, color: '#f1f5f9', borderWidth: 1, borderColor: '#334155', textAlign: 'center' },
  actionLabel: { fontSize: 11, fontWeight: '800', color: '#6366f1', letterSpacing: 1, marginBottom: 10, textAlign: 'center' },
  bigAction: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center', lineHeight: 30 },
  actionBox: { backgroundColor: '#1e293b', borderRadius: 14, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#6366f1' },
  action: { fontSize: 19, fontWeight: '700', color: '#fff', lineHeight: 26, textAlign: 'center' },
  doneBtn: { backgroundColor: '#6366f1', borderRadius: 14, padding: 18, alignItems: 'center' },
  doneBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  doneEmoji: { fontSize: 64, marginBottom: 16 },
  doneText: { fontSize: 32, fontWeight: '900', color: '#f1f5f9' },
});
