import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>MyArchetype</Text>
      <Text style={styles.tagline}>Find Your Genuine Connection</Text>
      
      <Text style={styles.description}>
        Deep compatibility matching for serious people.{'\n'}
        No superficial swiping. Real connections.
      </Text>
      
      <TouchableOpacity 
        style={styles.button} 
        onPress={() => router.push('/login')}
      >
        <Text style={styles.buttonText}>Get Started</Text>
      </TouchableOpacity>
      
      <Text style={styles.footer}>Join the movement for authentic dating</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logo: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 10,
  },
  tagline: {
    fontSize: 18,
    color: '#aaa',
    marginBottom: 40,
    fontStyle: 'italic',
  },
  description: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 50,
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#0f3460',
    paddingVertical: 15,
    paddingHorizontal: 60,
    borderRadius: 25,
    marginBottom: 30,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  footer: {
    fontSize: 12,
    color: '#666',
    marginTop: 20,
  },
});