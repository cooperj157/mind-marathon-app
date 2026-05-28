import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const [mode, setMode]       = useState<'signin' | 'signup'>('signin');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        Alert.alert('Check your email', 'We sent you a confirmation link.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        {/* Header */}
        <Text style={styles.title}>Mind Marathon</Text>
        <Text style={styles.subtitle}>The ultimate trivia race</Text>

        {/* Toggle */}
        <View style={styles.toggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'signin' && styles.toggleActive]}
            onPress={() => setMode('signin')}
          >
            <Text style={[styles.toggleText, mode === 'signin' && styles.toggleTextActive]}>
              Sign In
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'signup' && styles.toggleActive]}
            onPress={() => setMode('signup')}
          >
            <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
              Sign Up
            </Text>
          </TouchableOpacity>
        </View>

        {/* Inputs */}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9C8A6A"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#9C8A6A"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {/* Submit */}
        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#F5DEB3" />
            : <Text style={styles.buttonText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F4E4BC' },
  inner:           { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title:           { fontSize: 36, fontWeight: 'bold', color: '#2C1810', letterSpacing: 1, marginBottom: 6 },
  subtitle:        { fontSize: 15, color: '#5C3317', marginBottom: 36 },
  toggle:          { flexDirection: 'row', backgroundColor: '#E8D4A0', borderRadius: 10, marginBottom: 24, padding: 4 },
  toggleBtn:       { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  toggleActive:    { backgroundColor: '#2C1810' },
  toggleText:      { fontSize: 15, color: '#5C3317', fontWeight: '600' },
  toggleTextActive:{ color: '#F5DEB3' },
  input:           {
    width: '100%', backgroundColor: '#fff', borderWidth: 1.5,
    borderColor: '#C8930A', borderRadius: 10, padding: 14,
    fontSize: 16, color: '#2C1810', marginBottom: 14,
  },
  button:          {
    width: '100%', backgroundColor: '#2C1810', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginTop: 6,
  },
  buttonText:      { color: '#F5DEB3', fontSize: 17, fontWeight: 'bold', letterSpacing: 0.5 },
});
