/**
 * Sets up the browser-only Agora pieces for a classroom and hands them to the
 * page: an RTC provider and a logged-in RTM client.
 *
 * RTM login identity must equal the uid the token was minted for — mismatching
 * them surfaces as an opaque connection failure rather than an auth error, so
 * both come from the same `identity` object rather than being passed separately.
 */

'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RTMClient } from 'agora-rtm';
import { clearIdentity, orchestrator, type StoredIdentity } from '@/lib/orchestrator';

const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } = await import('agora-rtc-react');
    return {
      default: function Provider({ children }: { children: ReactNode }) {
        // useRef, not useMemo: StrictMode's simulated remount would otherwise
        // create two RTC clients.
        const clientRef = useRef<ReturnType<typeof AgoraRTC.createClient> | null>(
          null,
        );
        if (!clientRef.current) {
          clientRef.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        }
        return (
          <AgoraRTCProvider client={clientRef.current}>{children}</AgoraRTCProvider>
        );
      },
    };
  },
  { ssr: false },
);

export interface ClassroomShellProps {
  identity: StoredIdentity;
  children: (rtm: RTMClient) => ReactNode;
}

/**
 * Agora rejects a second RTM login for a uid that is already connected
 * (error -10027), and warns about "mutual kick" the moment a second instance
 * exists in one page at all. Two things cause that here: a duplicated browser
 * tab, which copies sessionStorage and therefore the stored identity, and any
 * remount that creates a client before the previous one has logged out.
 */
function isDuplicateIdentityError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes('-10027') || text.includes('already in use');
}

/**
 * One RTM client per (app, uid, channel), shared across mounts.
 *
 * A `useEffect` guard is not enough on its own. StrictMode's double-mount is
 * only the tidiest case; Fast Refresh remounts, route transitions, and a
 * re-render that changes the identity object all create a second client while
 * the first is still logging out, and the SDK counts every one of them
 * ("Ins id is 2..."). Keying the client outside React means a remount joins the
 * existing connection instead of racing it, and the login only happens once.
 *
 * Reference-counted rather than never released: the last mount to leave logs
 * out, so the uid is free the next time someone joins.
 */
interface RtmEntry {
  clientPromise: Promise<RTMClient>;
  refs: number;
  /** Pending teardown, cancelled if the client is re-acquired in time. */
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const rtmClients = new Map<string, RtmEntry>();

/**
 * How long a zero-reference client is kept alive before logging out.
 *
 * This grace period is the whole point of the registry. React's StrictMode
 * runs the fake unmount's cleanup *synchronously*, before the real mount — so
 * releasing immediately deletes the entry, the real mount finds nothing, and it
 * opens a second connection for a uid that is still logged in. That is exactly
 * the "-10027 / Ins id is 2" collision. Holding the client for a moment lets the
 * remount re-acquire the same connection instead of racing it.
 */
const RTM_DISPOSE_GRACE_MS = 3000;

function rtmKey(identity: StoredIdentity): string {
  return `${identity.appId}:${identity.uid}:${identity.channel}`;
}

function acquireRtm(identity: StoredIdentity): Promise<RTMClient> {
  const key = rtmKey(identity);
  const existing = rtmClients.get(key);

  if (existing) {
    // Re-acquired inside the grace period: keep the live connection.
    if (existing.disposeTimer !== null) {
      clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    existing.refs += 1;
    return existing.clientPromise;
  }

  const clientPromise = (async () => {
    const { default: AgoraRTM } = await import('agora-rtm');
    const client: RTMClient = new AgoraRTM.RTM(identity.appId, identity.uid);
    await client.login({ token: identity.rtmToken });
    await client.subscribe(identity.channel);
    return client;
  })();

  // A failed login must not be cached, or every later attempt replays the same
  // rejection and the room can never recover.
  clientPromise.catch(() => rtmClients.delete(key));

  rtmClients.set(key, { clientPromise, refs: 1, disposeTimer: null });
  return clientPromise;
}

function releaseRtm(identity: StoredIdentity): void {
  const key = rtmKey(identity);
  const entry = rtmClients.get(key);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0 || entry.disposeTimer !== null) return;

  entry.disposeTimer = setTimeout(() => {
    // Re-check: a mount may have arrived after the timer was scheduled.
    const current = rtmClients.get(key);
    if (!current || current.refs > 0) return;
    rtmClients.delete(key);
    current.clientPromise.then((c) => c.logout()).catch(() => undefined);
  }, RTM_DISPOSE_GRACE_MS);
}

/**
 * Logs every client out when the page goes away.
 *
 * Without this, a reload races the previous connection: the browser tears the
 * page down without notifying Agora, the new page logs in with the same uid
 * within a second, and the server still considers the old session live.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const [key, entry] of rtmClients) {
      rtmClients.delete(key);
      entry.clientPromise.then((c) => c.logout()).catch(() => undefined);
    }
  });
}

export function ClassroomShell({ identity, children }: ClassroomShellProps) {
  const router = useRouter();
  const [rtm, setRtm] = useState<RTMClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateIdentity, setDuplicateIdentity] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let acquired = false;

    /**
     * A reload can legitimately collide with its own previous connection: the
     * page is gone but Agora has not yet reaped the session. That resolves on
     * its own within a few seconds, so a duplicate error is retried before it
     * is believed. Only a collision that outlives the retries is a real
     * duplicate — a second tab — and worth showing the user.
     */
    const attempt = (remaining: number, delayMs: number): void => {
      acquireRtm(identity)
        .then((client) => {
          if (cancelled) {
            releaseRtm(identity);
            return;
          }
          acquired = true;
          setRtm(client);
        })
        .catch((err) => {
          if (cancelled) return;
          if (isDuplicateIdentityError(err) && remaining > 0) {
            setTimeout(() => {
              if (!cancelled) attempt(remaining - 1, delayMs);
            }, delayMs);
            return;
          }
          if (isDuplicateIdentityError(err)) {
            setDuplicateIdentity(true);
          } else {
            setError(
              err instanceof Error ? err.message : 'RTM connection failed',
            );
          }
        });
    };

