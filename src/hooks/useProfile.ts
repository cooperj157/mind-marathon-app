import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export type SaveUsernameResult = { ok: true } | { ok: false; reason: 'taken' | 'invalid' | 'error' };

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateUsername(raw: string): string | null {
  const name = raw.trim();
  return USERNAME_RE.test(name) ? name : null;
}

/**
 * Loads the caller's own profile row and exposes a self-update for `username`.
 * `needsUsername` drives the onboarding soft-gate: true once we know the row
 * exists and its username is still null.
 */
export function useProfile(userId: string | undefined) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  const refetch = useCallback(async () => {
    if (!userId) { setUsername(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle();
    setUsername(data?.username ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => { refetch(); }, [refetch]);

  const saveUsername = useCallback(async (raw: string): Promise<SaveUsernameResult> => {
    if (!userId) return { ok: false, reason: 'error' };
    const name = validateUsername(raw);
    if (!name) return { ok: false, reason: 'invalid' };

    const { error } = await supabase
      .from('profiles')
      .update({ username: name })
      .eq('id', userId);

    if (error) {
      if (error.code === '23505') return { ok: false, reason: 'taken' };
      return { ok: false, reason: 'error' };
    }
    setUsername(name);
    return { ok: true };
  }, [userId]);

  return {
    username,
    loading,
    needsUsername: !loading && !!userId && username === null,
    refetch,
    saveUsername,
  };
}
