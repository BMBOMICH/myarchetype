import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Log In' }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ title: 'Sign Up' }} />
        <Stack.Screen name="my-matches" options={{ title: 'My Matches' }} />
        <Stack.Screen name="profile-setup" options={{ title: 'Create Profile' }} />
        <Stack.Screen name="home" options={{ title: 'Home', headerShown: false }} />
        <Stack.Screen name="matches" options={{ title: 'Find Matches' }} />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}