import { useRouter } from 'expo-router';
import { Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <View style={s.container}>
      <Text style={s.emoji} accessibilityElementsHidden>🔍</Text>
      <Text style={s.title} accessibilityRole="header">Page Not Found</Text>
      <Text style={s.subtitle}>This screen doesn't exist.</Text>
      <TouchableOpacity style={s.button} onPress={() = accessibilityLabel="button"> router.replace('/home')} accessibilityLabel="Go to home screen" accessibilityRole="button">
        <Text style={s.buttonText}>Go Home</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create((theme) => ({
  container:  { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emoji:      { fontSize: 60, marginBottom: 20 },
  title:      { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10 },
  subtitle:   { fontSize: 16, color: theme.colors.textSecondary, marginBottom: 30 },
  button:     { backgroundColor: '#53a8b6', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 25 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
}));