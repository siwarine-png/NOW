/**
 * Visual countdown for a fixed-duration action (e.g. "close your eyes and
 * breathe slowly for 1 minute") -- server sends `timer_seconds` on the
 * intervention (engine/src/engine/seed.js's starter content, threaded
 * through domainRules.js/routes/interventions.js) whenever an action is
 * literally a timed exercise rather than an open-ended one.
 *
 * Starts on explicit tap, not automatically on load -- same "behavioral
 * activation" reasoning as the rest of the app: the person decides when
 * they're actually ready to begin, the timer doesn't decide for them.
 * Reaching zero never auto-marks the action Done; it triggers a completion
 * alert (a short beep + vibration where supported) and hands control back
 * for an explicit Done tap, same as every other intervention in the app.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Vibration } from 'react-native';

function beep() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
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

function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.round(totalSeconds / 60);
  return `${m} min`;
}

export default function TimerCountdown({ totalSeconds, onComplete }) {
  const [state, setState] = useState('idle'); // idle | running | done
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (state !== 'running') return undefined;
    intervalRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(intervalRef.current);
          setState('done');
          alertComplete();
          onComplete?.();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [state]);

  function start() {
    setSecondsLeft(totalSeconds);
    setState('running');
  }

  if (state === 'idle') {
    return (
      <TouchableOpacity style={s.startBtn} onPress={start}>
        <Text style={s.startBtnText}>▶ Start ({formatDuration(totalSeconds)})</Text>
      </TouchableOpacity>
    );
  }

  const pct = Math.round((1 - secondsLeft / totalSeconds) * 100);
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;

  return (
    <View style={s.wrap}>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }, state === 'done' && s.fillDone]} />
      </View>
      <Text style={s.time}>{state === 'done' ? "Time's up" : `${mm}:${String(ss).padStart(2, '0')}`}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  startBtn: { backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#6366f1', paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  startBtnText: { color: '#a5b4fc', fontSize: 14, fontWeight: '800' },
  wrap: { marginTop: 12, alignItems: 'center' },
  track: { width: '100%', height: 8, borderRadius: 4, backgroundColor: '#0f172a', overflow: 'hidden', marginBottom: 8 },
  fill: { height: 8, backgroundColor: '#6366f1' },
  fillDone: { backgroundColor: '#34d399' },
  time: { fontSize: 22, fontWeight: '900', color: '#f1f5f9' },
});
