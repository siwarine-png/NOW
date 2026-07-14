/**
 * Hatch — temporary tab embedding HatchEm (public/hatchem.html), a
 * standalone zero-friction idea incubator built as its own local-storage-
 * only tool. Deliberately NOT wired into DESIRED's engine/Supabase (see
 * the HatchEm MVP1 spec: the "push one thing" engine this app already is
 * is explicitly future/separate scope for it) -- this just gives it a
 * discoverable home inside the app for now via a plain iframe, meant to
 * come back out once it's either graduated to its own deployment or the
 * trial's over. Web only, same reasoning as AddPainPointScreen's raw
 * <input type="file"> -- a plain DOM element passed straight through by
 * react-native-web, gated behind Platform.OS so native doesn't choke on it.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

export default function HatchScreen() {
  if (Platform.OS !== 'web') {
    return (
      <View style={s.center}>
        <Text style={s.title}>🥚 Hatch</Text>
        <Text style={s.note}>Open desiredapp.com in a browser to use Hatch for now.</Text>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <iframe src="/hatchem.html" title="HatchEm" style={iframeStyle} />
    </View>
  );
}

// Plain object, not StyleSheet.create() -- this becomes a real DOM
// element's style prop on web, not a React Native style.
const iframeStyle = { flex: 1, width: '100%', height: '100%', border: 'none' };

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', padding: 24 },
  title: { fontSize: 22, fontWeight: '900', color: '#f1f5f9', marginBottom: 10 },
  note: { fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },
});
