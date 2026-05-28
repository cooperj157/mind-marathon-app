import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from './src/hooks/useAuth';
import LoginScreen from './src/screens/LoginScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen  from './src/screens/GameScreen';

export type RootStackParamList = {
  Login: undefined;
  Lobby: undefined;
  Game:  { gameId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { session, loading } = useAuth();

  // Show spinner while checking stored session
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4E4BC' }}>
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
        {session ? (
          // Logged in — show app
          <>
            <Stack.Screen name="Lobby" component={LobbyScreen} options={{ title: 'Mind Marathon' }} />
            <Stack.Screen name="Game"  component={GameScreen}  options={{ title: 'Game Board' }} />
          </>
        ) : (
          // Not logged in — show auth
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
