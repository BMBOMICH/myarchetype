import React from 'react';
import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export const ShieldItem = React.memo(function ShieldItem({ text }: { text: string }) {
  return <Text style={styles.shieldItem}>• {text}</Text>;
});

const styles = StyleSheet.create(() => ({
  shieldItem: { fontSize: 12, color: '#a0e8af', marginBottom: 3 },
}));