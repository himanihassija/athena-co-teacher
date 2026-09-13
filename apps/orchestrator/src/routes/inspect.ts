/**
 * Prompt inspection — a window onto what the agent is actually being told.
 *
 * With no custom LLM endpoint, the whole classroom lives in the system prompt,
 * which makes that prompt the single most important artefact in the system and
 * the hardest thing to debug blind. This route renders it on demand.
 *
 * It is also the clearest way to demonstrate §3.5: retag a student from
 * beginner to advanced and the roster block visibly changes, without spending
 * an agent turn to find out.
 */

import type { FastifyInstance } from 'fastify';
import { buildClassroomInstructions } from '../agent/prompt.js';
import { getAgentSession } from '../agent/agentLifecycle.js';
import { getSession } from '../state/sessionRegistry.js';

export async function inspectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sessions/:sessionId/prompt', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ error: 'No such classroom session' });
    }

    const prompt = buildClassroomInstructions(session);
    return reply.send({
      prompt,
      characters: prompt.length,
      lessonChunks: session.lesson.chunks.length,
      students: session.participants.size,
    });
  });

  /**
   * The agent's own view of the conversation, straight from ConvoAI.
   *
   * This is the only way to see what the model actually produced, as opposed to
   * what survived TTS and the transcript relay. When the agent appears to
   * ignore an instruction, this distinguishes "the LLM said nothing" from "the
   * LLM spoke and the words were lost on the way back".
   */
  app.get('/api/sessions/:sessionId/agent/history', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const agentSession = getAgentSession(sessionId);
    if (!agentSession) {
      return reply.code(404).send({ error: 'No agent running for this session' });
    }
    try {
      return reply.send(await agentSession.getHistory());
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : 'History unavailable',
      });
    }
  });
}
