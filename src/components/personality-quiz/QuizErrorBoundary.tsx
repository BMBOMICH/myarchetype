import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';

interface Props {
  children: React.ReactNode;
  onReset:  () => void;
}

interface State {
  hasError: boolean;
  error:    Error | null;
}

export class QuizErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: React.ErrorInfo): void {
    if (__DEV__) console.error('[QuizErrorBoundary]', _error, _info);
  }

  render() {
    if (this.state.hasError) return (
      <SafeAreaView style={st.centered}>
        <Text style={{ fontSize: 50, marginBottom: 16 }}>😵</Text>
        <Text style={st.errTitle}>Something went wrong</Text>
        <Text style={st.errMsg}>{this.state.error?.message ?? 'Unknown error'}</Text>
        <TouchableOpacity
          style={st.errBtn}
          onPress={() => { this.setState({ hasError: false, error: null }); this.props.onReset(); }}
          accessibilityLabel="Try again"
          accessibilityRole="button"
        >
          <Text style={st.errBtnText}>Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
    return this.props.children;
  }
}

const st = StyleSheet.create((theme) => ({
  centered:  { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  errTitle:  { color: theme.colors.text, fontSize: 22, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  errMsg:    { color: theme.colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  errBtn:    { backgroundColor: C.accent, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 25 },
  errBtnText:{ color: C.white, fontSize: 16, fontWeight: '600' },
}));