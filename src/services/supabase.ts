import 'react-native-url-polyfill/auto';
import { createClient, processLock } from '@supabase/supabase-js';

import { sessionStorage } from './sessionStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

function isProjectUrl(value: string | undefined): value is string {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      Boolean(parsed.hostname) &&
      !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export const supabase =
  isProjectUrl(url) && publishableKey?.startsWith('sb_publishable_')
    ? createClient(url, publishableKey, {
        auth: {
          storage: sessionStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          lock: processLock,
        },
      })
    : null;
