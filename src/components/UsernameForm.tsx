import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SaveUsernameResult } from '../hooks/useProfile';

type Props = {
  title:        string;
  subtitle?:    string;
  initialValue?: string;
  submitLabel:  string;
  onSubmit:     (name: string) => Promise<SaveUsernameResult>;
  onDone:       () => void;
};

const MESSAGES: Record<string, string> = {
  taken:   "That name's taken — try another.",
  invalid: 'Use 3–20 letters, numbers or underscores.',
  error:   'Something went wrong. Try again.',
};

export default function UsernameForm({
  title, subtitle, initialValue = '', submitLabel, onSubmit, onDone,
}: Props) {
  const [value, setValue]   = useState(initialValue);
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    setError('');
    const result = await onSubmit(value);
    setSaving(false);
    if (result.ok) {
      onDone();
    } else {
      setError(MESSAGES[result.reason] ?? MESSAGES.error);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <TextInput
        style={styles.input}
        placeholder="username"
        placeholderTextColor="#9C8A6A"
        value={value}
        onChangeText={t => { setValue(t); setError(''); }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
      />

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={saving}>
        {saving
          ? <ActivityIndicator color="#F5DEB3" />
          : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { width: '100%' },
  title:     { fontSize: 22, fontWeight: 'bold', color: '#2C1810', marginBottom: 6 },
  subtitle:  { fontSize: 14, color: '#5C3317', marginBottom: 18 },
  input: {
    width: '100%', backgroundColor: '#fff', borderWidth: 1.5,
    borderColor: '#C8930A', borderRadius: 10, padding: 14,
    fontSize: 16, color: '#2C1810', marginBottom: 12,
  },
  button: {
    width: '100%', backgroundColor: '#2C1810', borderRadius: 10,
    paddingVertical: 15, alignItems: 'center', marginTop: 4,
  },
  buttonText: { color: '#F5DEB3', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
  errorText:  { color: '#C0392B', fontSize: 13, marginBottom: 10 },
});
