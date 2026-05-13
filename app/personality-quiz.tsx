import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export default function PersonalityQuizScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Personality quiz is only available in the mobile app.</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },
  text: { color: theme.colors.text, fontSize: 16, textAlign: 'center', padding: 20 },
}));
