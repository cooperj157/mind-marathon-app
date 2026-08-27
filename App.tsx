import React from 'react';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from './src/hooks/useAuth';
import { useProfile } from './src/hooks/useProfile';
import UsernameForm from './src/components/UsernameForm';
import LoginScreen from './src/screens/LoginScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen  from './src/screens/GameScreen';
import SettingsScreen from './src/screens/SettingsScreen';

export type RootStackParamList = {
  Login:    undefined;
  Lobby:    undefined;
  Game:     { gameId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Soft-gate: a signed-in user with no username can't reach the lobby/game yet. */
function OnboardingGate({ userId, children }: { userId: string; children: React.ReactNode }) {
  const { loading, needsUsername, saveUsername, refetch } = useProfile(userId);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2C1810" />
      </View>
    );
  }

  if (needsUsername) {
    return (
      <View style={styles.onboarding}>
        <Text style={styles.brand}>Mind Marathon</Text>
        <UsernameForm
          title="Pick a username"
          subtitle="This is how your opponents will see you."
          submitLabel="Continue"
          onSubmit={saveUsername}
          onDone={refetch}
        />
      </View>
    );
  }

  return <>{children}</>;
}

export default function App() {
  const { session, user, loading } = useAuth();

  // Show spinner while checking stored session
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2C1810" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#2C1810' },
          headerTintColor: '#F5DEB3',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        {session && user ? (
          // Logged in — show app (gated on having a username)
          <Stack.Group>
            <Stack.Screen
              name="Lobby"
              options={({ navigation }) => ({
                title: 'Mind Marathon',
                headerRight: () => (
                  <TouchableOpacity onPress={() => navigation.navigate('Settings')} hitSlop={12}>
                    <Text style={styles.headerBtn}>⚙</Text>
                  </TouchableOpacity>
                ),
              })}
            >
              {props => (
                <OnboardingGate userId={user.id}>
                  <LobbyScreen {...props} />
                </OnboardingGate>
              )}
            </Stack.Screen>
            <Stack.Screen name="Game"     component={GameScreen}     options={{ title: 'Game Board' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
          </Stack.Group>
        ) : (
          // Not logged in — show auth
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4E4BC',
  },
  onboarding: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F4E4BC', padding: 28,
  },
  brand: {
    fontSize: 32, fontWeight: 'bold', color: '#2C1810', letterSpacing: 1, marginBottom: 28,
  },
  headerBtn: {
    color: '#F5DEB3', fontSize: 20, paddingHorizontal: 4,
  },
});
