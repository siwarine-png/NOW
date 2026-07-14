/**
 * Projects — a proper home for "what's actually in flight," separate from
 * the single-focus Now tab and I'm Stuck's momentary triage. There's no
 * dedicated "projects" table: a project IS just a commitment other
 * commitments reference via parent_commitment_id (the same decomposition
 * mechanic Day Arc's checklist uses, see engine/decomposition.js and
 * engine/projects.js's stalled-project detection) -- this screen groups
 * the existing commitment list into that shape client-side.
 *
 * "+ Something new" reuses AddPainPointScreen unchanged (App.js routes it
 * to the same screen the old "I'm Stuck" secondary link still points to) --
 * this doesn't duplicate that flow, just gives it a proper, discoverable
 * home instead of only being reachable from being stuck.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { getCommitments, updateCommitment, addProjectStep, getParkingLot, addParkingLotItem, resolveParkingLotItem } from '../api/engine';
import { showAlert } from '../utils/alert';

function axisLabel(axis) {
  if (!axis) return null;
  return axis.charAt(0).toUpperCase() + axis.slice(1);
}

function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const CADENCE_LABEL = { daily: 'Every day', weekly: 'Every week', monthly: 'Once a month' };

function eventSchedule(e) {
  const time = fmtTime(e.window_start);
  if (e.cadence !== 'once') return `${CADENCE_LABEL[e.cadence] || e.cadence}${time ? ` · ${time}` : ''}`;
  if (!e.due_date) return time;
  const [y, m, d] = e.due_date.split('-').map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return time ? `${dateLabel} · ${time}` : dateLabel;
}

// Relative importance between concurrently active projects (e.g. "Day Arc
// matters more than BUMP right now") -- feeds into the risk scorer's
// priority_boost factor (engine/risk.js) so a higher-priority project's
// current step wins the DO-THIS-NOW rotation more often, without being an
// absolute override the way priority_tier: 'critical' is. null (unset)
// reads as Normal (2) everywhere this is checked, client and engine both.
const PRIORITY_LEVELS = [
  { level: 1, label: 'Low' },
  { level: 2, label: 'Normal' },
  { level: 3, label: 'High' },
];

// A cheap first-pass crowding signal: more than 2 simultaneously active
// projects on the same axis, competing for the same slice of attention.
// This deliberately doesn't try to weigh it against current_hours_per_week
// (Identity tab) -- that estimate needs 10+ identity_checkins samples
// before it's reliable (see identityAggregate.js's low_confidence), so
// leaning on it here for a brand-new account would just produce another
// wild, overconfident number. Plain project count needs no such runway.
const CROWDED_THRESHOLD = 2;

export function findCrowdedAxes(projectRows) {
  const counts = {};
  projectRows.forEach(({ project }) => {
    if (project.status !== 'active' || !project.identity_axis) return;
    counts[project.identity_axis] = (counts[project.identity_axis] || 0) + 1;
  });
  return Object.entries(counts)
    .filter(([, count]) => count > CROWDED_THRESHOLD)
    .map(([axis, count]) => ({ axis, count }));
}

// Shared with WeekScreen (the weekly identity-balance view needs the same
// "what's a project vs. a standalone task" split, not just the crowding
// number) -- a project IS just a commitment other commitments reference via
// parent_commitment_id, no dedicated table (see engine/decomposition.js).
// eventRows is_fixed split out from quickRows the same way -- is_fixed
// (migration 026) is the one persisted signal that survives past creation
// time (itemKind itself is only ever client-side wizard state, gone the
// moment the commitment exists), so it's what every later screen has to
// derive "is this an event" from, not a stored "kind" column.
export function groupCommitments(all) {
  const childrenByParent = new Map();
  all.forEach(c => {
    if (!c.parent_commitment_id) return;
    if (!childrenByParent.has(c.parent_commitment_id)) childrenByParent.set(c.parent_commitment_id, []);
    childrenByParent.get(c.parent_commitment_id).push(c);
  });

  const projectRows = [];
  const eventRows = [];
  const quickRows = [];
  all.forEach(c => {
    if (c.parent_commitment_id) return; // it's a step, not a project of its own
    const children = childrenByParent.get(c.id) || [];
    if (children.length) {
      projectRows.push({ project: c, currentStep: children.find(ch => ch.status === 'active') || null });
    } else if (c.is_fixed) {
      eventRows.push(c);
    } else {
      quickRows.push(c);
    }
  });
  return { projectRows, eventRows, quickRows };
}

export default function ProjectsScreen({ user, onAddNew, onConvertIdea }) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [events, setEvents] = useState([]);
  const [quickTasks, setQuickTasks] = useState([]);
  const [parkingLot, setParkingLot] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [addingStepFor, setAddingStepFor] = useState(null);
  const [stepInput, setStepInput] = useState('');
  const [addingStep, setAddingStep] = useState(false);
  const [ideaInput, setIdeaInput] = useState('');
  const [parkingIdea, setParkingIdea] = useState(false);
  const [resolvingIdeaId, setResolvingIdeaId] = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // active + paused covers everything still "in flight" -- completed/
      // abandoned commitments aren't part of the picture this screen answers.
      const [active, paused, parked] = await Promise.all([
        getCommitments(user.id, 'active'),
        getCommitments(user.id, 'paused'),
        getParkingLot(user.id).catch(() => []),
      ]);
      const all = [...(active || []), ...(paused || [])];
      const { projectRows, eventRows, quickRows } = groupCommitments(all);
      setProjects(projectRows);
      setEvents(eventRows);
      setQuickTasks(quickRows);
      setParkingLot(parked || []);
    } catch { /* keep whatever was last shown rather than a broken empty screen */ }
    finally { setLoading(false); }
  }, [user]);

  function toggleSelect(id) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Optimistic local update (setProjects) so the tap feels instant, plus a
  // real reload underneath -- the engine reads this from the parent for
  // every child step's own scoring, so a stale local cache would just be a
  // display quirk, not a real scoring bug either way.
  async function setPriority(projectId, level) {
    setProjects(rows => rows.map(r => r.project.id === projectId ? { ...r, project: { ...r.project, project_priority: level } } : r));
    try {
      await updateCommitment(projectId, { project_priority: level });
    } catch (e) { /* best-effort -- worst case it reverts on next load */ }
  }

  function toggleAddStep(projectId) {
    setAddingStepFor(current => (current === projectId ? null : projectId));
    setStepInput('');
  }

  // No optimistic local update here (unlike setPriority) -- whether the new
  // step lands 'active' or 'paused' depends on server-side state (is
  // anything already active on this project?) this screen doesn't track
  // precisely enough to predict, so a real reload is the only way to show
  // the right currentStep afterward.
  async function submitAddStep(projectId) {
    const title = stepInput.trim();
    if (!title) return;
    setAddingStep(true);
    try {
      await addProjectStep(projectId, title);
      setAddingStepFor(null);
      setStepInput('');
      await load();
    } catch (e) {
      showAlert("Couldn't add that step", e.message);
    } finally {
      setAddingStep(false);
    }
  }

  // Fastest possible capture -- no kind/axis/schedule questions, unlike
  // "+ Something new." That friction is exactly what Parking Lot exists to
  // route around (see migration 028's header comment): jot it down, decide
  // later whether it's worth becoming a real commitment.
  async function submitIdea() {
    const title = ideaInput.trim();
    if (!title || !user?.id) return;
    setParkingIdea(true);
    try {
      await addParkingLotItem(user.id, title);
      setIdeaInput('');
      await load();
    } catch (e) {
      showAlert("Couldn't park that", e.message);
    } finally {
      setParkingIdea(false);
    }
  }

  async function dismissIdea(id) {
    setResolvingIdeaId(id);
    try {
      await resolveParkingLotItem(id, 'dismissed');
      setParkingLot(rows => rows.filter(r => r.id !== id));
    } catch (e) { /* best-effort -- worst case it reappears until retried */ }
    setResolvingIdeaId(null);
  }

  // Marking it 'converted' happens once AddPainPointScreen actually creates
  // something (App.js wires this through onCreated), not the moment this is
  // tapped -- backing out of that wizard should leave the idea still parked,
  // not silently lose it.
  function convertIdea(item) {
    onConvertIdea?.(item);
  }

  // Same abandon-not-delete semantics as every other Remove in this app --
  // drops each selected item out of every active-commitment query without
  // losing history. Only prompts a confirm here (unlike the single-item
  // Remove elsewhere) since acting on several at once is easier to fat-
  // finger and harder to individually undo by eye.
  async function handleBulkDelete() {
    if (!selected.size) return;
    showAlert(
      `Remove ${selected.size} item${selected.size === 1 ? '' : 's'}?`,
      null,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            setDeleting(true);
            try {
              await Promise.all([...selected].map(id => updateCommitment(id, { status: 'abandoned' })));
            } catch (e) { /* best-effort -- worst case some remain until retried */ }
            setSelected(new Set());
            setDeleting(false);
            load();
          },
        },
      ]
    );
  }

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#6366f1" /></View>;

  const crowded = findCrowdedAxes(projects);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>New</Text>
        <Text style={s.subtitle}>Add something, or see what's already in flight</Text>

        {crowded.length > 0 && (
          <View style={s.crowdedBox}>
            <Text style={s.crowdedTitle}>⚠ Getting crowded</Text>
            {crowded.map(c => (
              <Text key={c.axis} style={s.crowdedText}>
                {c.count} active projects in {axisLabel(c.axis)} — worth pausing one before starting another there.
              </Text>
            ))}
          </View>
        )}

        {projects.length === 0 && events.length === 0 && quickTasks.length === 0 && (
          <Text style={s.emptyText}>Nothing tracked yet — tap below to add something.</Text>
        )}

        {projects.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>PROJECTS</Text>
            {projects.map(({ project, currentStep }) => (
              <View key={project.id} style={s.card}>
                <View style={s.cardHeader}>
                  <View style={s.cardHeaderLeft}>
                    <TouchableOpacity style={[s.checkbox, selected.has(project.id) && s.checkboxChecked]} onPress={() => toggleSelect(project.id)}>
                      {selected.has(project.id) && <Text style={s.checkboxMark}>✓</Text>}
                    </TouchableOpacity>
                    <Text style={s.cardTitle}>{project.title}</Text>
                  </View>
                  {project.status === 'paused' && <Text style={s.pausedBadge}>⏸ Paused</Text>}
                </View>
                {project.identity_axis && <Text style={s.cardAxis}>{axisLabel(project.identity_axis)}</Text>}
                <View style={s.priorityRow}>
                  {PRIORITY_LEVELS.map(p => (
                    <TouchableOpacity
                      key={p.level}
                      style={[s.priorityChip, (project.project_priority ?? 2) === p.level && s.priorityChipActive]}
                      onPress={() => setPriority(project.id, p.level)}
                    >
                      <Text style={[s.priorityChipText, (project.project_priority ?? 2) === p.level && s.priorityChipTextActive]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {project.status === 'paused' ? (
                  <Text style={s.pausedReason}>
                    {project.paused_reason ? `"${project.paused_reason}"` : 'Paused, no reason given'}
                  </Text>
                ) : (
                  <Text style={s.currentStep}>
                    {currentStep ? `Current step: ${currentStep.title}` : 'No active step right now'}
                  </Text>
                )}

                {addingStepFor === project.id ? (
                  <View style={s.addStepRow}>
                    <TextInput
                      style={s.addStepInput} value={stepInput} onChangeText={setStepInput}
                      placeholder="e.g. Order the shipping labels" placeholderTextColor="#475569"
                      autoFocus onSubmitEditing={() => submitAddStep(project.id)} returnKeyType="done"
                    />
                    <TouchableOpacity
                      style={[s.addStepBtn, (addingStep || !stepInput.trim()) && s.btnDisabled]}
                      disabled={addingStep || !stepInput.trim()}
                      onPress={() => submitAddStep(project.id)}
                    >
                      {addingStep ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.addStepBtnText}>Add</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={s.addStepCancel} onPress={() => toggleAddStep(project.id)}>
                      <Text style={s.addStepCancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={s.addStepLink} onPress={() => toggleAddStep(project.id)}>
                    <Text style={s.addStepLinkText}>+ Add step</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {events.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>EVENTS</Text>
            {events.map(e => (
              <View key={e.id} style={s.card}>
                <View style={s.cardHeader}>
                  <View style={s.cardHeaderLeft}>
                    <TouchableOpacity style={[s.checkbox, selected.has(e.id) && s.checkboxChecked]} onPress={() => toggleSelect(e.id)}>
                      {selected.has(e.id) && <Text style={s.checkboxMark}>✓</Text>}
                    </TouchableOpacity>
                    <Text style={s.cardTitle}>{e.title}</Text>
                  </View>
                </View>
                {e.identity_axis && <Text style={s.cardAxis}>{axisLabel(e.identity_axis)}</Text>}
                <Text style={s.currentStep}>{eventSchedule(e)}</Text>
              </View>
            ))}
          </View>
        )}

        {quickTasks.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>TASKS</Text>
            {quickTasks.map(t => (
              <View key={t.id} style={s.card}>
                <View style={s.cardHeader}>
                  <View style={s.cardHeaderLeft}>
                    <TouchableOpacity style={[s.checkbox, selected.has(t.id) && s.checkboxChecked]} onPress={() => toggleSelect(t.id)}>
                      {selected.has(t.id) && <Text style={s.checkboxMark}>✓</Text>}
                    </TouchableOpacity>
                    <Text style={s.cardTitle}>{t.title}</Text>
                  </View>
                </View>
                {t.identity_axis && <Text style={s.cardAxis}>{axisLabel(t.identity_axis)}</Text>}
              </View>
            ))}
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionLabel}>PARKING LOT</Text>
          <Text style={s.parkingHint}>New idea? Jot it here instead of chasing it right now.</Text>
          <View style={s.ideaRow}>
            <TextInput
              style={s.ideaInput} value={ideaInput} onChangeText={setIdeaInput}
              placeholder="e.g. Voice-first capture" placeholderTextColor="#475569"
              onSubmitEditing={submitIdea} returnKeyType="done"
            />
            <TouchableOpacity
              style={[s.ideaBtn, (parkingIdea || !ideaInput.trim()) && s.btnDisabled]}
              disabled={parkingIdea || !ideaInput.trim()} onPress={submitIdea}
            >
              {parkingIdea ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.ideaBtnText}>Park it</Text>}
            </TouchableOpacity>
          </View>
          {parkingLot.map(item => (
            <View key={item.id} style={s.ideaCard}>
              <Text style={s.ideaTitle}>{item.title}</Text>
              <View style={s.ideaActions}>
                <TouchableOpacity disabled={resolvingIdeaId === item.id} onPress={() => convertIdea(item)}>
                  <Text style={s.convertText}>Convert</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={resolvingIdeaId === item.id} onPress={() => dismissIdea(item.id)}>
                  <Text style={s.dismissIdeaText}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {selected.size > 0 && (
        <TouchableOpacity style={[s.deleteBtn, deleting && s.btnDisabled]} onPress={handleBulkDelete} disabled={deleting}>
          {deleting
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.deleteBtnText}>Remove {selected.size} selected</Text>}
        </TouchableOpacity>
      )}

      <TouchableOpacity style={s.addBtn} onPress={onAddNew}>
        <Text style={s.addBtnText}>+ Something new</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: '900', color: '#f1f5f9' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2, marginBottom: 20 },
  emptyText: { fontSize: 14, color: '#64748b', marginTop: 20, lineHeight: 20 },
  crowdedBox: { backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b', padding: 14, marginBottom: 18 },
  crowdedTitle: { fontSize: 13, fontWeight: '800', color: '#f59e0b', marginBottom: 6 },
  crowdedText: { fontSize: 13, color: '#94a3b8', lineHeight: 18 },
  section: { marginTop: 8, marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#475569', letterSpacing: 0.8, marginBottom: 10 },
  card: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#273449' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: '#475569', marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '900', lineHeight: 14 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#f1f5f9', flex: 1 },
  cardAxis: { fontSize: 11, color: '#818cf8', fontWeight: '700', marginTop: 4 },
  priorityRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  priorityChip: { backgroundColor: '#0f172a', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: '#334155' },
  priorityChipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  priorityChipText: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  priorityChipTextActive: { color: '#fff' },
  currentStep: { fontSize: 13, color: '#94a3b8', marginTop: 8 },
  pausedBadge: { fontSize: 11, fontWeight: '800', color: '#f59e0b' },
  pausedReason: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic', marginTop: 8 },
  addStepLink: { marginTop: 10 },
  addStepLinkText: { fontSize: 12, fontWeight: '700', color: '#818cf8' },
  addStepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  addStepInput: { flex: 1, minWidth: 120, backgroundColor: '#0f172a', borderRadius: 8, borderWidth: 1, borderColor: '#334155', paddingVertical: 8, paddingHorizontal: 10, color: '#f1f5f9', fontSize: 13 },
  addStepBtn: { backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  addStepBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  addStepCancel: { paddingVertical: 8, paddingHorizontal: 6 },
  addStepCancelText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  parkingHint: { fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 17 },
  ideaRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  ideaInput: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155', paddingVertical: 10, paddingHorizontal: 12, color: '#f1f5f9', fontSize: 14 },
  ideaBtn: { backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, justifyContent: 'center' },
  ideaBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  ideaCard: { backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#273449', borderStyle: 'dashed', padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ideaTitle: { fontSize: 14, color: '#f1f5f9', fontWeight: '600', flex: 1, marginRight: 10 },
  ideaActions: { flexDirection: 'row', gap: 14 },
  convertText: { color: '#818cf8', fontSize: 12, fontWeight: '700' },
  dismissIdeaText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  deleteBtn: { backgroundColor: '#7f1d1d', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginHorizontal: 20, marginBottom: 10, borderWidth: 1, borderColor: '#dc2626' },
  deleteBtnText: { color: '#fecaca', fontSize: 15, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  addBtn: { backgroundColor: '#6366f1', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginHorizontal: 20, marginBottom: 28 },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
