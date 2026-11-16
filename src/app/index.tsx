import { Redirect, router } from 'expo-router';

import { useContext } from 'react';
import { SessionContext } from '../navigation/useRouteSession';
import { Dashboard } from '../screens/Dashboard';
import { supabase } from '../services/supabase';
import { moduleRoutes } from '../navigation/routes';

export default function Index() {
  const session = useContext(SessionContext);
  if (supabase && !session) return <Redirect href="/entrar" />;
  return <Dashboard preview={!supabase}
    openAccount={() => router.push(supabase ? '/perfil' : '/configuracoes')}
    openModule={(module) => router.push(supabase
      ? moduleRoutes[module]
      : { pathname: '/configuracoes', params: { module } })} />;
}
