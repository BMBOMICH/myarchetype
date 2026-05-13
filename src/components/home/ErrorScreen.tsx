import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { MAX_FONT_SCALE } from './types';

interface ErrorScreenProps {
  error: string;
  onRetry: () => void;
}

export const ErrorScreen = React.memo(function ErrorScreen({
  error, onRetry,
}: ErrorScreenProps) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.emoji} accessibilityElementsHidden>😕</Text>
      <Text
        style={styles.message}
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {error}
      </Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={onRetry}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Retry loading"
        accessibilityHint="Double tap to retry"
      >
        <Text style={styles.btnText} maxFontSizeMultiplier={MAX_FONT_SCALE}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex:              1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: theme.spacing.xl,
    backgroundColor:   theme.colors.background,
  },
  emoji:   { fontSize: 40, marginBottom: 16 },
  message: {
    fontSize:     16,
    textAlign:    'center',
    marginBottom: theme.spacing.xl,
    lineHeight:   24,
    color:        theme.colors.text,
  },
  btn: {
    paddingVertical:   theme.spacing.md,
    paddingHorizontal: theme.spacing.xxxl,
    borderRadius:      theme.radius.xl,
    minHeight:         48,
    justifyContent:    'center',
    alignItems:        'center',
    backgroundColor:   theme.colors.primary,
  },
  btnText: { fontSize: 16, fontWeight: '600', color: theme.colors.white },
}));