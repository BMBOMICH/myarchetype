import React from 'react';
import { Image } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export const Thumb = React.memo(function Thumb({
  uri, index,
}: { uri: string; index: number }) {
  return (
    <Image
      source={{ uri }}
      style={styles.thumb}
      accessibilityLabel={`Captured selfie ${index + 1}`}
    />
  );
});

const styles = StyleSheet.create(() => ({
  thumb: { width: 60, height: 80, borderRadius: 8, borderWidth: 2, borderColor: '#53a8b6' },
}));