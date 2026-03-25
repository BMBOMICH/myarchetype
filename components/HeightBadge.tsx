import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface HeightBadgeProps {
  height: number | { value: number; verificationMethod?: string; confidence?: number };
  style?: any;
}

export default function HeightBadge({ height, style }: HeightBadgeProps) {
  // Handle both old (number) and new (object) formats
  const heightValue = typeof height === 'number' ? height : height.value;
  const method = typeof height === 'object' ? height.verificationMethod : undefined;
  const confidence = typeof height === 'object' ? height.confidence : undefined;

  const getBadgeText = () => {
    if (method === 'manual-measured') {
      return `${heightValue}cm ✓`;
    } else if (method === 'ai-estimated') {
      return `~${heightValue}cm 🤖`;
    } else {
      return `${heightValue}cm`;
    }
  };

  const getBadgeColor = () => {
    if (method === 'manual-measured') {
      return '#5cb85c'; // Green for verified
    } else if (method === 'ai-estimated') {
      return '#53a8b6'; // Blue for AI
    } else {
      return '#aaa'; // Gray for self-reported
    }
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.text, { color: getBadgeColor() }]}>
        {getBadgeText()}
      </Text>
      {method === 'ai-estimated' && confidence && (
        <Text style={styles.confidence}>({confidence}% confidence)</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
  confidence: {
    fontSize: 11,
    color: '#666',
  },
});