import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../hooks/useAuth';
import { useProfile } from '../hooks/useProfile';
import UsernameForm from '../components/UsernameForm';
import { RootStackParamList } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Settings'>;
};

export default function SettingsScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();
  const { username, loading, saveUsername } = useProfile(user?.id);

  function handleSignOut() {
    Alert.alert('Sign out', 'Sign out of Mind Marathon?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => { await signOut(); }, // App.tsx swaps to Login on session loss
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>USERNAME</Text>
        {loading ? (
          <ActivityIndicator color="#2C1810" />
        ) : (
          <UsernameForm
            title={username ?? 'Choose a username'}
            subtitle={username ? 'Change how other players see you.' : 'Other players will see you by this name.'}
            initialValue={username ?? ''}
            submitLabel="Save username"
            onSubmit={saveUsername}
            onDone={() => Alert.alert('Saved', 'Your username has been updated.')}
          />
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <Text style={styles.email}>{user?.email ?? ''}</Text>
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Back to lobby</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4E4BC', padding: 20, gap: 18 },
  card: {
    backgroundColor: '#fff8e8',
    borderWidth: 1.5,
    borderColor: '#C8930A55',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  sectionLabel: { fontSize: 12, fontWeight: 'bold', color: '#5C3317', letterSpacing: 1 },
  email: { fontSize: 15, color: '#2C1810' },
  signOutBtn: {
    backgroundColor: '#C0392B',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  signOutText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
  back: { fontSize: 14, color: '#5C3317', fontWeight: '600', textAlign: 'center' },
});
