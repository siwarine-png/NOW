/**
 * A depleting ring, same idea as a physical Time Timer -- full disk means
 * plenty of time left, empty means it's arrived/over. `fraction` is what's
 * REMAINING (1 = full ring, 0 = drained), not elapsed, since "how much is
 * left" is the number that actually matters for time blindness.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export default function RingProgress({ size = 64, strokeWidth = 6, fraction = 1, color = '#6366f1', trackColor = '#0f172a', label }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  // Never fully zero the visible arc -- a literal 0-length stroke can look
  // identical to a rendering failure, and "it's due right now" is exactly
  // the moment this cue matters most, so it always keeps a sliver lit.
  const dashOffset = circumference * (1 - Math.max(clamped, 0.02));

  return (
    <View style={[s.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={trackColor} strokeWidth={strokeWidth} fill="none"
        />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation="-90" origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={s.center}>
        <Text style={s.centerText} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  centerText: { fontSize: 13, fontWeight: '800', color: '#f1f5f9' },
});
