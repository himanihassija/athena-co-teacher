/**
 * Teacher sign-in.
 *
 * Deliberately not on the path to a classroom. Students reach a lesson through
 * /join with a share code and never see this page; a teacher signs in here so
 * the lessons they create are owned by their account and their post-class
 * reports stay private to them.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  authAvailable,
  getCurrentTeacher,
  getSupabase,
  signOut,
  type SignedInTeacher,
} from '@/lib/supabase';

type Mode = 'sign-in' | 'sign-up';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<SignedInTeacher | null>(null);
  const [checked, setChecked] = useState(false);

  const configured = authAvailable();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await getCurrentTeacher();
      if (!cancelled) {
        setTeacher(current);
        setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const supabase = getSupabase();
      if (!supabase) return;

      setBusy(true);
      setError(null);
      setNotice(null);

      try {
        if (mode === 'sign-up') {
          const { data, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
            },
          });
          if (signUpError) throw signUpError;

          // With email confirmation enabled, signUp returns a user but no
          // session — the account exists and cannot be used until the link is
          // clicked. Saying "signed in" here would be a lie the next click
          // exposes, so the two cases are reported separately.
          if (!data.session) {
            setNotice(
              'Account created. Check your email for the confirmation link, then sign in.',
            );
            setMode('sign-in');
            return;
          }
        } else {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (signInError) throw signInError;
        }

        const current = await getCurrentTeacher();
        setTeacher(current);
        if (current) router.push('/join');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [mode, email, password, displayName, router],
  );

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    await signOut();
    setTeacher(null);
    setBusy(false);
  }, []);

  if (!configured) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Teacher sign-in unavailable</h1>
        <p className="text-sm opacity-80">
          This deployment was built without Supabase credentials, so sign-in is
          switched off. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and rebuild to enable it.
        </p>
        <p className="text-sm opacity-80">
          Lessons still work without an account — they just are not tied to one.
        </p>
        <Link className="text-sm underline" href="/join">
          Go to the join screen
        </Link>
      </main>
    );
  }

  if (checked && teacher) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Signed in</h1>
          <ThemeToggle />
        </div>
        <p className="text-sm opacity-80">
          {teacher.displayName ? `${teacher.displayName} — ` : ''}
          {teacher.email}
        </p>
        <p className="text-sm opacity-80">
          Lessons you create from here on belong to this account.
        </p>
        <div className="flex gap-3">
          <Link
            className="rounded-md bg-foreground px-4 py-2 text-sm text-background"
            href="/join"
          >
            Start a lesson
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={busy}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {mode === 'sign-in' ? 'Teacher sign-in' : 'Create a teacher account'}
        </h1>
        <ThemeToggle />
      </div>

      <p className="text-sm opacity-80">
        Students do not need an account — they join with a share code.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === 'sign-up' && (
          <label className="flex flex-col gap-1 text-sm">
            Your name
            <input
              className="rounded-md border px-3 py-2"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Ms Rao"
              autoComplete="name"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            className="rounded-md border px-3 py-2"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            className="rounded-md border px-3 py-2"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {notice && <p className="text-sm opacity-80">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="text-sm underline opacity-80"
        onClick={() => {
          setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
          setError(null);
          setNotice(null);
        }}
      >
        {mode === 'sign-in'
          ? 'Need an account? Create one'
          : 'Already have an account? Sign in'}
      </button>

      <Link className="text-sm underline opacity-70" href="/join">
        Continue without signing in
      </Link>
    </main>
  );
}
