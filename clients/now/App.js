/**
 * NOW app root — Onboarding (first launch), then a persistent bottom nav
 * with exactly 2 tabs ("I'm Stuck" = add a new pain point any time, "Now" =
 * the day's shape) visible on every post-onboarding screen. Tapping Today's
 * highlighted card drills into the focused single-action view on top of
 * the "Now" tab; Settings is reached from there.
 * No navigation library needed at this scale — simple state machine.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { isOnboarded, getUser } from './src/store/session';
import { registerPushToken } from './src/push';
import OnboardingScreen from './src/screens/OnboardingScreen';
import TodayScreen from './src/screens/TodayScreen';
import NowScreen from './src/screens/NowScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AddPainPointScreen from './src/screens/AddPainPointScreen';
import IdentityScreen from './src/screens/IdentityScreen';
import BottomNav from './src/components/BottomNav';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

// Release builds show a blank screen on an uncaught render error, with no
// way to get a log off the device. This surfaces the actual error text
// instead, since that's the only diagnostic a tester on their own phone can
// ever hand back.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <ScrollView style={s.crash} contentContainerStyle={s.crashContent}>
        <Text style={s.crashTitle}>Something broke</Text>
        <Text style={s.crashMessage}>{String(this.state.error?.message || this.state.error)}</Text>
      </ScrollView>
    );
    return this.props.children;
  }
}

// "now" covers both the Today dashboard and its focused single-action
// drill-in -- both belong to the "Now" tab, just one level of navigation
// apart. "stuck" and "settings" are their own top-level screens.
const NOW_TAB_SCREENS = ['today', 'now-focus'];

function App() {
  const [screen, setScreen] = useState('loading');
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      const onboarded = await isOnboarded();
      if (onboarded) {
        const u = await getUser();
        setUser(u);
        setScreen('today');
        // Web uses its own VAPID-based flow (src/webPush.js, triggered from
        // Settings) -- expo-notifications' token system doesn't apply here
        // and just logs a confusing "must provide vapidPublicKey" error.
        if (Platform.OS !== 'web') registerPushToken(u?.id);
      } else {
        setScreen('onboarding');
      }
    })();
  }, []);

  if (screen === 'loading') return <View style={s.loading} />;

  if (screen === 'onboarding') return (
    <>
      <StatusBar style="light" />
      <OnboardingScreen onComplete={u => { setUser(u); setScreen('today'); if (Platform.OS !== 'web') registerPushToken(u?.id); }} />
    </>
  );

  let content;
  if (screen === 'settings') {
    content = (
      <SettingsScreen
        onBack={() => setScreen('today')}
        onDeleteAccount={() => { setUser(null); setScreen('onboarding'); }}
      />
    );
  } else if (screen === 'now-focus') {
    content = <NowScreen user={user} onSettings={() => setScreen('settings')} onBack={() => setScreen('today')} />;
  } else if (screen === 'stuck') {
    content = <AddPainPointScreen user={user} onCreated={() => setScreen('today')} />;
  } else if (screen === 'identity') {
    content = <IdentityScreen user={user} onBack={() => setScreen('today')} />;
  } else {
    content = <TodayScreen user={user} onOpenNow={() => setScreen('now-focus')} onSettings={() => setScreen('settings')} />;
  }

  return (
    <>
      <StatusBar style="light" />
      <View style={s.appRoot}>
        <View style={s.content}>{content}</View>
        <BottomNav
          active={screen === 'stuck' ? 'stuck' : screen === 'identity' ? 'identity' : NOW_TAB_SCREENS.includes(screen) ? 'now' : null}
          onStuck={() => setScreen('stuck')}
          onNow={() => setScreen('today')}
          onIdentity={() => setScreen('identity')}
        />
      </View>
    </>
  );
}

export default function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#0f172a' },
  appRoot: { flex: 1, backgroundColor: '#0f172a' },
  content: { flex: 1 },
  crash: { flex: 1, backgroundColor: '#450a0a' },
  crashContent: { padding: 24, paddingTop: 64 },
  crashTitle: { fontSize: 22, fontWeight: '900', color: '#fecaca', marginBottom: 12 },
  crashMessage: { fontSize: 13, color: '#fca5a5', fontFamily: 'monospace', lineHeight: 19 },
});
