/**
 * NOW screen — 95% of usage.
 * Displays the single current intervention. Offline-safe: caches intervention,
 * queues events for sync. Recovery-oriented tone only — no shaming, no streaks
 * displayed.
 *
 * Two response shapes come back from GET /interventions/now (see
 * engine/src/routes/interventions.js):
 *  - domain mode (Engine v8): has `domain` — Done / Not today / Something else,
 *    against an outcome_equivalent.
 *  - commitment mode (original R1-R8, only for users with no domain data):
 *    has `commitment_id` — Done / Snooze, unchanged from v1.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  AppState, ScrollView,
} from 'react-native';
import { getInterventionNow, postCheckin, postSnooze, postEquivalentCheckin } from '../api/engine';
import { enqueue, flushQueue } from '../store/queue';
import { cacheIntervention, getCachedIntervention, clearIntervention } from '../store/session';

const SNOOZE_OPTIONS = [
  { label: '10 min', minutes: 10 },
  { label: '1 hour', minutes: 60 },
  { label: 'Today', minutes: null }, // skip for today
];

function fmtAction(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
function fmtDomain(domain) { return domain.charAt(0).toUpperCase() + domain.slice(1); }

// Read-only zoom-out strip on the same compounding signal — never separate
// authored goals (see engine/src/engine/domainRules.js computeBigPicture).
// `immediate` cascades up through today/week (you can't complete something
// right now without today being true too) so the row never looks
// self-contradictory even though the server snapshot was computed a moment
// before this specific action's checkin landed. `longterm` doesn't cascade —
// it's about longevity, not recency.
function BigPictureRow({ bigPicture, immediate }) {
  if (!bigPicture) return null;
  const today = immediate || bigPicture.today;
  const week = today || bigPicture.week;
  const month = week || bigPicture.month;
  const items = [
    ['Immediate', immediate],
    ['Today', today],
    ['Week', week],
    ['Month', month],
    ['Longterm', bigPicture.longterm],
  ];
  return (
    <View style={s.bigPictureRow}>
      {items.map(([label, checked]) => (
        <View key={label} style={s.bigPictureItem}>
          <Text style={s.bigPictureCheck}>{checked ? '☑' : '☐'}</Text>
          <Text style={[s.bigPictureLabel, checked && s.bigPictureLabelChecked]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function NowScreen({ user, onSettings, onBack }) {
  const [intervention, setIntervention] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [done, setDone] = useState(false); // post-done state

  // Domain mode only: which candidate is currently shown, if the user tapped
  // "Something else" to swap off the engine's first pick.
  const [altSelected, setAltSelected] = useState(null);
  const [showAlternates, setShowAlternates] = useState(false);

  const load = useCallback(async (useCache = false) => {
    if (!user) return;
    setLoading(true);
    try {
      if (useCache) {
        const cached = await getCachedIntervention();
        if (cached) { setIntervention(cached); setLoading(false); return; }
      }
      // Flush queued offline events before fetching
      await flushQueue();
      const data = await getInterventionNow(user.id);
      setIntervention(data);
      setAltSelected(null);
      setShowAlternates(false);
      if (data) await cacheIntervention(data);
    } catch {
      // Network error — fall back to cache
      const cached = await getCachedIntervention();
      setIntervention(cached);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(true); }, [load]);

  // Reload when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load(false); });
    return () => sub.remove();
  }, [load]);

  const isDomainMode = !!intervention?.domain;
  const activeEquivalentId = altSelected ? altSelected.id : intervention?.equivalent_id;
  const activeAction = altSelected ? fmtAction(altSelected.action_text) : intervention?.action;
  const activeMessage = altSelected ? `Let's do this instead: ${altSelected.action_text}.` : intervention?.message;
  const activeWhyThis = altSelected ? null : intervention?.why_this;

  async function handleDone() {
    if (isDomainMode) return handleDomainAction('done');
    if (!intervention?.commitment_id) return;
    setActing(true);
    try {
      await postCheckin(intervention.commitment_id, 'done', null, intervention.intervention_id);
    } catch {
      // Offline: queue it
      await enqueue({ type: 'checkin', commitment_id: intervention.commitment_id, result: 'done',
                       energy: null, intervention_id: intervention.intervention_id });
    }
    await clearIntervention();
    setDone(true);
    setActing(false);
    // Reload after short delay to get next state
    setTimeout(() => { setDone(false); load(false); }, 1800);
  }

  async function handleSnooze(option) {
    if (!intervention?.commitment_id) return;
    setSnoozeOpen(false);
    setActing(true);
    const snoozeMinutes = option.minutes;
    try {
      await postSnooze(intervention.commitment_id, snoozeMinutes, intervention.intervention_id);
    } catch {
      await enqueue({ type: 'snooze', commitment_id: intervention.commitment_id,
                       snooze_minutes: snoozeMinutes, intervention_id: intervention.intervention_id });
    }
    await clearIntervention();
    setActing(false);
    // The engine now suppresses this commitment until the snooze expires, so
    // reloading immediately correctly shows "clear" (or the next-highest-risk one).
    load(false);
  }

  async function handleDomainAction(result) {
    if (!activeEquivalentId) return;
    setActing(true);
    try {
      await postEquivalentCheckin(activeEquivalentId, result, null);
    } catch {
      await enqueue({ type: 'equivalent_checkin', equivalent_id: activeEquivalentId, result, energy: null });
    }
    await clearIntervention();
    setActing(false);
    if (result === 'done') {
      setDone(true);
      setTimeout(() => { setDone(false); load(false); }, 1800);
    } else {
      load(false);
    }
  }

  function selectAlternate(alt) {
    setAltSelected(alt);
    setShowAlternates(false);
  }

  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color="#6366f1" /></View>
  );

  // Clear state — nothing actionable right now
  if (!intervention || intervention.state === 'clear') return (
    <View style={s.screen}>
      {onBack && (
        <TouchableOpacity style={s.backBtn} onPress={onBack}>
          <Text style={s.backBtnText}>← Today</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={s.settingsBtn} onPress={onSettings}>
        <Text style={s.settingsIcon}>⚙</Text>
      </TouchableOpacity>
      <View style={s.center}>
        <Text style={s.clearEmoji}>✓</Text>
        <Text style={s.clearTitle}>You're clear.</Text>
        <Text style={s.clearSub}>{intervention?.message || 'Nothing needs your attention right now.'}</Text>
        {intervention?.next_at && (
          <Text style={s.nextAt}>Next: {formatNextAt(intervention.next_at)}</Text>
        )}
        <BigPictureRow bigPicture={intervention?.big_picture} immediate={false} />
      </View>
    </View>
  );

  // Post-done state
  if (done) return (
    <View style={s.screen}>
      <View style={s.center}>
        <Text style={s.doneEmoji}>🎯</Text>
        <Text style={s.doneText}>Done.</Text>
        <BigPictureRow bigPicture={intervention?.big_picture} immediate={true} />
      </View>
    </View>
  );

  return (
    <View style={s.screen}>
      {onBack && (
        <TouchableOpacity style={s.backBtn} onPress={onBack}>
          <Text style={s.backBtnText}>← Today</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={s.settingsBtn} onPress={onSettings}>
        <Text style={s.settingsIcon}>⚙</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={s.scroll} bounces={false}>
        {isDomainMode && <Text style={s.domainBadge}>{fmtDomain(intervention.domain)}</Text>}
        {/* Rule badge */}
        <Text style={s.ruleBadge}>{ruleLabel(intervention.rule_id)}</Text>

        {/* Main message */}
        <Text style={s.message}>{activeMessage}</Text>

        {/* Action */}
        {activeAction && (
          <View style={s.actionBox}>
            <Text style={s.actionLabel}>START HERE</Text>
            <Text style={s.action}>{activeAction}</Text>
          </View>
        )}

        {/* Friction reduction (commitment mode only) */}
        {intervention.friction_reduction && (
          <Text style={s.frictionNote}>💡 {intervention.friction_reduction}</Text>
        )}

        {/* Why this */}
        {activeWhyThis && (
          <Text style={s.whyThis}>{activeWhyThis}</Text>
        )}

        {/* R10 trend check (domain mode only) — a question, never a replacement */}
        {isDomainMode && intervention.trend_check && (
          <View style={s.trendBox}>
            <Text style={s.trendText}>{intervention.trend_check.message}</Text>
          </View>
        )}

        {isDomainMode ? (
          <>
            <View style={s.actions}>
              <TouchableOpacity style={[s.doneBtn, acting && s.btnDisabled]} onPress={handleDone} disabled={acting}>
                {acting ? <ActivityIndicator color="#fff" /> : <Text style={s.doneBtnText}>Done ✓</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.snoozeBtn} onPress={() => handleDomainAction('skipped')} disabled={acting}>
                <Text style={s.snoozeBtnText}>Not today</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.linkBtn} onPress={() => setShowAlternates(!showAlternates)} disabled={acting}>
              <Text style={s.linkBtnText}>Something else</Text>
            </TouchableOpacity>
            {showAlternates && (
              <View style={s.altList}>
                {(intervention.alternates || []).map(alt => (
                  <TouchableOpacity key={alt.id} style={s.altChip} onPress={() => selectAlternate(alt)}>
                    <Text style={s.altChipText}>{fmtAction(alt.action_text)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <View style={s.actions}>
              <TouchableOpacity style={[s.doneBtn, acting && s.btnDisabled]} onPress={handleDone} disabled={acting}>
                {acting ? <ActivityIndicator color="#fff" /> : <Text style={s.doneBtnText}>Done ✓</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.snoozeBtn} onPress={() => setSnoozeOpen(!snoozeOpen)} disabled={acting}>
                <Text style={s.snoozeBtnText}>Snooze</Text>
              </TouchableOpacity>
            </View>

            {snoozeOpen && (
              <View style={s.snoozeOptions}>
                {SNOOZE_OPTIONS.map(opt => (
                  <TouchableOpacity key={opt.label} style={s.snoozeOpt} onPress={() => handleSnooze(opt)}>
                    <Text style={s.snoozeOptText}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// next_at is either a plain "HH:MM" window string, or (after a snooze) a full
// ISO timestamp — render the latter as a local time instead of the raw ISO string.
function formatNextAt(nextAt) {
  if (!nextAt.includes('T')) return nextAt;
  const d = new Date(nextAt);
  if (isNaN(d)) return nextAt;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function ruleLabel(ruleId) {
  const map = {
    R1_streak_at_risk:    '🔥 Streak at risk',
    R2_missed_yesterday:  '↩ Never miss twice',
    R3_window_closing:    '⏱ Window closing',
    R4_ambiguous_action:  '❓ Clarify first step',
    R5_identity_reinforce:'🪪 Identity evidence',
    R6_low_energy_downshift: '🌱 Low energy mode',
    R7_deadline_proximity:'⚠ Deadline close',
    R8_stale_commitment:  '🧹 Renegotiate',
    R_baseline_seed:      '🌱 Starting point',
    R9_substitution:      '🔁 Switched it up',
    R9b_floor_reached:    '⏸ Worth pausing?',
  };
  return map[ruleId] || '';
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  scroll: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  settingsBtn: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8 },
  settingsIcon: { fontSize: 20, color: '#475569' },
  backBtn: { position: 'absolute', top: 52, left: 20, zIndex: 10, padding: 8 },
  backBtnText: { fontSize: 14, fontWeight: '700', color: '#6366f1' },
  domainBadge: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  ruleBadge: { fontSize: 11, fontWeight: '700', color: '#6366f1', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 20 },
  message: { fontSize: 24, fontWeight: '800', color: '#f1f5f9', lineHeight: 32, marginBottom: 24 },
  actionBox: { backgroundColor: '#1e293b', borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#6366f1' },
  actionLabel: { fontSize: 9, fontWeight: '800', color: '#6366f1', letterSpacing: 1, marginBottom: 8 },
  action: { fontSize: 17, fontWeight: '700', color: '#fff', lineHeight: 24 },
  frictionNote: { fontSize: 13, color: '#94a3b8', marginBottom: 12, lineHeight: 19 },
  whyThis: { fontSize: 12, color: '#475569', lineHeight: 18, marginBottom: 32 },
  trendBox: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#334155' },
  trendText: { fontSize: 13, color: '#c7d2fe', lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  doneBtn: { flex: 2, backgroundColor: '#6366f1', borderRadius: 14, padding: 18, alignItems: 'center' },
  doneBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  snoozeBtn: { flex: 1, backgroundColor: '#1e293b', borderRadius: 14, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  snoozeBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  snoozeOptions: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'center' },
  snoozeOpt: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  snoozeOptText: { color: '#94a3b8', fontSize: 13, fontWeight: '700' },
  linkBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  linkBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  altList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 },
  altChip: { backgroundColor: '#1e293b', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#6366f1' },
  altChipText: { color: '#c7d2fe', fontSize: 13, fontWeight: '700' },
  clearEmoji: { fontSize: 52, marginBottom: 16 },
  clearTitle: { fontSize: 28, fontWeight: '900', color: '#f1f5f9', marginBottom: 10 },
  clearSub: { fontSize: 15, color: '#64748b', textAlign: 'center', lineHeight: 22 },
  nextAt: { fontSize: 12, color: '#475569', marginTop: 16, fontWeight: '700' },
  doneEmoji: { fontSize: 64, marginBottom: 16 },
  doneText: { fontSize: 32, fontWeight: '900', color: '#f1f5f9' },
  bigPictureRow: { flexDirection: 'row', gap: 16, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' },
  bigPictureItem: { alignItems: 'center', gap: 4 },
  bigPictureCheck: { fontSize: 18, color: '#475569' },
  bigPictureLabel: { fontSize: 10, color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  bigPictureLabelChecked: { color: '#94a3b8' },
});
