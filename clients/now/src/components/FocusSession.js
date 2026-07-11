/**
 * Focus session — a Pomodoro-style visual countdown to anchor attention on
 * NowScreen while it's running, since the biggest reported barrier here
 * isn't not knowing what to do, it's getting pulled into Facebook/Line/
 * casual browsing or just mind-wandering mid-action. There's no way to
 * block other apps/tabs from inside this app, so this doesn't try to — it
 * just makes staying-with-it easier (a big visible countdown) and reflects
 * back how many times the app was left during the session, once it's over.
 * Deliberately not a live counter while running: watching a number climb in
 * real time would itself be a new distraction and a shame source, working
 * against the app's existing "no shaming, no streaks" tone (see NowScreen).
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Vibration, AppState } from 'react-native';
import { postFocusSession } from '../api/engine';
import { enqueue } from '../store/queue';

const DURATIONS = [
  { label: '5 min', minutes: 5 },
  { label: '15 min', minutes: 15 },
  { label: '25 min', minutes: 25 },
];

function beep() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) { /* best-effort -- a missing beep shouldn't break the timer */ }
}

function alertComplete() {
  beep();
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } else {
    Vibration.vibrate([0, 200, 100, 200]);
  }
}

// context: { userId, identityAxis, actionText, equivalentId, commitmentId } --
// whatever's currently shown on NowScreen when the session is started, so
// the logged row records what was actually being focused on. All optional:
// a session with no user_id simply never logs (e.g. dev/no-account state).
export default function FocusSession({ context }) {
  const [state, setState] = useState('idle'); // idle | picking | running | done
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [leftCount, setLeftCount] = useState(0);
  const intervalRef = useRef(null);
  const leftCountRef = useRef(0);
  const wasActiveRef = useRef(true);
  const startedAtRef = useRef(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (state !== 'running') return undefined;
    intervalRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(intervalRef.current);
          setLeftCount(leftCountRef.current);
          setState('done');
          alertComplete();
          logSession('completed', totalSeconds, totalSeconds);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [state]);

  // Counts app-switches during the session only -- see file header for why
  // this stays silent (leftCountRef, not displayed state) until the summary.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (state !== 'running') return;
      if (wasActiveRef.current && next !== 'active') leftCountRef.current += 1;
      wasActiveRef.current = next === 'active';
    });
    return () => sub.remove();
  }, [state]);

  // Best-effort, same offline-safe pattern as checkins/snoozes -- a failed
  // log falls back to the local queue rather than being silently dropped.
  async function logSession(endedReason, plannedSeconds, actualSeconds) {
    const ctx = contextRef.current || {};
    if (!ctx.userId) return;
    const payload = {
      user_id: ctx.userId,
      identity_axis: ctx.identityAxis || null,
      action_text: ctx.actionText || null,
      equivalent_id: ctx.equivalentId || null,
      commitment_id: ctx.commitmentId || null,
      planned_seconds: plannedSeconds,
      actual_seconds: actualSeconds,
      started_at: new Date(startedAtRef.current).toISOString(),
      ended_reason: endedReason,
      left_count: leftCountRef.current,
    };
    try {
      await postFocusSession(payload);
    } catch {
      await enqueue({ type: 'focus_session', payload });
    }
  }

  function start(minutes) {
    const secs = minutes * 60;
    leftCountRef.current = 0;
    wasActiveRef.current = true;
    startedAtRef.current = Date.now();
    setTotalSeconds(secs);
    setSecondsLeft(secs);
    setState('running');
  }

  function cancel() {
    clearInterval(intervalRef.current);
    const elapsed = totalSeconds - secondsLeft;
    setLeftCount(leftCountRef.current);
    logSession('cancelled', totalSeconds, elapsed);
    setState('idle');
  }

  if (state === 'idle') {
    return (
      <TouchableOpacity style={s.openBtn} onPress={() => setState('picking')}>
        <Text style={s.openBtnText}>🎯 Start a focus session</Text>
      </TouchableOpacity>
    );
  }

  if (state === 'picking') {
    return (
      <View style={s.pickWrap}>
        <Text style={s.pickLabel}>How long?</Text>
        <View style={s.pickRow}>
          {DURATIONS.map(d => (
            <TouchableOpacity key={d.minutes} style={s.pickChip} onPress={() => start(d.minutes)}>
              <Text style={s.pickChipText}>{d.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (state === 'done') {
    return (
      <View style={s.doneWrap}>
        <Text style={s.doneTitle}>🎯 Focus session complete</Text>
        <Text style={s.doneNote}>
          {leftCount === 0
            ? 'You stayed with it the whole time.'
            : `You stepped away ${leftCount} time${leftCount === 1 ? '' : 's'} — that's normal, no worries.`}
        </Text>
        <TouchableOpacity style={s.dismissBtn} onPress={() => setState('idle')}>
          <Text style={s.dismissBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pct = Math.round((1 - secondsLeft / totalSeconds) * 100);
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  return (
    <View style={s.runWrap}>
      <Text style={s.runLabel}>FOCUS SESSION</Text>
      <Text style={s.runTime}>{mm}:{String(ss).padStart(2, '0')}</Text>
      <View style={s.runTrack}>
        <View style={[s.runFill, { width: `${pct}%` }]} />
      </View>
      <TouchableOpacity style={s.cancelBtn} onPress={cancel}>
        <Text style={s.cancelBtnText}>End early</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  openBtn: { backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
  openBtnText: { color: '#a5b4fc', fontSize: 14, fontWeight: '800' },
  pickWrap: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
  pickLabel: { fontSize: 13, fontWeight: '700', color: '#94a3b8', marginBottom: 12 },
  pickRow: { flexDirection: 'row', gap: 10 },
  pickChip: { backgroundColor: '#0f172a', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: '#6366f1' },
  pickChipText: { color: '#c7d2fe', fontSize: 14, fontWeight: '700' },
  runWrap: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#6366f1', padding: 24, marginBottom: 16, alignItems: 'center' },
  runLabel: { fontSize: 11, fontWeight: '800', color: '#818cf8', letterSpacing: 1, marginBottom: 8 },
  runTime: { fontSize: 44, fontWeight: '900', color: '#fff', marginBottom: 14 },
  runTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: '#0f172a', overflow: 'hidden', marginBottom: 16 },
  runFill: { height: 8, backgroundColor: '#6366f1' },
  cancelBtn: { paddingVertical: 6 },
  cancelBtnText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  doneWrap: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#34d399', padding: 20, marginBottom: 16, alignItems: 'center' },
  doneTitle: { fontSize: 16, fontWeight: '800', color: '#f1f5f9', marginBottom: 8 },
  doneNote: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19, marginBottom: 14 },
  dismissBtn: { backgroundColor: '#334155', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24 },
  dismissBtnText: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
});
