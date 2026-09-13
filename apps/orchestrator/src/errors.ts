/**
 * One place that decides what a thrown error looks like on the wire.
 *
 * Routes validate with `schema.parse(...)`, which throws a `ZodError` carrying
 * no `statusCode`. Fastify's default handler therefore treated every malformed
 * request as a 500 and echoed `ZodError.message` — the full JSON issue dump —
 * straight to the caller. That is the wrong status (the client's request was
 * bad, not the server) and leaks internals.
 *
 * Split into a pure mapper plus a thin Fastify adapter so the mapping can be
 * tested without standing up a server.
 *
 * The response keeps the shape the rest of the API already uses: a
 * human-readable sentence in `error`, because that is the field
 * `apps/web/lib/orchestrator.ts` reads to build the message a user sees.
 */

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export interface ErrorResponse {
  status: number;
  body: { error: string; fields?: string[] };
  /** True when the server itself failed and the cause deserves a full log. */
  serverFault: boolean;
}

/**
 * `instanceof` alone is not enough: a workspace can resolve more than one copy
 * of zod, and an error thrown through a second copy fails the prototype check
 * while still being a ZodError in every way that matters here.
 */
function isZodError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

/** `["participantId"]`, or `["quiz", "options", "0"]` for a nested path. */
function fieldNames(error: ZodError): string[] {
  const seen = new Set<string>();
  for (const issue of error.issues ?? []) {
    const name = (issue.path ?? []).join('.');
    if (name.length > 0) seen.add(name);
  }
  return [...seen];
}

export function toErrorResponse(
  error: unknown,
  { isProduction }: { isProduction: boolean },
): ErrorResponse {
  if (isZodError(error)) {
    const fields = fieldNames(error);
    return {
      status: 400,
      serverFault: false,
      body: {
        error:
          fields.length > 0
            ? `Missing or invalid: ${fields.join(', ')}`
            : 'The request body or query string is not valid.',
        fields,
      },
    };
  }

  // Anything that already carries a client-error status said what it meant —
  // a 403 from a guard, a 409 from a rejected command — so pass it through.
  const status = (error as { statusCode?: unknown }).statusCode;
  const message = (error as { message?: unknown }).message;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return {
      status,
      serverFault: false,
      body: { error: typeof message === 'string' && message.length > 0 ? message : 'Request rejected.' },
    };
  }

  // A genuine server fault. The cause is logged in full; the caller gets a
  // generic sentence in production and the message (never a stack) in dev,
  // matching how server.ts already switches on NODE_ENV for the logger.
  return {
    status: typeof status === 'number' && status >= 500 ? status : 500,
    serverFault: true,
    body: {
      error:
        isProduction || typeof message !== 'string' || message.length === 0
          ? 'Something went wrong on the server.'
          : message,
    },
  };
}

/** Registers the mapper once, for every route on the instance. */
export function registerErrorHandler(app: FastifyInstance): void {
  const isProduction = process.env.NODE_ENV === 'production';

  app.setErrorHandler((error, request, reply) => {
    const mapped = toErrorResponse(error, { isProduction });

    if (mapped.serverFault) {
      request.log.error({ err: error, url: request.url }, 'unhandled error');
    } else {
      // Still worth a line: a client repeatedly sending malformed bodies is a
      // real signal, just not an alert.
      request.log.info(
        { url: request.url, fields: mapped.body.fields },
        'request rejected',
      );
    }

    return reply.code(mapped.status).send(mapped.body);
  });
}
