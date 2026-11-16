import { Stack } from 'expo-router';
import { ThemeProvider, DefaultTheme } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '../auth/useSession';
import { supabase } from '../services/supabase';
import { colors } from '../theme';
import { SessionContext } from '../navigation/useRouteSession';

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: colors.blueGray, background: colors.offWhite,
    card: colors.white, text: colors.graphite, border: colors.border },
};

export default function Layout() {
  const { loading, session } = useSession(supabase);
  if (loading) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.offWhite }}>
    <ActivityIndicator accessibilityLabel="Verificando sessão" color={colors.blueGray} />
  </View>;
  return <ThemeProvider value={theme}>
    <SessionContext.Provider value={session}>
    <StatusBar style="dark" />
    <Stack key={session?.user.id ?? 'guest'} screenOptions={{ headerTintColor: colors.blueGray }}>
      <Stack.Screen name="index" options={{ title: 'Delicado Pro', headerShown: false }} />
      <Stack.Protected guard={Boolean(supabase) && !session} redirectTo="/">
        <Stack.Screen name="entrar" options={{ title: 'Delicado Pro' }} />
      </Stack.Protected>
      <Stack.Screen name="configuracoes" options={{ title: 'Configurações' }} />
      <Stack.Protected guard={Boolean(session)} redirectTo="/">
        <Stack.Screen name="catalogo" options={{ title: 'Catálogo' }} />
        <Stack.Screen name="calculadora" options={{ title: 'Calculadora' }} />
        <Stack.Screen name="orcamentos" options={{ title: 'Orçamentos' }} />
        <Stack.Screen name="clientes" options={{ title: 'Clientes' }} />
        <Stack.Screen name="propostas" options={{ title: 'Propostas' }} />
        <Stack.Screen name="perfil" options={{ title: 'Minha conta' }} />
      </Stack.Protected>
    </Stack>
    </SessionContext.Provider>
  </ThemeProvider>;
}
