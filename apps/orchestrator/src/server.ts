/**
 * Orchestrator entry point — PS31 §2 "Orchestration Backend".
 *
 * A long-lived process rather than serverless functions, for two concrete
 * reasons: the floor state machine needs a single authoritative writer per
 * classroom, and the `agora-agents` AgentSession object must stay in memory to
 * issue interrupt/speak/update calls against a running agent.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerErrorHandler } from './errors.js';
import { classroomRoutes } from './routes/classroom.js';
import { inspectRoutes } from './routes/inspect.js';
import { completionsRoutes } from './routes/completions.js';
import { considerSilenceInterjection } from './classroomController.js';
import { listSessions } from './state/sessionRegistry.js';
import { modelResolution, stopAllAgents } from './agent/agentLifecycle.js';

/**
 * How often the silence-gap check runs (§3.3b). Fast enough that a natural pause
 * is caught while it is still a pause, slow enough not to churn.
 */
const TICK_INTERVAL_MS = 1000;

const app = Fastify({
  bodyLimit: 100 * 1024 * 1024, // 100MB to support PDF, PPTX, and rich courseware uploads
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
});

await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
});

// Registered on the root instance, before the route plugins, so every route
// inherits it. Routes throw `ZodError` from `schema.parse(...)`; without this
// Fastify reported those as 500 and echoed the raw issue dump to the caller.
registerErrorHandler(app);

/**
 * `modelConfigured` is the raw LLM_MODEL env value; `modelResolved` is what the
 * agent actually runs. They differ whenever LLM_MODEL is not one of the models
 * Agora resells, because `resellerModel()` falls back to `gpt-4o-mini` without
 * saying so. Reporting only the raw value — as this endpoint used to — meant a
 * deployment could claim a model it was not running, which is how a fixed
 * model-specific bug could quietly come back. Both are reported, never one.
 */
app.get('/health', async () => {
  const model = modelResolution();
  return {
    ok: true,
    sessions: listSessions().length,
    llmVendor: model.vendor,
    modelConfigured: model.configured,
    modelResolved: model.resolved,
    modelSupported: model.supported,
    stt: config.sttLanguage,
  };
});

await app.register(classroomRoutes);
await app.register(inspectRoutes);
await app.register(completionsRoutes);

/**
 * The silence tick. Kept out of the request path because the condition it
 * watches for is the *absence* of activity — nothing else would wake it.
 */
const tick = setInterval(() => {
  for (const session of listSessions()) {
    if (session.endedAt !== null) continue;
    void considerSilenceInterjection(session).catch((error) => {
      app.log.warn({ err: error, sessionId: session.sessionId }, 'silence tick failed');
    });
  }
}, TICK_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  clearInterval(tick);
  // Agents left running in Agora would keep billing and occupy PCU slots.
  await stopAllAgents();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Surfaced at boot as well as on /health: an operator who mistypes LLM_MODEL
// never thinks to call /health, because as far as they know the model changed.
const startupModel = modelResolution();
if (!startupModel.supported) {
  app.log.warn(
    { configured: startupModel.configured, resolved: startupModel.resolved },
    `LLM_MODEL="${startupModel.configured}" is not a model Agora resells — ` +
      `falling back to "${startupModel.resolved}". The agent is NOT running the ` +
      `configured model. Supported: gpt-4o-mini, gpt-4.1-mini, gpt-5-nano, gpt-5-mini.`,
  );
} else {
  app.log.info(
    { vendor: startupModel.vendor, model: startupModel.resolved },
    'LLM model resolved',
  );
}

await app.listen({ port: config.port, host: config.host });
