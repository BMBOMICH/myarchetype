import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

interface CamErrorViewProps {
  error:   string;
  onRetry: () => void;
}

export const CamErrorView = React.memo(function CamErrorView({
  error, onRetry,
}: CamErrorViewProps) {
  return (
    <View style={styles.camErrBox}>
      <Text style={styles.camErrText}>{error}</Text>
      <TouchableOpacity
        style={styles.retryBtn}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry camera"
      >
        <Text style={styles.retryBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create(() => ({
  camErrBox:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  camErrText:   { color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginBottom: 15 },
  retryBtn:     { backgroundColor: '#e67e22', paddingVertical: 14, paddingHorizontal: 35, borderRadius: 25, marginBottom: 10 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
}));