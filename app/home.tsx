import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth } from '../firebaseConfig';

export default function HomeScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log('✅ Logged out successfully');
      router.replace('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to MyArchetype! 🎉</Text>
      
      <Text style={styles.email}>
        Logged in as: {user?.email}
      </Text>

      <Text style={styles.subtitle}>
        This is your home page!{'\n'}
        Find your perfect match below.
      </Text>

      <TouchableOpacity 
        style={styles.myMatchesButton} 
        onPress={() => router.push('/my-matches')}
      >
        <Text style={styles.buttonText}>💚 My Matches</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.findMatchesButton} 
        onPress={() => router.push('/matches')}
      >
        <Text style={styles.buttonText}>🔍 Find Matches</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.buttonText}>Log Out</Text>
      </TouchableOpacity>
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
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 20,
    textAlign: 'center',
  },
  email: {
    fontSize: 16,
    color: '#53a8b6',
    marginBottom: 40,
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 50,
    lineHeight: 24,
  },
  myMatchesButton: {
    backgroundColor: '#5cb85c',
    paddingVertical: 15,
    paddingHorizontal: 60,
    borderRadius: 25,
    marginBottom: 10,
  },
  findMatchesButton: {
    backgroundColor: '#53a8b6',
    paddingVertical: 15,
    paddingHorizontal: 60,
    borderRadius: 25,
    marginBottom: 10,
  },
  logoutButton: {
    backgroundColor: '#d9534f',
    paddingVertical: 15,
    paddingHorizontal: 60,
    borderRadius: 25,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});