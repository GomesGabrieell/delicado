import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

export function useSession(client: SupabaseClient | null) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(client));

  useEffect(() => {
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, current) => {
      setSession(current);
      setLoading(false);
    });
    if (Platform.OS === 'web') return () => subscription.unsubscribe();

    const setRefreshActive = (active: boolean) => {
      if (active) {
        void client.auth.startAutoRefresh();
      } else {
        void client.auth.stopAutoRefresh();
      }
    };

    const appState = AppState.addEventListener('change', (state) => {
      setRefreshActive(state === 'active');
    });
    setRefreshActive(AppState.currentState === 'active');

    return () => {
      appState.remove();
      subscription.unsubscribe();
      void client.auth.stopAutoRefresh();
    };
  }, [client]);

  return { loading, session };
}
