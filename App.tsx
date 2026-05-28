import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

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
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerStyle: { backgroundColor: '#2C1810' },
          headerTintColor: '#F5DEB3',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Lobby" component={LobbyScreen} options={{ title: 'Mind Marathon' }} />
        <Stack.Screen name="Game"  component={GameScreen}  options={{ title: 'Game Board' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
