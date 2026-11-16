import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { colors } from '../theme';

export function AccountScreen({ client, email, openSettings }: { client: SupabaseClient; email?: string; openSettings: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);

    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      setFailed(Boolean(error));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Sua conta" description={email}>
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          Não foi possível sair. Tente novamente.
        </Text>
      )}
      <ActionButton
        disabled={busy}
        label={busy ? 'Saindo…' : 'Sair'}
        onPress={() => void signOut()}
      />
      <ActionButton label="Configurações" onPress={openSettings} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.error, fontSize: 16 },
});
