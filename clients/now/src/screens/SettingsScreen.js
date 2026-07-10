/**
 * Settings — minimal per spec: notifications, quiet hours, account, delete data.
 * Also the entry point for the Adaptive Nudge Engine's reuse flow: once the
 * app-open anchor is established, "Remind me to take medication" calls
 * establish() on that profile and re-validates on this specific behavior
 * (see engine/src/engine/nudgeEngine.js) rather than trusting the transfer
 * blindly.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Switch, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, ScrollView, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getUser, clearAll } from '../store/session';
import { deleteAccount, getBehaviorStatus, establishBehavior, overrideNudgeAnchor } from '../api/engine';
import { registerPushToken } from '../push';
import { showAlert } from '../utils/alert';
import { webPushSupported, getWebPushSubscription, subscribeToWebPush, unsubscribeFromWebPush } from '../webPush';

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(`${dateStr}T00:00:00Z`).getTime()) / 86400000) + 1;
}

export default function SettingsScreen({ onBack, onDeleteAccount, onSignOut }) {
  const [user, setUser] = useState(null);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [appOpenStatus, setAppOpenStatus] = useState(null);
  const [medStatus, setMedStatus] = useState(null);
  const [establishing, setEstablishing] = useState(false);
  const [overrideAnchor, setOverrideAnchor] = useState('');
  const [overrideTime, setOverrideTime] = useState('');

  const loadNudgeStatus = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const [appOpen, med] = await Promise.all([
        getBehaviorStatus(userId, 'app_open'),
        getBehaviorStatus(userId, 'medication'),
      ]);
      setAppOpenStatus(appOpen);
      setMedStatus(med);
    } catch (e) { /* status is informational -- a failed fetch just leaves the section blank */ }
  }, []);

  useEffect(() => {
    getUser().then(u => { setUser(u); loadNudgeStatus(u?.id); });
    if (Platform.OS === 'web') {
      getWebPushSubscription().then(sub => setNotifEnabled(!!sub)).catch(() => {});
    } else {
      Notifications.getPermissionsAsync().then(p => setNotifEnabled(p.granted));
    }
  }, [loadNudgeStatus]);

  async function handleEstablishMedication() {
    if (!user?.id) return;
    setEstablishing(true);
    try {
      await establishBehavior(user.id, 'medication', 'daily');
      await loadNudgeStatus(user.id);
    } catch (e) {
      showAlert("Couldn't set that up", e.message);
    } finally {
      setEstablishing(false);
    }
  }

  async function submitOverride(behavior) {
    if (!user?.id || !overrideAnchor.trim() || !overrideTime.trim()) return;
    const digits = overrideTime.replace(/\D/g, '').slice(0, 4);
    const time = digits.length <= 2 ? `${digits.padStart(2, '0')}:00` : `${digits.slice(0, -2).padStart(2, '0')}:${digits.slice(-2)}`;
    try {
      await overrideNudgeAnchor(user.id, behavior, overrideAnchor.trim(), time);
      setOverrideAnchor(''); setOverrideTime('');
      await loadNudgeStatus(user.id);
    } catch (e) {
      showAlert("Couldn't save that", e.message);
    }
  }

  // Real Web Push (installable + shows up in the browser/OS's own
  // per-site notification settings), same mechanism the older BECOME
  // prototype proved out -- separate path from native's Expo push token,
  // since web has no such token system.
  async function toggleWebNotifications(val) {
    if (!user?.id) return;
    if (val) {
      try {
        await subscribeToWebPush(user.id);
        setNotifEnabled(true);
      } catch (e) {
        showAlert("Couldn't enable notifications", e.message);
      }
    } else {
      try {
        await unsubscribeFromWebPush(user.id);
      } catch (e) { /* best effort -- still reflect the toggle locally */ }
      setNotifEnabled(false);
    }
  }

  async function toggleNotifications(val) {
    if (Platform.OS === 'web') return toggleWebNotifications(val);

    if (val) {
      const { granted } = await Notifications.requestPermissionsAsync();
      setNotifEnabled(granted);
      if (!granted) return showAlert('Notifications blocked', 'Enable them in iOS Settings > NOW.');
      // Permission alone doesn't register the device with the engine --
      // this is the one place that actually sends the token, with the
      // real failure reason surfaced if it doesn't work.
      if (user?.id) await registerPushToken(user.id, true);
    } else {
      setNotifEnabled(false);
      // Note: can't programmatically revoke; tell user to go to Settings
      showAlert('To disable', 'Go to iOS/Android Settings and turn off notifications for NOW.');
    }
  }

  // Local-only reset -- clears this device's session but never touches the
  // server, unlike confirmDelete below. The distinction matters for
  // switching between a real account and a test account: sign out + sign
  // back in with a different Google account picks up (or creates) that
  // account's own data, while the original account's history stays intact
  // on the server the whole time, ready to sign back into later.
  function confirmSignOut() {
    showAlert(
      'Sign out',
      'This keeps your account and data -- sign back in anytime with the same Google account. Use this to switch to a different account for testing.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', onPress: async () => {
          setSigningOut(true);
          await clearAll();
          setSigningOut(false);
          onSignOut?.();
        }},
      ]
    );
  }

  function confirmDelete() {
    showAlert(
      'Delete all data',
      'This permanently erases your account and all check-in history from our servers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            if (user?.id) await deleteAccount(user.id);
            await clearAll();
            onDeleteAccount?.();
          } catch (e) {
            // A stale local session (e.g. pointing at a user from before a
            // database migration) 404s here -- there's nothing server-side
            // to delete, but the user is still stuck with a broken local
            // session unless we clear it anyway instead of just erroring.
            if (String(e.message || '').toLowerCase().includes('not found')) {
              await clearAll();
              onDeleteAccount?.();
            } else {
              showAlert("Couldn't delete", e.message || 'Check your connection and try again.');
            }
          } finally {
            setDeleting(false);
          }
        }},
      ]
    );
  }

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.back}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <Section label="Notifications">
          {Platform.OS === 'web' && !webPushSupported() ? (
            <Text style={s.note}>Push isn't available in this browser yet.</Text>
          ) : (
            <>
              <Row label="Intervention nudges">
                <Switch value={notifEnabled} onValueChange={toggleNotifications} trackColor={{ true: '#6366f1' }} />
              </Row>
              <Text style={s.note}>Quiet hours are set during onboarding. No streak guilt, no shaming messages.</Text>
            </>
          )}
        </Section>

        <Section label="Daily nudge">
          {appOpenStatus?.profile?.established_at ? (
            <Text style={s.note}>
              Locked in — nudging you around {appOpenStatus.profile.primary_anchor_time?.slice(0, 5)} ({appOpenStatus.profile.primary_anchor}).
            </Text>
          ) : appOpenStatus?.test?.status === 'awaiting_override' ? (
            <OverridePrompt
              question="This time isn't sticking — want to try a different anchor?"
              anchor={overrideAnchor} time={overrideTime}
              onAnchor={setOverrideAnchor} onTime={setOverrideTime}
              onSave={() => submitOverride('app_open')}
            />
          ) : appOpenStatus?.test ? (
            <Text style={s.note}>
              Still learning your pattern — day {daysSince(appOpenStatus.test.started_at)} of {appOpenStatus.test.test_length_days}.
            </Text>
          ) : (
            <Text style={s.note}>Set up during onboarding.</Text>
          )}
        </Section>

        <Section label="Medication reminder">
          {!appOpenStatus?.profile?.established_at ? (
            <Text style={s.note}>Available once your daily check-in pattern above is confirmed.</Text>
          ) : !medStatus?.test ? (
            <TouchableOpacity style={s.secondaryBtn} onPress={handleEstablishMedication} disabled={establishing}>
              {establishing ? <ActivityIndicator color="#6366f1" /> : <Text style={s.secondaryBtnText}>Remind me to take medication</Text>}
            </TouchableOpacity>
          ) : medStatus.test.status === 'confirmed' ? (
            <Text style={s.note}>Confirmed — nudging you around {medStatus.test.candidate_a_time?.slice(0, 5)}.</Text>
          ) : medStatus.test.status === 'escalated' ? (
            <OverridePrompt
              question="Where do you keep your meds? Let's anchor the reminder there instead."
              anchor={overrideAnchor} time={overrideTime}
              onAnchor={setOverrideAnchor} onTime={setOverrideTime}
              onSave={() => submitOverride('medication')}
            />
          ) : (
            <Text style={s.note}>
              Testing {medStatus.test.candidate_a} (~{medStatus.test.candidate_a_time?.slice(0, 5)}) — day {daysSince(medStatus.test.started_at)} of {medStatus.test.test_length_days}.
            </Text>
          )}
        </Section>

        <Section label="Account">
          {user && <Text style={s.detail}>User ID: {user.id?.slice(0,8)}…</Text>}
          {user && <Text style={s.detail}>Timezone: {user.timezone}</Text>}
          <TouchableOpacity style={s.secondaryBtn} onPress={confirmSignOut} disabled={signingOut}>
            {signingOut ? <ActivityIndicator color="#a5b4fc" /> : <Text style={s.secondaryBtnText}>Sign out</Text>}
          </TouchableOpacity>
        </Section>

        <Section label="Data">
          <TouchableOpacity style={s.dangerBtn} onPress={confirmDelete} disabled={deleting}>
            {deleting ? <ActivityIndicator color="#dc2626" /> : <Text style={s.dangerText}>Delete all my data</Text>}
          </TouchableOpacity>
        </Section>

        <Text style={s.version}>NOW v1.0.0 · Powered by ENGINE</Text>
      </ScrollView>
    </View>
  );
}

