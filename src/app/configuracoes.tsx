import { useLocalSearchParams } from 'expo-router';
import { Linking, Text } from 'react-native';
import { useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { modules, type Module } from '../screens/Dashboard';
import { supabase } from '../services/supabase';
import { colors } from '../theme';

export default function Settings() {
  const { module } = useLocalSearchParams();
  const [linkError, setLinkError] = useState(false);
  const selected = typeof module === 'string' && Object.hasOwn(modules, module)
    ? modules[module as Module].title : undefined;
  return <Screen title="Configurações" description="Conexão com o Supabase">
    {!supabase && selected && <Text style={{ color: colors.graphite }}>Conecte um projeto para acessar {selected}.</Text>}
    <Text style={{ color: colors.graphite }}>
      {supabase ? 'O endereço do projeto e a chave publicável estão configurados neste ambiente.'
        : 'Preencha EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY no arquivo .env e reinicie o Expo para entrar.'}
    </Text>
    {!supabase && <ActionButton label="Criar projeto no Supabase" onPress={() => {
      setLinkError(false);
      void Linking.openURL('https://supabase.com/dashboard/new').catch(() => setLinkError(true));
    }} />}
    {linkError && <Text accessibilityRole="alert" style={{ color: colors.error }}>
      Abra supabase.com/dashboard/new no seu navegador.
    </Text>}
  </Screen>;
}
