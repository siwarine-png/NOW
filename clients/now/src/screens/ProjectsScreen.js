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
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { getCommitments } from '../api/engine';

function axisLabel(axis) {
  if (!axis) return null;
  return axis.charAt(0).toUpperCase() + axis.slice(1);
}

// A cheap first-pass crowding signal: more than 2 simultaneously active
// projects on the same axis, competing for the same slice of attention.
// This deliberately doesn't try to weigh it against current_hours_per_week
// (Identity tab) -- that estimate needs 10+ identity_checkins samples
// before it's reliable (see identityAggregate.js's low_confidence), so
// leaning on it here for a brand-new account would just produce another
// wild, overconfident number. Plain project count needs no such runway.
const CROWDED_THRESHOLD = 2;

function findCrowdedAxes(projectRows) {
  const counts = {};
  projectRows.forEach(({ project }) => {
    if (project.status !== 'active' || !project.identity_axis) return;
    counts[project.identity_axis] = (counts[project.identity_axis] || 0) + 1;
  });
  return Object.entries(counts)
    .filter(([, count]) => count > CROWDED_THRESHOLD)
    .map(([axis, count]) => ({ axis, count }));
}

export default function ProjectsScreen({ user, onAddNew }) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [quickTasks, setQuickTasks] = useState([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // active + paused covers everything still "in flight" -- completed/
      // abandoned commitments aren't part of the picture this screen answers.
      const [active, paused] = await Promise.all([
        getCommitments(user.id, 'active'),
        getCommitments(user.id, 'paused'),
      ]);
      const all = [...(active || []), ...(paused || [])];

      const childrenByParent = new Map();
      all.forEach(c => {
        if (!c.parent_commitment_id) return;
        if (!childrenByParent.has(c.parent_commitment_id)) childrenByParent.set(c.parent_commitment_id, []);
        childrenByParent.get(c.parent_commitment_id).push(c);
      });

      const projectRows = [];
      const quickRows = [];
      all.forEach(c => {
        if (c.parent_commitment_id) return; // it's a step, not a project of its own
        const children = childrenByParent.get(c.id) || [];
        if (children.length) {
          projectRows.push({ project: c, currentStep: children.find(ch => ch.status === 'active') || null });
        } else {
          quickRows.push(c);
        }
      });
      setProjects(projectRows);
      setQuickTasks(quickRows);
    } catch { /* keep whatever was last shown rather than a broken empty screen */ }
    finally { setLoading(false); }
  }, [user]);

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

        {projects.length === 0 && quickTasks.length === 0 && (
          <Text style={s.emptyText}>Nothing tracked yet — tap below to add something.</Text>
        )}

        {projects.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>PROJECTS</Text>
            {projects.map(({ project, currentStep }) => (
              <View key={project.id} style={s.card}>
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle}>{project.title}</Text>
                  {project.status === 'paused' && <Text style={s.pausedBadge}>⏸ Paused</Text>}
                </View>
                {project.identity_axis && <Text style={s.cardAxis}>{axisLabel(project.identity_axis)}</Text>}
                {project.status === 'paused' ? (
                  <Text style={s.pausedReason}>
                    {project.paused_reason ? `"${project.paused_reason}"` : 'Paused, no reason given'}
                  </Text>
                ) : (
                  <Text style={s.currentStep}>
                    {currentStep ? `Current step: ${currentStep.title}` : 'No active step right now'}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {quickTasks.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>QUICK TASKS</Text>
            {quickTasks.map(t => (
              <View key={t.id} style={s.card}>
                <Text style={s.cardTitle}>{t.title}</Text>
                {t.identity_axis && <Text style={s.cardAxis}>{axisLabel(t.identity_axis)}</Text>}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

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
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#f1f5f9', flex: 1, marginRight: 8 },
  cardAxis: { fontSize: 11, color: '#818cf8', fontWeight: '700', marginTop: 4 },
  currentStep: { fontSize: 13, color: '#94a3b8', marginTop: 8 },
  pausedBadge: { fontSize: 11, fontWeight: '800', color: '#f59e0b' },
  pausedReason: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic', marginTop: 8 },
  addBtn: { backgroundColor: '#6366f1', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginHorizontal: 20, marginBottom: 28 },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
