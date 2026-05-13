import React from 'react';
import { Appearance, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkTokens, lightTokens } from './constants';
import { s } from './styles';

export class LoginErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(_error: Error, _info: React.ErrorInfo): void {
    if (__DEV__) console.error('[LoginErrorBoundary]', _error, _info);
  }
  render() {
    if (this.state.hasError) {
      const C = Appearance.getColorScheme() !== 'light' ? darkTokens : lightTokens;
      return (
        <View style={[s.errorFallback, { backgroundColor: C.bg }]}>
          <Ionicons name="warning-outline" size={48} color={C.error} />
          <Text style={[s.errorFallbackTitle, { color: C.textPrimary }]}>Something went wrong</Text>
          <Text style={[s.errorFallbackSub, { color: C.textSecondary }]}>Please restart the app.</Text>
          <TouchableOpacity onPress={() => this.setState({ hasError: false })} style={[s.retryButton, { borderColor: C.accent }]}>
            <Text style={[s.retryText, { color: C.accent }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}