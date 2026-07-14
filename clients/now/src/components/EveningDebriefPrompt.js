/**
 * "How did today go?" -- the evening half of the daily ritual (see
 * MorningBriefPrompt for the morning half). Shown once per calendar day
 * (server-gated via daily_briefs.evening_completed_at, see TodayScreen's
 * eveningDebriefDue) once you're near or past the end of your waking day.
 * Leads with the planned-vs-actual review (this morning's stated focus +
 * today's actually-done items, with duration where a Start/Finish pair on
 * Today recorded one) before asking the Ship-or-Kill-style shipped
 * question -- the review is the point, not a formality before it.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { getEveningReview, postEveningDebrief } from '../api/engine';

function fmtDuration(seconds) {
  const min = Math.round(seconds / 60);
  if (min < 1) return '<1m';
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// MorningBriefPrompt's pick-list puts an existing item's EXACT title into
// planned_focus (a free-typed fallback is still possible, so this stays a
// soft trim+casefold compare, not an id match) -- this is what makes "did I
// actually do the one thing" answerable instead of just eyeballing two
// separate blocks of text.
function titlesMatch(a, b) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export default function EveningDebriefPrompt({ user, onDone }) {
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [shipped, setShipped] = useState(null); // null | true | false
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEveningReview(user.id)
      .then(r => { if (!cancelled) setReview(r); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const plannedDone = !!review?.planned_focus && (review.completed || []).some(c => titlesMatch(c.title, review.planned_focus));

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await postEveningDebrief(user.id, !!shipped, note.trim() || null);
    } catch (e) { /* best-effort -- worst case it asks again next open */ }
    setSaving(false);
    onDone();
  }

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.title}>How did today go?</Text>

            {loading ? (
              <ActivityIndicator color="#6366f1" style={s.loadingSpinner} />
            ) : (
              <>
                {review?.planned_focus && (
                  <View style={s.reviewBlock}>
                    <Text style={s.reviewLabel}>YOU PLANNED</Text>
                    <View style={s.plannedRow}>
                      <Text style={s.reviewText}>{review.planned_focus}</Text>
                      <Text style={[s.plannedBadge, plannedDone ? s.plannedBadgeDone : s.plannedBadgePending]}>
                        {plannedDone ? '✓ Done' : '○ Not yet'}
                      </Text>
                    </View>
                  </View>
                )}
                <View style={s.reviewBlock}>
                  <Text style={s.reviewLabel}>YOU DID</Text>
                  {review?.completed?.length ? review.completed.map((c, i) => {
                    // The one item that matches this morning's stated focus,
                    // not just an arbitrary line in the list -- the whole
                    // point of picking an existing item instead of free
                    // text (see MorningBriefPrompt) is being able to say
                    // "yes, THAT got done" instead of eyeballing two
                    // disconnected blocks of text against each other.
                    const isPlanned = titlesMatch(c.title, review.planned_focus);
                    return (
                      <Text key={i} style={[s.reviewItem, isPlanned && s.reviewItemPlanned]}>
                        {isPlanned ? '★ ' : '· '}{c.title}{c.duration_seconds != null ? ` (${fmtDuration(c.duration_seconds)})` : ''}
                      </Text>
                    );
                  }) : (
                    <Text style={s.reviewEmpty}>Nothing checked off today.</Text>
                  )}
                </View>
              </>
            )}

            <Text style={s.question}>Did you ship something visible today?</Text>
            <Text style={s.questionHint}>A commit, a draft, a sent file -- something outside your head.</Text>
            <View style={s.shipRow}>
              <TouchableOpacity style={[s.shipChip, shipped === true && s.shipChipActive]} onPress={() => setShipped(true)}>
                <Text style={[s.shipChipText, shipped === true && s.shipChipTextActive]}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.shipChip, shipped === false && s.shipChipActive]} onPress={() => setShipped(false)}>
                <Text style={[s.shipChipText, shipped === false && s.shipChipTextActive]}>Not today</Text>
              </TouchableOpacity>
            </View>
            {shipped === true && (
              <TextInput
                style={s.input} value={note} onChangeText={setNote}
                placeholder="What did you ship?" placeholderTextColor="#475569"
                multiline autoFocus
              />
            )}

            <TouchableOpacity
              style={[s.btn, (saving || shipped === null) && s.btnDisabled]}
              disabled={saving || shipped === null} onPress={submit}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Done for today</Text>}
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
  title: { fontSize: 19, fontWeight: '900', color: '#f1f5f9', marginBottom: 14 },
  loadingSpinner: { marginVertical: 16 },
  reviewBlock: { marginBottom: 14 },
  reviewLabel: { fontSize: 10, fontWeight: '800', color: '#475569', letterSpacing: 0.6, marginBottom: 4 },
  reviewText: { fontSize: 14, color: '#f1f5f9', fontWeight: '600', lineHeight: 20, flex: 1, marginRight: 8 },
  plannedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plannedBadge: { fontSize: 11, fontWeight: '800' },
  plannedBadgeDone: { color: '#34d399' },
  plannedBadgePending: { color: '#64748b' },
  reviewItem: { fontSize: 13, color: '#94a3b8', lineHeight: 19 },
  reviewItemPlanned: { color: '#c7d2fe', fontWeight: '700' },
  reviewEmpty: { fontSize: 13, color: '#475569', fontStyle: 'italic' },
  question: { fontSize: 15, fontWeight: '800', color: '#f1f5f9', marginTop: 6, marginBottom: 2 },
  questionHint: { fontSize: 11, color: '#64748b', marginBottom: 10 },
  shipRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  shipChip: { flex: 1, backgroundColor: '#0f172a', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  shipChipActive: { backgroundColor: '#312e81', borderColor: '#6366f1' },
  shipChipText: { color: '#94a3b8', fontSize: 13, fontWeight: '700' },
  shipChipTextActive: { color: '#c7d2fe' },
  input: { backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', padding: 12, fontSize: 14, color: '#f1f5f9', minHeight: 54, textAlignVertical: 'top', marginBottom: 14 },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
