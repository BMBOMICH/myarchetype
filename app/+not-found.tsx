import '../src/styles/unistyles';
import { useRouter } from 'expo-router';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';

const ROUTES = {
  home: '/home',
  login: '/login',
} as const;

interface NotFoundScreenProps {
  onGoHome?: () => void;
}

export default function NotFoundScreen({ onGoHome }: NotFoundScreenProps = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const handleGoHome = () => {
    if (onGoHome) {
      onGoHome();
      return;
    }
    const target = auth.currentUser ? ROUTES.home : ROUTES.login;
    router.replace(target);
  };

  const emojiSize = Math.min(80, screenWidth * 0.15);

  return (
    <View
      style={[styles.container, { paddingTop: insets.top }]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel="Page not found"
      accessibilityLiveRegion="polite"
      testID="not-found-screen"
    >
      <Text style={[styles.emoji, { fontSize: emojiSize }]} accessibilityElementsHidden>🔍</Text>
      <Text
        style={styles.title}
        accessibilityRole="header"
        accessibilityLabel="Page Not Found, heading"
        testID="not-found-title"
      >
        Page Not Found
      </Text>
      <Text style={styles.subtitle} testID="not-found-subtitle">
        This screen doesn't exist.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={handleGoHome}
        activeOpacity={0.8}
        accessibilityLabel="Go to home screen"
        accessibilityRole="button"
        accessibilityHint="Navigates to the home screen"
        testID="not-found-go-home"
      >
        <Text style={styles.buttonText}>Go Home</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emoji: { marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10 },
  subtitle: { fontSize: 16, color: theme.colors.textSecondary, marginBottom: 30 },
  button: { backgroundColor: theme.colors.primary, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 25 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
}));