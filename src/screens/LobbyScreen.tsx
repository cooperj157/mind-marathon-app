import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function LobbyScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lobby</Text>
      <Text style={styles.subtitle}>Your active games will appear here</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4E4BC' },
  title:     { fontSize: 28, fontWeight: 'bold', color: '#2C1810', marginBottom: 8 },
  subtitle:  { fontSize: 16, color: '#5C3317' },
});
