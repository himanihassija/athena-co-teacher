/**
 * Classroom HTTP surface.
 *
 * Route groups map to the plan's feature sections:
 *   sessions / join / events  -> §3.1, §3.2, §3.8
 *   transcript                -> §3.4, §3.9
 *   command                   -> §3.10
 *   lesson                    -> §3.4
 *   quiz                      -> §3.6
 *   gaps / report             -> §3.9
 *
 * Authorisation is deliberately thin (a participantId identifies the caller),
 * matching the plan's "lightweight join screen is enough for a hackathon demo".
 * The one rule enforced everywhere is that teacher-only routes check the role
 * from the session registry rather than trusting the request.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ClassroomEvent, RoomState } from '@echosphere/shared-types';
import {
  applyTeacherCommand,
  broadcastParticipantJoined,
  grantSpeakPermit,
  handleAgentState,
  ingestTranscript,
  startQuiz,
  submitQuizAnswer,
  releaseIllustrationState,
} from '../classroomController.js';
import {
  agentStatus,
  pushInstructions,
  startAgent,
  stopAgent,
} from '../agent/agentLifecycle.js';
import { rankedGaps } from '../gaps/gapDetector.js';
import { requireTeacher } from '../auth/supabaseAuth.js';
import { generateReport } from '../report/summary.js';
import { persistSessionEnd } from '../report/persist.js';
import { closeRoom, publish, publishToTeachers, subscribe } from '../state/eventBus.js';
import { answerCatchup, catchupHistory } from '../catchup/answer.js';
import {
  broadcastWhiteboard,
  mergeSceneElements,
  mergeSceneFiles,
  joinPayload,
  openWhiteboard,
  publicWhiteboard,
} from '../whiteboard/boardSession.js';
import {
  getWorkspaceState,
  addStickyNote,
  updateStickyNote,
  voteStickyNote,
  resolveStickyNote,
  deleteStickyNote,
} from '../workspace/workspaceManager.js';
import { generateAbsentStudentPacket, dispatchAbsentPacket } from '../support/absentPacket.js';
import {
  getTargetedReadings,
  approveReading,
  rejectReading,
} from '../support/targetedReading.js';
import { getCatchupSlots, bookCatchupSlot, addCustomSlot, cancelCatchupSlot } from '../support/catchupSlots.js';
import { handleTeachingAssistantRequest } from '../support/teachingAssistant.js';
import { translateText } from '../support/multilingual.js';
import {
  getLibraryBook,
  getAllBooks,
  getSessionBooks,
  addBookToSession,
  removeBookFromSession,
  findPageInBook,
} from '../support/digitalLibrary.js';
import { think } from '../agent/agentLifecycle.js';
import {
  activeParticipants,
  addParticipant,
  AGENT_UID,
  createSession,
  endSession,
  getSession,
  isTeacher,
  listSessions,
  removeParticipant,
  resumeParticipant,
  toPublicParticipant,
  type ClassroomSession,
} from '../state/sessionRegistry.js';
import { mintTokens } from './tokens.js';
import { anamConfigured, mintAnamSessionToken } from '../agent/anam.js';
import { presentModel, stopModel } from '../models/modelSession.js';
import { config } from '../config.js';
import {
  UNLIKE_FRACTIONS_TITLE,
  seedUnlikeFractionsLesson,
} from '../lesson/demoUnlikeFractions.js';

const joinSchema = z.object({
  displayName: z.string().min(1).max(60),
  role: z.enum(['teacher', 'student']),
  preferredLanguage: z.string().max(20).optional(),
});

const transcriptSchema = z.object({
  uid: z.string(),
  text: z.string(),
  isFinal: z.boolean().default(true),
  turnId: z.coerce.number().optional(),
  language: z.string().optional(),
  attributionConfidence: z.number().min(0).max(1).optional(),
});

const commandSchema = z.object({
  participantId: z.string(),
  command: z.discriminatedUnion('type', [
    z.object({ type: z.literal('MUTE_AGENT') }),
    z.object({ type: z.literal('RESUME_AGENT') }),
    z.object({ type: z.literal('END_AGENT_TURN') }),
    z.object({
      type: z.literal('FORCE_AGENT_SPEAK'),
      topic: z.string(),
      targetStudentId: z.string().optional(),
    }),
    z.object({
      type: z.literal('ADJUST_VERBOSITY'),
      level: z.enum(['terse', 'normal', 'detailed']),
    }),
    z.object({
      type: z.literal('SET_STUDENT_INVOCATION'),
      enabled: z.boolean(),
    }),
    z.object({ type: z.literal('DISABLE_TOPIC'), topic: z.string() }),
    z.object({ type: z.literal('ENABLE_TOPIC'), topic: z.string() }),
    z.object({
      type: z.literal('SET_PROFICIENCY'),
      studentId: z.string(),
      proficiency: z.enum(['beginner', 'intermediate', 'advanced']),
    }),
    z.object({
      type: z.literal('START_QUIZ'),
      topic: z.string(),
      targetStudentIds: z.array(z.string()).optional(),
    }),
    z.object({ type: z.literal('END_SESSION') }),
  ]),
});

export async function classroomRoutes(app: FastifyInstance): Promise<void> {
  // ── Sessions (§3.1) ───────────────────────────────────────────────────────

  app.post('/api/sessions', async (request, reply) => {
    // Creating a lesson is the one action that establishes ownership, so it is
    // where the teacher's token is checked. With AUTH_REQUIRED off this still
    // reads the token when one is present — an authenticated teacher gets an
    // owned lesson, an anonymous one gets an unowned lesson exactly as before.
    const auth = await requireTeacher(request, reply);
    if (!auth.ok) return;

    const body = z
      .object({
        title: z.string().min(1).max(140).optional(),
        seed: z.enum(['unlike-fractions']).optional(),
      })
      .parse(request.body ?? {});
    const title =
      body.title ??
      (body.seed === 'unlike-fractions'
        ? UNLIKE_FRACTIONS_TITLE
        : 'Untitled lesson');
    const session = createSession(title, auth.teacher);
    if (body.seed === 'unlike-fractions') {
      seedUnlikeFractionsLesson(session.lesson);
    }
    return reply.code(201).send(publicSession(session));
  });

  app.get('/api/sessions', async () =>
    listSessions().map(publicSession),
  );

  app.get('/api/sessions/:sessionId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(roomState(session));
  });

  // ── Join (§3.2, §3.8) ─────────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/join', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (session.endedAt !== null) {
      return reply.code(409).send({ error: 'This session has already ended' });
    }

    const body = joinSchema.parse(request.body);

    if (body.role === 'teacher') {
      const existingTeacher = activeParticipants(session).find(
        (p) => p.role === 'teacher',
      );
      if (existingTeacher) {
        return reply
          .code(409)
          .send({ error: 'This classroom already has a teacher' });
      }
    }

    const participant = addParticipant(session, body);
    const tokens = mintTokens(session.channel, participant.uid);

    broadcastParticipantJoined(session, participant.participantId);

    return reply.code(201).send({
      participantId: participant.participantId,
      uid: participant.uid,
      channel: session.channel,
      rtcToken: tokens.rtcToken,
      rtmToken: tokens.rtmToken,
      appId: config.agoraAppId,
      agentUid: AGENT_UID,
      role: participant.role,
      sessionId: session.sessionId,
    });
  });

  app.post('/api/sessions/:sessionId/leave', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.body);
    removeParticipant(session, participantId);
    publish(session.sessionId, {
      kind: 'echosphere:participant-left',
      participantId,
    });
    return reply.send({ ok: true });
  });

  /**
   * Undoes a leave that should not have stuck.
   *
   * The browser cannot tell a tab closing for good from a page refresh, so
   * the client sends a leave beacon on both — without this, closing a tab
   * was the only thing that ever cleared a participant, and anyone who
   * instead just refreshed, or navigated away and back without an explicit
   * "Leave" click, kept showing as present in every other participant's
   * roster and transcript attribution indefinitely, because nothing ever
   * told the server they had not really gone.
   *
   * Called on every mount, not only ones the client can prove followed a
   * refresh — `resumeParticipant` is a no-op for a participant who was never
   * marked left, so this is safe unconditionally.
   */
  app.post('/api/sessions/:sessionId/resume', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.body);
    if (!resumeParticipant(session, participantId)) {
      return reply.code(404).send({ error: 'Unknown participant' });
    }
    broadcastParticipantJoined(session, participantId);
    return reply.send({ ok: true });
  });

  // ── Agent lifecycle (§3.1) ────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/agent/start', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.body);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can start the agent' });
    }

    try {
      const agentId = await startAgent(session);
      session.agentId = agentId;
      // The greeting is spoken the moment the agent joins, and it exists
      // because the teacher asked for the agent. Without a permit the
      // enforcement path treats it as an uninvited turn and cuts it off after
      // the first two words.
      grantSpeakPermit(session, 'TEACHER_INVOKED');
      await openWhiteboard(session);
      publish(session.sessionId, { kind: 'echosphere:room-state', state: roomState(session) });
      return reply.send({ agentId, state: 'RUNNING' });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to start agent');
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : 'Failed to start agent' });
    }
  });

  app.post('/api/sessions/:sessionId/agent/stop', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    await stopAgent(session.sessionId);
    session.agentId = null;
    publish(session.sessionId, { kind: 'echosphere:room-state', state: roomState(session) });
    return reply.send({ ok: true });
  });

  // ── Anam avatar (silent video overlay) ────────────────────────────────────
  //
  // Any participant may fetch a token — it only drives what they see on
  // their own screen, not the shared session state, so this doesn't need the
  // teacher-only guard that agent/start has.
  app.post('/api/sessions/:sessionId/anam-token', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    if (!anamConfigured()) {
      return reply
        .code(501)
        .send({ error: 'Anam is not configured on this deployment' });
    }

    try {
      const sessionToken = await mintAnamSessionToken();
      return reply.send({ sessionToken });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to mint Anam session token');
      return reply.code(502).send({
        error:
          error instanceof Error ? error.message : 'Failed to mint Anam session token',
      });
    }
  });

  app.get('/api/sessions/:sessionId/agent', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send((await agentStatus(session.sessionId)) ?? { agentId: null, status: 'idle' });
  });

    // ── 3D model presentation ──────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/model/present', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, modelId } = z
      .object({ participantId: z.string(), modelId: z.string().nullable() })
      .parse(request.body);

    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can present a 3D model' });
    }
    const participant = session.participants.get(participantId);
    if (!participant) return reply.code(403).send({ error: 'Unknown participant' });

    if (modelId) {
      presentModel(session, participantId, participant.displayName, modelId);
    } else {
      stopModel(session, participantId);
    }
    return reply.send({ ok: true, activeModel: session.activeModel });
  });
  app.post('/api/sessions/:sessionId/whiteboard/present', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, presenting } = z
      .object({ participantId: z.string(), presenting: z.boolean() })
      .parse(request.body);
    // Drawing is teacher-and-Athena only; students watch. Enforced here rather
    // than by hiding the button, so a crafted request cannot draw either.
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can present the whiteboard' });
    }
    const participant = session.participants.get(participantId);
    if (!participant) return reply.code(403).send({ error: 'Unknown participant' });

    if (presenting) {
      session.whiteboard.presenting = {
        participantId,
        displayName: participant.displayName,
      };
      session.whiteboard.open = true;
      publish(session.sessionId, {
        kind: 'echosphere:whiteboard-started',
        presenter: session.whiteboard.presenting,
      });
    } else {
      session.whiteboard.presenting = null;
      publish(session.sessionId, {
        kind: 'echosphere:whiteboard-stopped',
        participantId,
      });
    }
    broadcastWhiteboard(session);
    return reply.send({ ok: true, presenting: session.whiteboard.presenting });
  });

  app.post(
    '/api/sessions/:sessionId/whiteboard/scene',
    {
      /**
       * An inserted photo travels on this route as base64 in a data URL, so the
       * 1 MiB Fastify default rejects an ordinary phone picture outright. Raised
       * here rather than on the whole server: no other route needs to accept a
       * body this size, and `mergeSceneFiles` caps what is actually retained.
       */
      bodyLimit: 12 * 1024 * 1024,
    },
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { participantId, elements, files } = z
        .object({
          participantId: z.string(),
          // Excalidraw owns the element shape and changes it between versions, so
          // it is passed through rather than modelled. Only id and version are
          // read, and the cap keeps one client from posting an unbounded scene.
          elements: z
            .array(z.object({ id: z.string(), version: z.number() }).passthrough())
            .max(5000),
          // The bytes behind any `image` element in that batch. Sent once per
          // file, not per tick, so this is normally absent.
          files: z
            .array(
              z.object({
                id: z.string(),
                dataURL: z.string(),
                mimeType: z.string(),
                created: z.number(),
              }),
            )
            .max(50)
            .optional(),
        })
        .parse(request.body);
      if (!isTeacher(session, participantId)) {
        return reply.code(403).send({ error: 'Only the teacher can draw' });
      }

      mergeSceneElements(session, elements);
      // Only the genuinely new ones go back out; re-broadcasting a photo every
      // time its element moved would put megabytes on the bus per drag.
      const addedFiles = mergeSceneFiles(session, files ?? []);
      publish(session.sessionId, {
        kind: 'echosphere:whiteboard-scene',
        elements,
        ...(addedFiles.length > 0 ? { files: addedFiles } : {}),
        by: participantId,
      });
      return reply.send({ ok: true, count: session.whiteboard.scene.length });
    },
  );

  app.get('/api/sessions/:sessionId/whiteboard', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    const participant = session.participants.get(participantId);
    if (!participant || participant.leftAt !== undefined) {
      return reply.code(403).send({ error: 'Unknown participant' });
    }
    return reply.send(
      await joinPayload(session, participant.uid, participant.role === 'teacher'),
    );
  });

  app.post('/api/sessions/:sessionId/catchup', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, text } = z
      .object({
        participantId: z.string(),
        text: z.string().min(1).max(800),
      })
      .parse(request.body);
    try {
      const result = await answerCatchup(session, participantId, text);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Catch-up failed';
      const code = message === 'Catch-up chat is for students' ? 403 : 400;
      if (message === 'Unknown participant') {
        return reply.code(403).send({ error: message });
      }
      return reply.code(code).send({ error: message });
    }
  });

  app.get('/api/sessions/:sessionId/catchup', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    const participant = session.participants.get(participantId);
    if (!participant || participant.leftAt !== undefined) {
      return reply.code(403).send({ error: 'Unknown participant' });
    }
    // Any role may read its own thread. This used to refuse anything but a
    // student, which left the teacher's panel writing a thread it could never
    // load: POST stores the teacher's turns and returns them, so the
    // conversation looked fine until the panel was reopened — at which point
    // the refusal landed in the client's catch handler and reset the view to
    // the greeting, discarding a thread the server still had.
    return reply.send({ history: catchupHistory(session, participantId) });
  });

  // ── Control path: SSE (§2) ────────────────────────────────────────────────

  app.get('/api/sessions/:sessionId/events', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    const participant = session.participants.get(participantId);
    if (!participant) {
      return reply.code(403).send({ error: 'Unknown participant' });
    }

    if (participant.leftAt) {
      delete participant.leftAt;
      broadcastParticipantJoined(session, participant.participantId);
    }

    // Writing to `reply.raw` bypasses the Fastify reply object, and with it the
    // headers @fastify/cors would have attached — so an EventSource is refused
    // by the browser while every ordinary route on the same server works. The
    // CORS headers have to be set explicitly here.
    const origin = request.headers.origin;
    const allowedOrigin =
      origin && config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0];

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx and similar proxies buffer by default, which would batch the
      // control path into useless bursts.
      'X-Accel-Buffering': 'no',
      ...(allowedOrigin
        ? {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Credentials': 'true',
            Vary: 'Origin',
          }
        : {}),
    });

    const send = (event: ClassroomEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = subscribe(session.sessionId, {
      subscriberId: `${participantId}-${Date.now()}`,
      participantId,
      role: participant.role,
      send,
      close: () => reply.raw.end(),
    });

    // The joining client needs the whole room, not just future deltas.
    send({ kind: 'echosphere:room-state', state: roomState(session) });

    // Proxies drop idle connections; a comment line keeps it warm without
    // appearing as an event to the client.
    const heartbeat = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 20_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return reply;
  });

  // ── Transcript ingestion (§3.4, §3.8, §3.9) ───────────────────────────────

  app.post('/api/sessions/:sessionId/transcript', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = transcriptSchema.parse(request.body);
    await ingestTranscript(session, body);
    return reply.send({ ok: true });
  });

  app.get('/api/sessions/:sessionId/transcript', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(session.transcript);
  });

  /**
   * The engine's own state, relayed from the browser (§3.3 enforcement).
   *
   * ConvoAI decides to answer without consulting anyone, so this is the only
   * moment the orchestrator learns a turn has begun. If that turn has no
   * permit, it is interrupted here.
   */
  app.post('/api/sessions/:sessionId/agent-state', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { state } = z.object({ state: z.string() }).parse(request.body);
    const result = await handleAgentState(session, state);
    return reply.send(result);
  });

  // ── Teacher commands (§3.10) ──────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/command', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, command } = commandSchema.parse(request.body);

    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can issue commands' });
    }

    if (command.type === 'END_SESSION') {
      await stopAgent(session.sessionId);
      endSession(session.sessionId);
      releaseIllustrationState(session.sessionId);
      publish(session.sessionId, {
        kind: 'echosphere:session-ended',
        sessionId: session.sessionId,
      });
      // Fire-and-forget: a database hiccup (or no DATABASE_URL at all) must
      // not stop the teacher's "end lesson" action from completing.
      void persistSessionEnd(session).catch((err) =>
        app.log.error({ err }, 'failed to persist session on END_SESSION'),
      );
      return reply.send({ ok: true });
    }

    const result = await applyTeacherCommand(session, command, participantId);
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  // ── Lesson material (§3.4) ────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/lesson', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        participantId: z.string(),
        source: z.string().min(1).max(200),
        text: z.string().min(1),
        topics: z.array(z.string()).optional(),
      })
      .parse(request.body);

    if (!isTeacher(session, body.participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can upload lesson material' });
    }

    const chunks = session.lesson.addDocument(body.source, body.text, body.topics);
    // The material lives in the agent's system prompt, so it has no effect
    // until the prompt is re-pushed.
    const applied = await pushInstructions(session);
    return reply.code(201).send({
      source: body.source,
      chunks: chunks.length,
      appliedToAgent: applied,
      topics: session.lesson.topics(),
    });
  });

  app.get('/api/sessions/:sessionId/lesson', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send({
      chunks: session.lesson.chunks.length,
      topics: session.lesson.topics(),
      sources: [...new Set(session.lesson.chunks.map((c) => c.source))],
    });
  });

  // ── Quizzes (§3.6) ────────────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/quiz', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        participantId: z.string(),
        topic: z.string().min(1),
        targetStudentIds: z.array(z.string()).optional(),
      })
      .parse(request.body);

    if (!isTeacher(session, body.participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can start a quiz' });
    }

    const result = await startQuiz(session, body.topic, body.targetStudentIds, 'teacher');
    return reply.code(result.ok ? 201 : 409).send(result);
  });

  app.post('/api/sessions/:sessionId/quiz/:quizId/answer', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { quizId } = request.params as { quizId: string };
    const body = z
      .object({
        participantId: z.string(),
        answer: z.string(),
        via: z.enum(['ui', 'voice']).default('ui'),
      })
      .parse(request.body);

    const result = submitQuizAnswer(
      session,
      quizId,
      body.participantId,
      body.answer,
      body.via,
    );
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  // ── Gaps and report (§3.9) ────────────────────────────────────────────────

  app.get('/api/sessions/:sessionId/gaps', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Gap data is teacher-only' });
    }
    return reply.send(rankedGaps(session));
  });

  // ─── Workspace & Sticky Notes (Live Miro Integration) ─────────────────────

  app.get('/api/sessions/:sessionId/workspace', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(getWorkspaceState(session));
  });

  app.post('/api/sessions/:sessionId/workspace/notes', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        topic: z.string().default(''),
        content: z.string().min(1),
        suggestedAnswer: z.string().optional(),
        category: z
          .enum(['held-back-doubt', 'student-question', 'core-concept', 'teacher-insight', 'key-takeaway'])
          .optional(),
        color: z.enum(['yellow', 'coral', 'cyan', 'purple', 'green', 'amber']).optional(),
        authorName: z.string().optional(),
        authorRole: z.enum(['athena', 'teacher', 'student']).optional(),
        authorParticipantId: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .parse(request.body);

    const note = addStickyNote(session, body);
    return reply.code(201).send(note);
  });

  app.patch('/api/sessions/:sessionId/workspace/notes/:noteId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const patch = request.body as Record<string, unknown>;
    const updated = updateStickyNote(session, noteId, patch);
    if (!updated) return reply.code(404).send({ error: 'Sticky note not found' });
    return reply.send(updated);
  });

  app.post('/api/sessions/:sessionId/workspace/notes/:noteId/vote', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const { participantId } = z.object({ participantId: z.string() }).parse(request.body);
    const updated = voteStickyNote(session, noteId, participantId);
    if (!updated) return reply.code(404).send({ error: 'Sticky note not found' });
    return reply.send(updated);
  });

  app.post('/api/sessions/:sessionId/workspace/notes/:noteId/resolve', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const { status } = z
      .object({ status: z.enum(['pending', 'addressed', 'resolved', 'archived']) })
      .parse(request.body);
    const updated = resolveStickyNote(session, noteId, status);
    if (!updated) return reply.code(404).send({ error: 'Sticky note not found' });
    return reply.send(updated);
  });

  app.delete('/api/sessions/:sessionId/workspace/notes/:noteId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const deleted = deleteStickyNote(session, noteId);
    return reply.send({ ok: deleted });
  });

  app.post('/api/sessions/:sessionId/workspace/notes/:noteId/explain', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const ws = getWorkspaceState(session);
    const note = ws.notes.find((n) => n.id === noteId);
    if (!note) return reply.code(404).send({ error: 'Sticky note not found' });

    // Instruct Athena to address this note out loud to the class
    grantSpeakPermit(session, 'TEACHER_INVOKED');
    const promptDirective = `The class wants to address a question from the shared board: "${note.content}". Please give a 2-3 sentence clear, encouraging explanation and invite a student to verify.`;
    void think(session.sessionId, promptDirective);

    // Mark as addressed
    resolveStickyNote(session, noteId, 'addressed');
    return reply.send({ ok: true, note });
  });

  // ─── Nobody Left Behind: Absent Student Packet ─────────────────────────────

  app.get('/api/sessions/:sessionId/absent-packet', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const packet = await generateAbsentStudentPacket(session);
    return reply.send(packet);
  });

  app.post('/api/sessions/:sessionId/absent-packet/dispatch', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        sessionId: z.string(),
        studentName: z.string().optional(),
        recipientEmail: z.string().optional(),
        recipientPhone: z.string().optional(),
        channel: z.enum(['email', 'whatsapp', 'both']).default('whatsapp'),
        includeQuiz: z.boolean().default(true),
        includeTranscript: z.boolean().default(true),
        parentNote: z.string().optional(),
      })
      .parse(request.body);

    const result = await dispatchAbsentPacket(session, body);
    return reply.send(result);
  });

  // ─── Nobody Left Behind: Socratic AI Teaching Assistant for Weaker Students ──

  app.post('/api/sessions/:sessionId/teaching-assistant/help', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        sessionId: z.string(),
        studentId: z.string(),
        studentName: z.string(),
        question: z.string(),
        mode: z.enum(['step_by_step', 'socratic_hint', 'concept_simplify', 'practice_problem']).optional(),
        struggleTopic: z.string().optional(),
        hintLevel: z.number().min(1).max(3).optional(),
      })
      .parse(request.body);

    const response = await handleTeachingAssistantRequest(session, body);
    return reply.send(response);
  });

  // ─── Nobody Left Behind: Targeted Reading (Teacher-Approved) ───────────────

  app.get('/api/sessions/:sessionId/targeted-readings', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(getTargetedReadings(session));
  });

  app.post('/api/sessions/:sessionId/targeted-readings/:readingId/approve', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { readingId } = request.params as { readingId: string };
    const { participantId } = z.object({ participantId: z.string() }).parse(request.body);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only teachers can approve reading recommendations' });
    }
    const teacher = session.participants.get(participantId);
    const approved = approveReading(session, readingId, teacher?.displayName ?? 'Teacher');
    if (!approved) return reply.code(404).send({ error: 'Reading recommendation not found' });
    return reply.send(approved);
  });

  app.post('/api/sessions/:sessionId/targeted-readings/:readingId/reject', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { readingId } = request.params as { readingId: string };
    const { participantId } = z.object({ participantId: z.string() }).parse(request.body);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only teachers can reject reading recommendations' });
    }
    const ok = rejectReading(session, readingId);
    return reply.send({ ok });
  });

  // ─── Nobody Left Behind: Catch-up Sessions from Real Availability ──────────

  app.get('/api/sessions/:sessionId/catchup-slots', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(getCatchupSlots(session));
  });

  app.post('/api/sessions/:sessionId/catchup-slots/book', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        slotId: z.string(),
        studentId: z.string(),
        studentName: z.string(),
        topic: z.string(),
        notes: z.string().optional(),
        language: z.enum(['en', 'hi', 'es', 'fr', 'de', 'ta', 'te']).default('en'),
      })
      .parse(request.body);

    try {
      const booked = bookCatchupSlot(session, body);
      return reply.send(booked);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/sessions/:sessionId/catchup-slots/create', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        date: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        teacherName: z.string().optional(),
      })
      .parse(request.body);

    const slot = addCustomSlot(session, body);
    return reply.send(slot);
  });

  app.post('/api/sessions/:sessionId/catchup-slots/:slotId/cancel', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { slotId } = request.params as { slotId: string };
    try {
      const canceled = cancelCatchupSlot(session, slotId);
      return reply.send(canceled);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ─── Hand-Raise Control Plane Signal ───────────────────────────────────────

  app.post('/api/sessions/:sessionId/hand-raise', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, raised } = z
      .object({ participantId: z.string(), raised: z.boolean() })
      .parse(request.body);

    const participant = session.participants.get(participantId);
    if (!participant) return reply.code(404).send({ error: 'Participant not found' });

    participant.handRaised = raised;
    if (raised) {
      session.raisedHands.add(participantId);
      publish(session.sessionId, {
        kind: 'echosphere:hand-raised',
        participantId,
        displayName: participant.displayName,
        at: Date.now(),
      });
    } else {
      session.raisedHands.delete(participantId);
      publish(session.sessionId, {
        kind: 'echosphere:hand-lowered',
        participantId,
      });
    }

    return reply.send({ ok: true, raisedHands: Array.from(session.raisedHands) });
  });
    // ─── Screen Share Permission (teacher grants/revokes per student) ────────

  app.post('/api/sessions/:sessionId/screen-share-permission', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, targetParticipantId, allowed } = z
      .object({
        participantId: z.string(),
        targetParticipantId: z.string(),
        allowed: z.boolean(),
      })
      .parse(request.body);

    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can grant screen-share permission' });
    }

    const target = session.participants.get(targetParticipantId);
    if (!target) return reply.code(404).send({ error: 'Participant not found' });

    if (allowed) {
      session.screenShareAllowed.add(targetParticipantId);
    } else {
      session.screenShareAllowed.delete(targetParticipantId);
      // Revoking permission mid-share stops it, the same way muting the AI
      // cuts off its current turn rather than waiting for it to finish.
      if (session.activeScreenShare?.participantId === targetParticipantId) {
        session.activeScreenShare = null;
        publish(session.sessionId, {
          kind: 'echosphere:screen-share-stopped',
          participantId: targetParticipantId,
        });
      }
    }

    publish(session.sessionId, {
      kind: 'echosphere:screen-share-permission-changed',
      participantId: targetParticipantId,
      allowed,
    });

    return reply.send({ ok: true, screenShareAllowed: Array.from(session.screenShareAllowed) });
  });

  // ─── Screen Share Start/Stop (self-reported, permission-checked) ─────────

  app.post('/api/sessions/:sessionId/screen-share', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, sharing } = z
      .object({ participantId: z.string(), sharing: z.boolean() })
      .parse(request.body);

    const participant = session.participants.get(participantId);
    if (!participant) return reply.code(404).send({ error: 'Participant not found' });

    const permitted =
      participant.role === 'teacher' || session.screenShareAllowed.has(participantId);
    if (!permitted) {
      return reply.code(403).send({ error: 'You do not have permission to share your screen' });
    }

    if (sharing) {
      if (session.activeScreenShare && session.activeScreenShare.participantId !== participantId) {
        return reply.code(409).send({
          error: `${session.activeScreenShare.participantId === participantId ? 'You are' : 'Someone else is'} already sharing`,
        });
      }
      session.activeScreenShare = { participantId, displayName: participant.displayName };
      publish(session.sessionId, {
        kind: 'echosphere:screen-share-started',
        participantId,
        displayName: participant.displayName,
      });
    } else {
      if (session.activeScreenShare?.participantId === participantId) {
        session.activeScreenShare = null;
      }
      publish(session.sessionId, {
        kind: 'echosphere:screen-share-stopped',
        participantId,
      });
    }

    return reply.send({ ok: true, activeScreenShare: session.activeScreenShare });
  });

  // ─── Multilingual Real-Time Translation ────────────────────────────────────

  app.post('/api/sessions/:sessionId/translate', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { text, targetLanguage, sourceLanguage } = z
      .object({
        text: z.string().min(1),
        targetLanguage: z.enum(['en', 'hi', 'es', 'fr', 'de', 'ta', 'te']),
        sourceLanguage: z.enum(['en', 'hi', 'es', 'fr', 'de', 'ta', 'te']).optional(),
      })
      .parse(request.body);

    const translated = await translateText(text, targetLanguage, sourceLanguage);
    return reply.send({ original: text, translated, language: targetLanguage });
  });

  app.post('/api/sessions/:sessionId/language', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, language } = z
      .object({
        participantId: z.string().optional(),
        language: z.enum(['en', 'hi', 'es', 'fr', 'de', 'ta', 'te']),
      })
      .parse(request.body);

    session.language = language;
    if (participantId) {
      const participant = session.participants.get(participantId);
      if (participant) {
        participant.language = language;
      }
    }

    // Push updated multilingual system instructions to live Athena immediately
    await pushInstructions(session).catch(() => false);

    publish(session.sessionId, {
      kind: 'echosphere:language-changed',
      participantId: participantId || '',
      language,
    });

    return reply.send({ ok: true, language: session.language });
  });


  app.get('/api/sessions/:sessionId/report', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'The report is teacher-only' });
    }

    // Second gate, on top of the in-room teacher check above. That check only
    // proves the caller holds a teacher participantId for this session, which
    // is a value that travels in a URL and outlives the class. Once a lesson
    // has a signed-in owner, the report — the most sensitive artefact here,
    // since it names students and characterises their understanding — is
    // restricted to that account.
    if (session.owner) {
      const auth = await requireTeacher(request, reply);
      if (!auth.ok) return;
      if (auth.teacher && auth.teacher.userId !== session.owner.userId) {
        return reply
          .code(403)
          .send({ error: 'This lesson belongs to another teacher.' });
      }
      // auth.teacher === null only when AUTH_REQUIRED is off, which is the
      // pre-auth behaviour this deployment still runs on; the participantId
      // check above remains the gate in that case.
    }

    const report = await generateReport(session);
    return reply.send(report);
  });

  // ─── Digital Library Routes ────────────────────────────────────────────────

  app.get('/api/sessions/:sessionId/library', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const activeBookId = session.library?.activeBookId || 'ncert-7-ch2';
    const book = getLibraryBook(activeBookId, session.sessionId);
    const books = getSessionBooks(session.sessionId);
    return reply.send({
      library: session.library,
      book,
      books,
    });
  });

  app.get('/api/sessions/:sessionId/library/books', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const books = getSessionBooks(session.sessionId);
    return reply.send({ books });
  });

  app.post('/api/sessions/:sessionId/library/books', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const schema = z.object({
      participantId: z.string(),
      book: z.object({
        id: z.string(),
        title: z.string(),
        subtitle: z.string().optional().default(''),
        subject: z.string().optional().default('Class Notes'),
        kind: z.enum(['curriculum', 'pdf', 'pptx', 'text']),
        pages: z.array(z.any()),
      }),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }

    const { participantId, book } = parsed.data;
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only teachers can add books to the classroom shelf.' });
    }

    const participant = session.participants.get(participantId);
    const addedBy = participant?.displayName || 'Teacher';

    const libraryBook = {
      ...book,
      subtitle: book.subtitle || 'Classroom Shelf',
      addedBy,
      createdAt: new Date().toISOString(),
    };

    const res = addBookToSession(session.sessionId, libraryBook, 'teacher');
    if (!res.success) {
      return reply.code(400).send({ error: res.error });
    }

    if (session.library) {
      session.library.activeBookId = libraryBook.id;
      session.library.currentPage = 0;
      session.library.lastSequence++;
    }

    // Broadcast addition to all students via SSE / RTM
    publish(session.sessionId, {
      kind: 'echosphere:library-book-added',
      payload: {
        bookId: libraryBook.id,
        book: libraryBook,
        addedBy,
      },
    });

    publish(session.sessionId, {
      kind: 'echosphere:library-open',
      payload: {
        bookId: libraryBook.id,
        source: 'teacher',
      },
    });

    if (session.library) {
      publish(session.sessionId, {
        kind: 'echosphere:library-state',
        state: session.library,
      });
    }

    return reply.send({ ok: true, book: libraryBook, state: session.library });
  });

  app.delete('/api/sessions/:sessionId/library/books/:bookId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { bookId } = request.params as { bookId: string };
    const { participantId } = z.object({ participantId: z.string() }).parse(request.query);

    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only teachers can remove books from the classroom shelf.' });
    }

    const res = removeBookFromSession(session.sessionId, bookId, 'teacher');
    if (!res.success) {
      return reply.code(400).send({ error: res.error });
    }

    const participant = session.participants.get(participantId);
    const removedBy = participant?.displayName || 'Teacher';

    publish(session.sessionId, {
      kind: 'echosphere:library-book-removed',
      payload: {
        bookId,
        removedBy,
      },
    });

    return reply.send({ ok: true });
  });

  app.post('/api/sessions/:sessionId/library/open', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const schema = z.object({
      bookId: z.string(),
      participantId: z.string().optional(),
    });
    const { bookId, participantId } = schema.parse(request.body);

    const isTeacherUser = participantId ? isTeacher(session, participantId) : true;
    if (session.library) {
      session.library.activeBookId = bookId;
      session.library.currentPage = 0;
      session.library.lastSequence++;
    }

    if (isTeacherUser) {
      publish(session.sessionId, {
        kind: 'echosphere:library-open',
        payload: {
          bookId,
          source: 'teacher',
        },
      });
      publish(session.sessionId, {
        kind: 'echosphere:library-state',
        state: session.library!,
      });
    }

    return reply.send({ ok: true, state: session.library });
  });

  app.post('/api/sessions/:sessionId/library/turn', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const schema = z.object({
      page: z.number().int().min(0),
      bookId: z.string().optional(),
      participantId: z.string().optional(),
      glow: z.boolean().optional(),
    });
    const { page, bookId, participantId, glow } = schema.parse(request.body);

    const isTeacherUser = participantId ? isTeacher(session, participantId) : true;
    const targetBookId = bookId || session.library?.activeBookId || 'ncert-7-ch2';

    // If locked to teacher, non-teachers CANNOT turn the classroom page
    if (session.library?.isLocked && !isTeacherUser) {
      return reply.code(403).send({ error: 'Textbook is locked to teacher' });
    }

    if (isTeacherUser) {
      // Teacher turns the whole class page
      if (session.library) {
        if (bookId) session.library.activeBookId = bookId;
        session.library.currentPage = page;
        session.library.lastSequence++;
        if (glow) {
          session.library.glowPage = page;
        }
      }

      const seq = session.library?.lastSequence || Date.now();

      publish(session.sessionId, {
        kind: 'echosphere:library-page',
        payload: {
          bookId: targetBookId,
          page,
          seq,
          source: 'teacher',
          glow,
        },
      });
    } else {
      // Student is in Free Read mode (isLocked is false):
      // Record student's current reading page and notify the teacher
      const participant = participantId ? session.participants.get(participantId) : undefined;
      const displayName = participant?.displayName || 'Student';
      const studentPos = {
        participantId: participantId || 'unknown',
        displayName,
        page,
        bookId: targetBookId,
        updatedAt: Date.now(),
      };

      if (!session.library.studentPositions) {
        session.library.studentPositions = {};
      }
      if (participantId) {
        session.library.studentPositions[participantId] = studentPos;
      }

      publishToTeachers(session.sessionId, {
        kind: 'echosphere:library-student-position',
        position: studentPos,
      });
    }

    return reply.send({ ok: true, state: session.library });
  });

  app.post('/api/sessions/:sessionId/library/lock', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const schema = z.object({
      locked: z.boolean(),
      participantId: z.string().optional(),
    });
    const { locked, participantId } = schema.parse(request.body);

    if (participantId && !isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only teachers can change library lock status' });
    }

    if (session.library) {
      session.library.isLocked = locked;
      session.library.lastSequence++;
    }

    publish(session.sessionId, {
      kind: 'echosphere:library-lock',
      payload: { locked },
    });

    // If locked back to teacher, broadcast current teacher page to bring all students back
    if (locked && session.library) {
      publish(session.sessionId, {
        kind: 'echosphere:library-page',
        payload: {
          bookId: session.library.activeBookId,
          page: session.library.currentPage,
          seq: session.library.lastSequence,
          source: 'teacher',
        },
      });
    }

    return reply.send({ ok: true, isLocked: locked, state: session.library });
  });

  app.post('/api/sessions/:sessionId/library/present', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const schema = z.object({
      presenting: z.boolean(),
      participantId: z.string().optional(),
    });
    const { presenting, participantId } = schema.parse(request.body);

    if (session.library) {
      session.library.isPresenting = presenting;
      session.library.presenterId = presenting ? participantId || 'teacher' : null;
    }

    publish(session.sessionId, {
      kind: 'echosphere:library-present',
      payload: {
        presenting,
        presenterId: session.library?.presenterId || null,
      },
    });

    return reply.send({ ok: true, isPresenting: presenting });
  });

  app.get('/api/sessions/:sessionId/library/search', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { q, bookId } = request.query as { q?: string; bookId?: string };
    if (!q) {
      return reply.code(400).send({ error: 'Missing search query q' });
    }
    const targetBookId = bookId || session.library?.activeBookId || 'ncert-7-ch2';
    const result = findPageInBook(targetBookId, q, session.sessionId);
    return reply.send({ result });
  });

  app.delete('/api/sessions/:sessionId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    await stopAgent(session.sessionId);
    endSession(session.sessionId);
    releaseIllustrationState(session.sessionId);
    closeRoom(session.sessionId);
    // See the END_SESSION handler above: fire-and-forget, same reasoning.
    void persistSessionEnd(session).catch((err) =>
      app.log.error({ err }, 'failed to persist session on DELETE'),
    );
    return reply.send({ ok: true });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): ClassroomSession | undefined {
  const { sessionId } = request.params as { sessionId?: string };
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) {
    reply.code(404).send({ error: 'No such classroom session' });
    return undefined;
  }
  return session;
}

function publicSession(session: ClassroomSession) {
  return {
    sessionId: session.sessionId,
    channel: session.channel,
    title: session.title,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    participantCount: activeParticipants(session).length,
    agentId: session.agentId,
  };
}

function roomState(session: ClassroomSession): RoomState {
  return {
    sessionId: session.sessionId,
    channel: session.channel,
    title: session.title,
    language: session.language || 'en',
    participants: activeParticipants(session).map(toPublicParticipant),
    floor: session.floor,
    policy: session.policy,
    agentId: session.agentId,
    agentUid: AGENT_UID,
    startedAt: session.createdAt,
    endedAt: session.endedAt,
    suppressedInterventions: session.suppressedInterventions,
    restraintMeterState: session.restraintMeterState,
    workspace: getWorkspaceState(session),
    targetedReadings: getTargetedReadings(session),
    catchupSlots: getCatchupSlots(session),
    raisedHands: Array.from(session.raisedHands),
    whiteboard: publicWhiteboard(session),
    library: session.library,
    screenShareAllowed: Array.from(session.screenShareAllowed),
    activeScreenShare: session.activeScreenShare,
    activeModel: session.activeModel,
  };
}
