/**
 * Supabase Auth client — teacher sign-in only.
 *
 * Students never touch this. They join with a share code and a display name,
 * exactly as before; requiring an account to enter a classroom would put a
 * signup form between a child and the lesson.
 *
 * Only the publishable (anon) key is used. It is meant to ship to browsers —
 * it grants nothing on its own, and every privileged decision is made either by
 * Supabase against the signed-in user or by the orchestrator against a verified
 * JWT. The service-role key must never appear in this app.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Whether sign-in is available in this build.
 *
 * Both values are inlined at build time, so a deployment that never set them
 * has no working auth. The UI reads this to explain that plainly instead of
 * rendering a login form whose every submission fails.
 */
export function authAvailable(): boolean {
  return Boolean(url && anonKey);
}

let client: SupabaseClient | null = null;

/**
 * The browser client, created once.
 *
 * A module-level singleton rather than a per-component instance: each client
 * installs its own auth listener and token-refresh timer, and several of them
 * racing to refresh the same session is a known way to end up signed out.
 * Returns null when unconfigured so callers fail loudly at the call site rather
 * than constructing a client against an empty URL.
 */
export function getSupabase(): SupabaseClient | null {
  if (!authAvailable()) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/**
 * The current access token, or null when signed out.
 *
 * Read on demand rather than cached, because the SDK rotates it roughly hourly
 * and a copy held anywhere else goes stale without warning. `getSession()`
 * returns the refreshed token, so this is always the one to send.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export interface SignedInTeacher {
  userId: string;
  email: string;
  displayName: string | null;
}

export async function getCurrentTeacher(): Promise<SignedInTeacher | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user?.email) return null;
    const metadata = user.user_metadata ?? {};
    const displayName =
      (typeof metadata.display_name === 'string' && metadata.display_name) ||
      (typeof metadata.full_name === 'string' && metadata.full_name) ||
      null;
    return { userId: user.id, email: user.email, displayName };
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}
