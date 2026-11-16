import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { colors, spacing } from '../theme';

export function SignInScreen({ client, openSettings }: { client: SupabaseClient; openSettings: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn() {
    setBusy(true);
    setError('');

    try {
      const result = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        setError(result.error.code === 'invalid_credentials'
          ? 'E-mail ou senha inválidos.'
          : 'Não foi possível entrar. Tente novamente.');
      }
    } catch {
      setError('Não foi possível conectar. Verifique sua conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Entrar" description="Use o e-mail e a senha da sua conta.">
      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>E-mail</Text>
          <TextInput
            accessibilityLabel="E-mail"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!busy}
            keyboardType="email-address"
            onChangeText={setEmail}
            style={styles.input}
            value={email}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Senha</Text>
          <TextInput
            accessibilityLabel="Senha"
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect={false}
            editable={!busy}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
        {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <ActionButton
          disabled={busy || !email.trim() || !password}
          label={busy ? 'Entrando…' : 'Entrar'}
          onPress={() => void signIn()}
        />
      </View>
      <ActionButton label="Configurações" onPress={openSettings} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.medium },
  field: { gap: spacing.small },
  label: { color: colors.graphite, fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.graphite,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.small,
  },
  error: { color: colors.error, fontSize: 16 },
});
