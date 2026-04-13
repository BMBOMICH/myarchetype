import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

interface HeightData { value: number; verificationMethod?: string; confidence?: number; }

interface HeightBadgeProps {
  height: number | HeightData;
  style?: ViewStyle;
}

export default function HeightBadge({ height, style }: HeightBadgeProps) {
  const heightValue  = typeof height === 'number' ? height : height.value;
  const method       = typeof height === 'object' ? height.verificationMethod : undefined;
  const confidence   = typeof height === 'object' ? height.confidence : undefined;

  const badgeText = method === 'manual-measured' ? `${heightValue}cm ✓`
    : method === 'ai-estimated' ? `~${heightValue}cm 🤖`
    : `${heightValue}cm`;

  const badgeColor = method === 'manual-measured' ? '#5cb85c'
    : method === 'ai-estimated' ? '#53a8b6'
    : '#aaa';

  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.text, { color: badgeColor }]}>{badgeText}</Text>
      {method === 'ai-estimated' && confidence != null && (
        <Text style={styles.confidence}>({confidence}% confidence)</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  text:       { fontSize: 15, fontWeight: '600' },
  confidence: { fontSize: 11, color: '#666' },
});