/**
 * Local proxy for the mailer: stands up a throwaway SMTP server on localhost,
 * points the SMTP fallback at it, and drives dispatchAbsentPacket with Resend
 * deliberately misconfigured. Proves the fallback fires, the recipient comes
 * from the payload, and failures are reported rather than swallowed.
 */
import { SMTPServer } from 'smtp-server';

const received: { to: string[]; raw: string }[] = [];

const server = new SMTPServer({
  authOptional: true,
  // The bundled self-signed cert is expired, so keep this loopback server on
  // plaintext rather than having nodemailer reject the STARTTLS upgrade.
  hideSTARTTLS: true,
  onAuth(_auth, _session, cb) {
    cb(null, { user: 'probe' });
  },
  onData(stream, session, cb) {
    let raw = '';
    stream.on('data', (c) => (raw += c.toString()));
    stream.on('end', () => {
      received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
      cb();
    });
  },
});

await new Promise<void>((r) => server.listen(2525, '127.0.0.1', r));

process.env.RESEND_API_KEY = 're_invalid_key_for_probe';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '2525';
process.env.SMTP_USER = 'probe';
process.env.SMTP_PASS = 'probe';
process.env.MAIL_FROM = 'Athena AI <athena@example.test>';

const { dispatchAbsentPacket } = await import('../src/support/absentPacket.ts');
const { createSession } = await import('../src/state/sessionRegistry.ts');

const session = createSession('Adding Unlike Fractions');

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. Resend fails (bad key) → SMTP fallback delivers to the typed recipient.
const r1 = await dispatchAbsentPacket(session, {
  sessionId: session.sessionId,
  studentName: 'Probe Student',
  recipientEmail: 'typed-parent@example.test',
  channel: 'email',
  includeQuiz: true,
  includeTranscript: true,
});
check('falls back to SMTP when Resend fails', r1.emailSent === true, `provider=${r1.emailProvider} err=${r1.emailError}`);
check('delivered to the typed recipient', received.at(-1)?.to.join() === 'typed-parent@example.test', received.at(-1)?.to.join());

// 2. No recipientEmail → falls back to the hardcoded parent address.
await dispatchAbsentPacket(session, {
  sessionId: session.sessionId,
  channel: 'email',
  includeQuiz: true,
  includeTranscript: true,
});
check('uses fallback parent when no email typed', received.at(-1)?.to.join() === 'himanihassija@gmail.com', received.at(-1)?.to.join());

// 3. Both providers down → ok:false with a real error, WhatsApp link intact.
server.close();
await new Promise((r) => setTimeout(r, 200));
const r3 = await dispatchAbsentPacket(session, {
  sessionId: session.sessionId,
  recipientEmail: 'typed-parent@example.test',
  recipientPhone: '+919999999999',
  channel: 'both',
  includeQuiz: true,
  includeTranscript: true,
});
check('reports failure instead of silent success', r3.emailSent === false && !!r3.emailError, r3.emailError?.slice(0, 120));
check('whatsapp link still returned on email failure', r3.whatsappDeepLink.includes('919999999999'));
check('email count is exactly 2 (no phantom sends)', received.length === 2, String(received.length));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
