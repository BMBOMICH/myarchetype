import React from 'react';
import { Appearance, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkTokens, lightTokens } from './constants';
import { s } from './styles';

export class SignupErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { /* intentionally silent */ }
  render() {
    if (this.state.hasError) {
      const C = Appearance.getColorScheme() !== 'light' ? darkTokens : lightTokens;
      return (
        <View style={[s.errorFallback, { backgroundColor: C.bg }]}>
          <Ionicons name="warning-outline" size={48} color={C.error} />
          <Text style={[s.errorFallbackTitle, { color: C.textPrimary }]}>Something went wrong</Text>
          <TouchableOpacity onPress={() => this.setState({ hasError: false })} style={[s.retryButton, { borderColor: C.accent }]}>
            <Text style={[s.retryText, { color: C.accent }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}