function Section({ label, children }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Row({ label, children }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

// A user's own pick always beats another silent test cycle -- shown when an
// app_open test ended with both candidates under 50%, or a medication test
// failed on both the primary and backup anchor.
function OverridePrompt({ question, anchor, time, onAnchor, onTime, onSave }) {
  return (
    <View>
      <Text style={s.note}>{question}</Text>
      <TextInput
        style={s.overrideInput} value={anchor} onChangeText={onAnchor}
        placeholder="e.g. after brushing teeth" placeholderTextColor="#475569"
      />
      <TextInput
        style={s.overrideInput} value={time} onChangeText={onTime}
        placeholder="e.g. 2130 for 9:30 PM" placeholderTextColor="#475569" keyboardType="number-pad"
      />
      <TouchableOpacity style={s.secondaryBtn} onPress={onSave} disabled={!anchor.trim() || !time.trim()}>
        <Text style={s.secondaryBtnText}>Save</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b', flexDirection: 'row', alignItems: 'center', gap: 14 },
  back: { padding: 4 },
  backText: { color: '#6366f1', fontSize: 15, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '900', color: '#f1f5f9' },
  scroll: { padding: 20, paddingBottom: 48 },
  section: { marginBottom: 28 },
  sectionLabel: { fontSize: 10, fontWeight: '800', color: '#475569', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  rowLabel: { fontSize: 15, color: '#f1f5f9', fontWeight: '500' },
  note: { fontSize: 12, color: '#475569', lineHeight: 17, marginTop: 10 },
  detail: { fontSize: 13, color: '#64748b', marginBottom: 6, fontFamily: 'monospace' },
  dangerBtn: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#dc2626' },
  dangerText: { color: '#dc2626', fontSize: 14, fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#6366f1', marginTop: 8 },
  secondaryBtnText: { color: '#a5b4fc', fontSize: 14, fontWeight: '700' },
  overrideInput: { backgroundColor: '#1e293b', borderRadius: 8, padding: 10, fontSize: 14, color: '#f1f5f9', marginTop: 8, borderWidth: 1, borderColor: '#334155' },
  version: { fontSize: 11, color: '#334155', textAlign: 'center', marginTop: 32 },
});
