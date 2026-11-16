import { Redirect, router } from 'expo-router';
import { useContext } from 'react';
import { SessionContext } from '../navigation/useRouteSession';
import { SignInScreen } from '../screens/SignInScreen';
import { supabase } from '../services/supabase';

export default function Login() {
  const session = useContext(SessionContext);
  if (!supabase || session) return <Redirect href="/" />;
  return <SignInScreen client={supabase} openSettings={() => router.push('/configuracoes')} />;
}
