/**
 * Join screen — PS31 §3.2 (role awareness) and §3.8 (student identification).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SpaceJoinBackground } from '@/components/SpaceJoinBackground';
import { Bell, ExternalLink, Palette, X } from 'lucide-react';
import type { Role } from '@echosphere/shared-types';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  orchestrator,
  storeIdentity,
  type SessionSummary,
} from '@/lib/orchestrator';

const doodleProducts = [
  {
    name: 'The Doodle Kit',
    price: '₹999',
    tag: 'Best seller',
    href: 'https://www.doodleproject.in/product-page/the-doodle-kit',
  },
  {
    name: "Traveller's Doodle Kit",
    price: '₹1,499',
    tag: 'On the go',
    href: 'https://www.doodleproject.in/product-page/traveler-s-doodle-kit',
  },
  {
    name: 'The Therapeutic Art Kit',
    price: '₹1,999',
    tag: 'Relax pick',
    href: 'https://www.doodleproject.in/product-page/the-therapeutic-art-kit?currency=INR',
  },
];

export default function JoinPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [doodleOpen, setDoodleOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await orchestrator.listSessions();
      setSessions(list.filter((s) => s.endedAt === null));
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const join = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await orchestrator.join(sessionId, {
          displayName: displayName.trim(),
          role,
          preferredLanguage: language.trim() || undefined,
        });
        storeIdentity({ ...result, displayName: displayName.trim() });
        router.push(
          role === 'teacher'
            ? `/teacher/${sessionId}`
            : `/classroom/${sessionId}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not join');
        setBusy(false);
      }
    },
    [displayName, role, language, router],
  );

  const createAndJoin = useCallback(
    async (seed?: 'unlike-fractions') => {
      setBusy(true);
      setError(null);
      try {
        const session = await orchestrator.createSession(
          seed
            ? 'Adding unlike fractions'
            : newTitle.trim() || 'Untitled lesson',
          seed,
        );
        await join(session.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create lesson');
        setBusy(false);
      }
    },
    [newTitle, join],
  );

  const nameValid = displayName.trim().length > 0;

  return (
  <SpaceJoinBackground>
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{
        '--eco-athena': 'var(--eco-glow)',
        '--eco-cream': '#ffffff',
        '--eco-cream-dim': '#e5e7eb',
        '--eco-cream-faint': '#cbd5e1',
        // Text was pinned for the always-dark starfield, but the surface
        // tokens behind it were not: --eco-ink-raised/-sunken still flip
        // light in light mode, so anything filled with them (the name
        // input, the doodle popover, "Join by code") turned into pale text
        // on a pale box. Pin these to their dark-theme values too, so every
        // fill on this page stays a dark surface the pinned light text can
        // actually sit on, matching the dark theme's own pairing.
        '--eco-ink-raised': '#151417',
        '--eco-ink-sunken': '#101013',
      } as React.CSSProperties}
    >
      {/* ── Top nav ─────────────────────────────────────────────────── */}
      <header className="mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span className="eco-lamp eco-lamp-glow eco-pulse" />
          <span className="eco-wordmark text-lg text-[var(--eco-cream)]">
            Athena
          </span>
        </div>
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            aria-label="Open doodle and relax corner"
            aria-expanded={doodleOpen}
            onClick={() => setDoodleOpen((open) => !open)}
            className="group relative inline-flex h-10 w-10 items-center justify-center rounded-full border text-[var(--eco-cream)] shadow-sm transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--eco-athena)]"
            style={{
              borderColor: 'var(--eco-rule)',
              background: 'color-mix(in srgb, var(--eco-ink-raised) 82%, transparent)',
            }}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span
              className="absolute right-2 top-2 h-2 w-2 rounded-full"
              style={{ background: 'var(--eco-athena)' }}
            />
          </button>
          {doodleOpen && (
            <aside
              className="eco-glass absolute right-0 top-12 z-20 flex w-[min(20rem,calc(100vw-3rem))] flex-col gap-3 p-4 text-left shadow-2xl"
              aria-label="Doodle and relax corner"
              /* .eco-glass's own 88% background reads white in light mode --
                 fine over a photo, but this panel floats over the always-dark
                 starfield with text pinned white (see the wrapper above), so
                 the default washes it out. Match the other glass cards on
                 this page, which already override it for the same reason. */
              style={{
                background: 'color-mix(in srgb, var(--eco-ink-raised) 45%, transparent)',
                backdropFilter: 'blur(20px)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      background:
                        'color-mix(in srgb, var(--eco-athena) 20%, transparent)',
                      color: 'var(--eco-athena)',
                    }}
                  >
                    <Palette className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="eco-label text-[var(--eco-athena)]">
                      Doodle & relax corner
                    </p>
                    <p className="text-xs text-[var(--eco-cream-dim)]">
                      Tiny creative breaks before class.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close doodle and relax corner"
                  onClick={() => setDoodleOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--eco-cream-dim)] transition-colors hover:bg-white/10 hover:text-[var(--eco-cream)]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {doodleProducts.map((product) => (
                  <a
                    key={product.name}
                    href={product.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-white/10"
                    style={{
                      borderColor: 'var(--eco-rule)',
                      // A light tint added on top of the panel's own background
                      // rather than --eco-ink-sunken directly, which reads as a
                      // near-white card in light mode against text pinned white.
                      background: 'color-mix(in srgb, var(--eco-cream) 8%, transparent)',
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--eco-cream)]">
                        {product.name}
                      </span>
                      <span className="block text-xs text-[var(--eco-cream-faint)]">
                        {product.tag}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--eco-athena)]">
                      {product.price}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </a>
                ))}
              </div>

              <a
                href="https://www.doodleproject.in/shop-1"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  background: 'var(--eco-athena)',
                  color: 'var(--eco-ink)',
                }}
              >
                Browse the shop
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </aside>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <main className="mx-auto flex w-full min-h-0 max-w-[95vw] flex-1 flex-col gap-4 px-6 py-4">
        {reachable === false && (
          <p
            className="eco-glass w-full shrink-0 px-4 py-3 text-sm animate-fade-up animate-fade-up-d1"
            style={{ color: 'var(--eco-cream)' }}
          >
            Cannot reach the orchestrator at{' '}
            <code className="eco-numerals">{orchestrator.baseUrl}</code>. Start
            it with{' '}
            <code className="eco-numerals">
              pnpm --filter @echosphere/orchestrator dev
            </code>
            .
          </p>
        )}

        {error && (
          <p
            className="eco-glass w-full shrink-0 px-4 py-3 text-sm animate-fade-up"
            style={{ color: 'var(--eco-cream)' }}
          >
            {error}
          </p>
        )}

        {/* Two cards side by side from `lg` up; stacked (and page-scrolling)
            below that. Each card owns its own internal scroll so the page
            itself never needs to. */}
        <div className="mt-10 grid grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2 lg:gap-[30%] lg:overflow-visible">
          {/* Left: identity + role (+ create lesson for teachers) */}
          <section
            className="eco-glass flex min-h-0 flex-col gap-5 overflow-y-auto p-6 animate-fade-up animate-fade-up-d1"
            style={{ background: 'color-mix(in srgb, var(--eco-ink-raised) 45%, transparent)', backdropFilter: 'blur(20px)' }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="eco-label-dim">Your name</span>
              <input
                className="rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Ana"
                autoFocus
              />
            </label>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="eco-label-dim">Join as</legend>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRole('student')}
                  className="flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                  style={
                    role === 'student'
                      ? { borderColor: 'var(--eco-athena)', background: 'var(--eco-athena)', color: 'var(--eco-ink)' }
                      : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
                  }
                >
                  Join as student
                </button>
                <button
                  type="button"
                  onClick={() => setRole('teacher')}
                  className="flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                  style={
                    role === 'teacher'
                      ? { borderColor: 'var(--eco-athena)', color: 'var(--eco-athena)' }
                      : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
                  }
                >
                  Join as teacher
                </button>
              </div>
              <p className="text-xs text-[var(--eco-cream-faint)]">
                {role === 'teacher'
                  ? 'Teachers get the control panel, gap dashboard, and post-class report. One teacher per classroom.'
                  : 'Students get the transcript, quiz cards, and can ask the AI by name.'}
              </p>
            </fieldset>

            {role === 'teacher' && (
              <div className="flex flex-col gap-2 border-t pt-5" style={{ borderColor: 'var(--eco-rule)' }}>
                <h2 className="eco-label-dim">Start a new lesson</h2>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                    style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Lesson title, e.g. Adding unlike fractions"
                  />
                  <button
                    type="button"
                    disabled={!nameValid || busy}
                    onClick={() => void createAndJoin()}
                    className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
                    style={{ background: 'var(--eco-athena)', color: 'var(--eco-ink)' }}
                  >
                    {busy ? 'Creating…' : 'Create'}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!nameValid || busy}
                  onClick={() => void createAndJoin('unlike-fractions')}
                  className="self-start rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream)] disabled:opacity-40"
                  style={{ borderColor: 'var(--eco-rule)' }}
                >
                  Start fractions demo (LCD)
                </button>
                {!nameValid && (
                  <p className="text-xs text-[var(--eco-cream-faint)]">
                    Enter your name above first.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Right: language (students) + 4-digit code entry + live sessions list */}
          <section
            className="eco-glass flex min-h-0 flex-col gap-4 overflow-y-auto p-6 animate-fade-up animate-fade-up-d2"
            style={{ background: 'color-mix(in srgb, var(--eco-ink-raised) 45%, transparent)', backdropFilter: 'blur(20px)' }}
          >
            {role === 'student' && (
              <label className="flex flex-col gap-1.5 border-b pb-4" style={{ borderColor: 'var(--eco-rule)' }}>
                <span className="eco-label-dim">
                  Classroom & Speaking Language{' '}
                  <span className="normal-case tracking-normal text-[var(--eco-cream-faint)]">
                    (optional)
                  </span>
                </span>
                <select
                  className="rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                  style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="">Default (English)</option>
                  <option value="fr">Français (French)</option>
                  <option value="es">Español (Spanish)</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="de">Deutsch (German)</option>
                  <option value="ta">தமிழ் (Tamil)</option>
                  <option value="te">తెలుగు (Telugu)</option>
                  <option value="en">English</option>
                </select>
              </label>
            )}

            {/* Quick 4-Digit Share Code Entry */}
            <div
              className="flex flex-col gap-2 rounded-xl border p-4 shadow-sm"
              style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
            >
              <div className="flex items-center justify-between">
                <span className="eco-label-dim">Enter 4-Digit Share Code</span>
                <span className="text-[10px] text-[var(--eco-cream-faint)]">e.g. 4829</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={shareCodeInput}
                  onChange={(e) => setShareCodeInput(e.target.value.trim())}
                  placeholder="4-digit code"
                  className="flex-1 rounded-lg border px-3 py-2 text-center font-mono text-base font-bold tracking-widest text-[var(--eco-cream)] outline-none focus:border-[var(--eco-glow)]"
                  style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink)' }}
                />
                <button
                  type="button"
                  disabled={!nameValid || busy || shareCodeInput.length === 0}
                  onClick={() => void join(shareCodeInput)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--eco-athena)', color: 'var(--eco-ink)' }}
                >
                  {busy && selectedSessionId === shareCodeInput ? 'Joining…' : 'Join by Code'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h2 className="eco-label">
                {sessions.length > 0 ? 'Active Classrooms' : 'No active classrooms'}
              </h2>
              <span className="text-xs text-[var(--eco-cream-faint)]">
                {sessions.length} live
              </span>
            </div>

            {sessions.length === 0 && reachable !== false && (
              <div className="flex flex-col items-start gap-2">
                {role === 'teacher' ? (
                  <p className="text-sm text-[var(--eco-cream-dim)]">
                    Give your lesson a title on the left and press{' '}
                    <strong className="text-[var(--eco-cream)]">Create</strong> to
                    open the first classroom.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-[var(--eco-cream-dim)]">
                      Ask your teacher for the 4-digit code, or wait for a lesson to start.
                    </p>
                    <button
                      type="button"
                      onClick={() => setRole('teacher')}
                      className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream)]"
                      style={{ borderColor: 'var(--eco-athena)' }}
                    >
                      I&rsquo;m the teacher — start a lesson
                    </button>
                  </>
                )}
              </div>
            )}

            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {sessions.map((session) => (
                <li
                  key={session.sessionId}
                  className="flex items-center justify-between rounded-[0.625rem] border p-3.5"
                  style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`eco-lamp ${session.agentId ? 'eco-lamp-glow' : 'eco-lamp-off'}`}
                    />
                    <div>
                      <p className="text-sm font-medium text-[var(--eco-cream)]">
                        {session.title}
                      </p>
                      <p className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
                        {session.participantCount} in room ·{' '}
                        {session.agentId ? 'AI co-teacher present' : 'AI not started'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!nameValid || busy}
                    onClick={() => {
                      setSelectedSessionId(session.sessionId);
                      void join(session.sessionId);
                    }}
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium text-[var(--eco-cream)] disabled:opacity-40 transition-colors hover:bg-white/5"
                    style={{ borderColor: 'var(--eco-athena)' }}
                  >
                    {busy && selectedSessionId === session.sessionId
                      ? 'Joining…'
                      : 'Join'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  </SpaceJoinBackground>
  );
}
