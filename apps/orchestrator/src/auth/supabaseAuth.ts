/**
 * Teacher authentication, verified against Supabase Auth.
 *
 * Supabase owns the credentials. This service never sees a password, never
 * issues a token, and holds no shared secret: it only checks that the bearer
 * token a browser presents was signed by the project's own key.
 *
 * That check is possible without a secret because this Supabase project uses
 * asymmetric signing keys (ES256). The public half is published at the
 * project's JWKS endpoint, so verification needs nothing confidential — which
 * is why no SUPABASE_JWT_SECRET or service-role key appears anywhere in this
 * codebase or its deployment config. If the project is ever switched back to
 * the legacy shared-secret (HS256) scheme, this module stops verifying and has
 * to be revisited; it will fail closed rather than accept anything.
 *
 * `jose` caches and re-fetches the key set on its own, including across key
 * rotation, so there is no cache to manage here.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export interface AuthenticatedTeacher {
  /** Supabase auth user id — the JWT `sub` claim. Stable for the account's life. */
  userId: string;
  email: string;
  displayName: string | null;
}

/**
 * Lazily built so a deployment with no SUPABASE_URL never reaches for the
 * network, and so the endpoint is resolved once rather than per request.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function keySet(): ReturnType<typeof createRemoteJWKSet> | null {
  if (!config.supabaseUrl) return null;
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`),
    );
  }
  return jwks;
}

/** True when the deployment is configured to be able to verify tokens at all. */
export function authConfigured(): boolean {
  return Boolean(config.supabaseUrl);
}

function readBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function teacherFromPayload(payload: JWTPayload): AuthenticatedTeacher | null {
  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  if (!userId) return null;

  // Supabase puts the address at the top level and mirrors it, along with
  // anything set at signup, into user_metadata.
  const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const email =
    (typeof payload.email === 'string' && payload.email) ||
    (typeof metadata.email === 'string' && metadata.email) ||
    null;
  if (!email) return null;

  const displayName =
    (typeof metadata.display_name === 'string' && metadata.display_name) ||
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    null;

  return { userId, email, displayName };
}

/**
 * Verifies a request's bearer token.
 *
 * Returns null for every failure — absent, malformed, expired, wrong issuer,
 * bad signature — deliberately without distinguishing them to the caller. A
 * client cannot act differently on "expired" than on "forged" (both mean sign
 * in again), and reporting which one it was tells an attacker whether a token
 * was structurally valid.
 */
export async function authenticate(
  request: FastifyRequest,
): Promise<AuthenticatedTeacher | null> {
  const keys = keySet();
  if (!keys) return null;

  const token = readBearer(request);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`,
      audience: 'authenticated',
    });
    return teacherFromPayload(payload);
  } catch {
    return null;
  }
}

/**
 * Gate for routes that must belong to a signed-in teacher.
 *
 * Honours `AUTH_REQUIRED`. With it off — the default, and what the currently
 * deployed app runs — an unauthenticated request is allowed through with a null
 * teacher, so adding this gate to a route changes nothing until the flag is
 * turned on. With it on, an unauthenticated request is refused here and the
 * caller should stop.
 *
 * Returns `{ ok: false }` when it has already sent the 401; the caller must
 * return immediately without sending its own reply.
 */
export async function requireTeacher(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ ok: true; teacher: AuthenticatedTeacher | null } | { ok: false }> {
  const teacher = await authenticate(request);
  if (teacher) return { ok: true, teacher };

  if (!config.authRequired) return { ok: true, teacher: null };

  // Distinguishes "this deployment wants auth but was never given a Supabase
  // project" from "your token is no good" — the first is an operator error that
  // would otherwise present as every teacher being locked out for no reason.
  if (!authConfigured()) {
    request.log.error(
      'AUTH_REQUIRED is set but SUPABASE_URL is not — refusing rather than letting everyone in.',
    );
  }

  await reply
    .code(401)
    .send({ error: 'Sign in as a teacher to do this.', code: 'AUTH_REQUIRED' });
  return { ok: false };
}