    attempt(3, 1500);

    return () => {
      cancelled = true;
      // Only release what was actually acquired. Releasing after a failed
      // acquire would decrement a reference this mount never held.
      if (acquired) releaseRtm(identity);
    };
    // Identity fields rather than the object: a re-render that rebuilds the
    // object would otherwise tear down and re-establish a working connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.appId, identity.uid, identity.rtmToken, identity.channel]);

  /**
   * Keeps a departed participant from showing as present forever.
   *
   * Closing a tab is the only thing that used to clear a participant from
   * the roster — the explicit "Leave" button aside — because nothing told
   * the server about a refresh, a browser crash, or simply navigating away.
   * `pagehide` fires for all of those, so a leave beacon fires there
   * unconditionally; `resume` on mount undoes it for the one case that
   * beacon gets wrong, a refresh of the same tab, where the same
   * participantId reconnects rather than re-joining (see `storeIdentity`).
   * `sendBeacon`, not `fetch`: a normal request is not reliable once the
   * page has started tearing down.
   */
  useEffect(() => {
    void orchestrator.resume(identity.sessionId, identity.participantId);

    const onPageHide = () => {
      orchestrator.leaveBeacon(identity.sessionId, identity.participantId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [identity.sessionId, identity.participantId]);

  if (duplicateIdentity) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border p-4 text-sm"
        style={{
          borderColor: 'color-mix(in srgb, var(--eco-amber) 40%, transparent)',
          background: 'color-mix(in srgb, var(--eco-amber) 12%, var(--eco-ink-sunken))',
          color: 'var(--eco-cream)',
        }}>
        <p>
          This classroom identity is already connected somewhere else. That
          normally means you duplicated a tab — duplicating copies the stored
          identity, and Agora allows each participant to be connected once.
        </p>
        <p>
          Rejoin to get a fresh identity, or close the other tab. To open a
          second student, use a different browser profile or a private window
          rather than duplicating this one.
        </p>
        <button
          type="button"
          onClick={() => {
            clearIdentity();
            // Soft navigation is enough: unmounting runs the cleanup above,
            // which logs the uid out before the next join reuses the app ID.
            router.push('/join');
          }}
          className="rounded-md border px-3 py-1.5"
          style={{ borderColor: 'var(--eco-amber)', color: 'var(--eco-amber)' }}
        >
          Rejoin as someone else
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Could not connect to the classroom messaging channel: {error}
      </p>
    );
  }

  if (!rtm) {
    return (
      <p className="text-sm text-neutral-500">Connecting to the classroom…</p>
    );
  }

  return <AgoraProvider>{children(rtm)}</AgoraProvider>;
}
