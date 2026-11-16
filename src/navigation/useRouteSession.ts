import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

export const SessionContext = createContext<Session | null>(null);

export function useRouteSession() {
  const session = useContext(SessionContext);
  return session && supabase ? { client: supabase, user: session.user } : null;
}
