/**
 * Outbound email with a provider fallback chain.
 *
 * The absent-student dispatch used to call Resend inline and swallow whatever
 * came back, which is why delivery looked intermittent: a 403 (sandbox sender
 * refusing a non-owner recipient) or a 429 (free-tier rate limit) produced the
 * exact same "success" in the UI as a real send. This module fixes both halves
 * of that — it retries the transient failures, and it always reports what
 * actually happened so callers can surface it.
 *
 * Providers are tried in order:
 *   1. Resend, when RESEND_API_KEY is set.
 *   2. SMTP via nodemailer, when SMTP_HOST/SMTP_USER/SMTP_PASS are set.
 *
 * Both are optional. With neither configured `sendMail` returns
 * `{ ok: false, reason: 'not_configured' }` rather than throwing, matching the
 * graceful-degradation posture of the other optional integrations here.
 */

import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

export interface SendMailInput {
  to: string[];
  subject: string;
  html: string;
}

export interface SendMailResult {
  ok: boolean;
  /** Which provider actually accepted the message. */
  provider?: 'resend' | 'smtp';
  /** Provider message id, when one was returned. */
  messageId?: string;
  /** Human-readable failure cause, present only when `ok` is false. */
  error?: string;
  reason?: 'not_configured' | 'send_failed';
}

/** Retry only the failures that are plausibly transient. */
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (err as { status?: number } | null)?.status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true;
  return /rate.?limit|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up/i.test(msg);
}

const RETRY_DELAYS_MS = [500, 1500];

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === RETRY_DELAYS_MS.length || !isRetryable(err)) break;
      const delay = RETRY_DELAYS_MS[attempt]!;
      console.warn(`[mailer] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms:`, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

let smtpTransport: Transporter | null = null;

function getSmtpTransport(): Transporter | null {
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) return null;
  smtpTransport ??= nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    // 465 is implicit TLS; every other port negotiates STARTTLS instead.
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
  return smtpTransport;
}

async function sendViaResend(input: SendMailInput): Promise<SendMailResult> {
  const resend = new Resend(config.resendApiKey);
  return withRetry('resend', async () => {
    const { data, error } = await resend.emails.send({
      from: config.mailFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    // The SDK reports API-level rejections in `error` rather than throwing, so
    // rethrow to let the retry/fallback logic above see them.
    if (error) throw Object.assign(new Error(error.message), { statusCode: (error as { statusCode?: number }).statusCode });
    return { ok: true, provider: 'resend' as const, messageId: data?.id };
  });
}

async function sendViaSmtp(transport: Transporter, input: SendMailInput): Promise<SendMailResult> {
  return withRetry('smtp', async () => {
    const info = await transport.sendMail({
      from: config.smtpFrom ?? config.mailFrom,
      to: input.to.join(', '),
      subject: input.subject,
      html: input.html,
    });
    return { ok: true, provider: 'smtp' as const, messageId: info.messageId };
  });
}

/** True when at least one provider is configured. */
export function mailerConfigured(): boolean {
  return Boolean(config.resendApiKey) || getSmtpTransport() !== null;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const recipients = input.to.map((t) => t.trim()).filter(Boolean);
  if (recipients.length === 0) {
    return { ok: false, reason: 'send_failed', error: 'No recipient address provided.' };
  }
  const payload = { ...input, to: recipients };

  const errors: string[] = [];

  if (config.resendApiKey) {
    try {
      return await sendViaResend(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[mailer] Resend send failed:', err);
      errors.push(`Resend: ${msg}`);
    }
  }

  const transport = getSmtpTransport();
  if (transport) {
    try {
      return await sendViaSmtp(transport, payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[mailer] SMTP send failed:', err);
      errors.push(`SMTP: ${msg}`);
    }
  }

  if (errors.length === 0) {
    console.warn('[mailer] No email provider configured — set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS.');
    return {
      ok: false,
      reason: 'not_configured',
      error: 'No email provider configured (set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS).',
    };
  }

  return { ok: false, reason: 'send_failed', error: errors.join(' | ') };
}
