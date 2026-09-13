/**
 * Custom OpenAI-compatible LLM proxy — the Restraint Meter / Intervention
 * Gate feature. Every agent completion is meant to route through here so
 * `evaluateGate()` can decide whether to let a reply through or suppress it.
 *
 * Currently dormant: `agentLifecycle.ts` no longer points the agent's LLM at
 * this route. Agora's Conversational AI Engine runs as a managed cloud
 * service — it cannot reach a `localhost` URL, so this only ever worked
 * behind a public tunnel (ngrok/cloudflared) pointed at the orchestrator.
 * Without one, the agent now uses Agora's own resold model directly (no
 * custom URL), which means real replies, quizzes and gap detection all work
 * — just without the restraint-suppression layer this route implements.
 *
 * To re-enable: run a tunnel to this orchestrator's port, set
 * `PUBLIC_ORCHESTRATOR_URL` to the tunnel's public URL, and restore the
 * `.withLlm(new OpenAI({ url: ..., apiKey: ... }))` wiring in
 * `agent/agentLifecycle.ts` (see its git history / this comment's sibling
 * note there).
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getSession } from '../state/sessionRegistry.js';
import { evaluateGate } from '../agent/interventionGate.js';
import { publish, publishToTeachers } from '../state/eventBus.js';

/** Mirrors the 50-entry cap the client keeps on its own copy (useClassroom.ts). */
const MAX_INTERVENTION_LOG_ENTRIES = 50;

function pushCapped<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > MAX_INTERVENTION_LOG_ENTRIES) {
    list.splice(0, list.length - MAX_INTERVENTION_LOG_ENTRIES);
  }
}

export async function completionsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/chat/completions', async (request, reply) => {
    const { sessionId } = request.query as { sessionId?: string };
    const session = sessionId ? getSession(sessionId) : undefined;

    // Snapshotted now, before the LLM call below: handleAgentState clears
    // session.speakPermit as soon as the browser relays the engine's
    // 'thinking' state, which can race ahead of a slow LLM fetch and make a
    // genuine direct address read as false by the time the gate is evaluated.
    const isDirectAddress = session?.speakPermit?.reason === 'DIRECTLY_ADDRESSED';

    const body = request.body as any;
    const messages = body.messages ?? [];
    const stream = body.stream ?? false;
    const model = body.model ?? 'gpt-4o-mini';

    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const lastMessageStr = typeof lastMessage === 'string' ? lastMessage : JSON.stringify(lastMessage);

    // 1. Get completion response text (either call actual LLM or fallback to mock)
    let replyText = '';
    const apiKey = process.env.SARVAM_API_KEY || process.env.OPENAI_API_KEY;

    if (apiKey && apiKey !== 'mock_sarvam_api_key' && apiKey !== 'mock_key') {
      try {
        const isSarvam = process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY !== 'mock_sarvam_api_key';
        const url = isSarvam
          ? 'https://api.sarvam.ai/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: isSarvam ? 'sarvam-105b' : model,
            messages,
            temperature: body.temperature ?? 0.4,
            max_tokens: body.max_tokens ?? 700,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          replyText = data.choices?.[0]?.message?.content ?? '';
        } else {
          app.log.error(`LLM API returned status ${response.status}`);
        }
      } catch (err) {
        app.log.error({ err }, 'Error calling LLM API');
      }
    }

    // Fallback Mock completion text if API keys are missing or API call failed
    if (!replyText) {
      const lower = lastMessageStr.toLowerCase();
      if (lower.includes('[classroom:system]')) {
        if (lower.includes('quiz')) {
          // Extract topic from directive
          const match = lastMessageStr.match(/about "([^"]+)"/i);
          const topic = (match && match[1]) ? match[1] : 'Fractions';
          const topicLower = topic.toLowerCase();
          
          if (topicLower.includes('least common denominator') || topicLower.includes('lcd')) {
            replyText = `Let's test our understanding of the Least Common Denominator with a quick quiz. What is the least common denominator of one-third and one-fourth? Is it A: seven, B: twelve, or C: twenty-four? {"quiz":{"topic":"least common denominator","question":"What is the least common denominator of 1/3 and 1/4?","options":["A: 7","B: 12","C: 24"],"answer":"B","difficulty":"easy"}}`;
          } else if (topicLower.includes('fraction')) {
            replyText = `Let's do a quick quiz on fractions. In the fraction three-fourths, what is the number three called? Is it A: denominator, B: numerator, or C: integer? {"quiz":{"topic":"fractions","question":"In the fraction 3/4, what is 3 called?","options":["A: denominator","B: numerator","C: integer"],"answer":"B","difficulty":"easy"}}`;
          } else {
            replyText = `Here is a quiz question on ${topic} to check our understanding. What is the key concept of ${topic}? Is it A: Option A, B: Option B, or C: Option C? {"quiz":{"topic":"${topic}","question":"What is the key concept of ${topic}?","options":["A: Option A","B: Option B","C: Option C"],"answer":"B","difficulty":"easy"}}`;
          }
        } else if (lower.includes('gap') || lower.includes('confusion')) {
          const match = lastMessageStr.match(/about "([^"]+)"/i) || lastMessageStr.match(/"([^"]+)"/i);
          const topic = (match && match[1]) ? match[1] : 'this topic';
          replyText = `I noticed some confusion about "${topic}". Remember that we can simplify our calculations by finding the common denominator first before adding the numerators together.`;
        } else {
          replyText = "Okay, let's keep going with the lesson. Ms. Rao, please continue.";
        }
      } else if (lower.includes('hey athena') || lower.includes('athena')) {
        if (lower.includes('fraction') || lower.includes('add') || lower.includes('unlike')) {
          replyText = `To add unlike fractions, you must find the least common denominator first. For example, the LCD of 1/3 and 1/4 is 12. Let's verify: {"quiz":{"topic":"LCD","question":"What is the first step to add 1/3 and 1/4?","options":["A: Add denominators","B: Find the LCD"],"answer":"B"}}`;
        } else if (lower.includes('hello') || lower.includes('hi')) {
          replyText = "Hello Ms Rao and class! I am Athena, your co-teacher. I'm here to help listen and assist when needed.";
        } else {
          replyText = `I heard you address me. Let's make sure we understand the concept. {"quiz":{"topic":"Fractions","question":"Is the denominator the top or bottom of a fraction?","options":["A: Top","B: Bottom"],"answer":"B"}}`;
        }
      } else {
        // Unprompted/Proactive drafts
        if (lower.includes('lcd') || lower.includes('common denominator')) {
          replyText = "Remember that the denominator represents the total number of parts, so it stays the same when adding fractions.";
        } else {
          replyText = "Let's review the main concept. The denominator never changes when you add fractions.";
        }
      }
    }

    // 2. Evaluate decision against the Intervention Gate
    let gateDecision = { score: 1.0, allowed: true, reason: 'no session registry' };

    if (session) {
      // Calculate gate variables
      const isTeacherSpeaking = session.floor.state === 'TEACHER_HOLDS_FLOOR';
      const silenceDurationMs = Date.now() - session.floor.lastHumanSpeechAt;
      const unansweredQuestionAgeMs = session.floor.state === 'STUDENT_QUESTION_PENDING'
        ? (Date.now() - session.floor.since)
        : 0;

      // Extract last transcript segment confidence
      const lastSegment = session.transcript[session.transcript.length - 1];
      const attributionConfidence = lastSegment
        ? (lastSegment.attributionConfidence ?? 1.0)
        : 1.0;

      // Map policy to gate mode
      let mode: 'silent' | 'on-request' | 'proactive' = 'on-request';
      if (session.policy.muted) {
        mode = 'silent';
      } else if (session.policy.proactiveInterjectionsEnabled) {
        mode = 'proactive';
      }

      gateDecision = evaluateGate({
        mode,
        isTeacherSpeaking,
        silenceDurationMs,
        isDirectAddress,
        unansweredQuestionAgeMs,
        attributionConfidence,
      });

      // Update session Restraint Meter State
      const nextMeterState = gateDecision.allowed ? 'speaking' : 'held-back';
      
      // Ready -> Speaking or Ready -> Held back transition
      session.restraintMeterState = 'ready';
      publish(session.sessionId, {
        kind: 'echosphere:restraint-meter-changed',
        state: 'ready',
        score: gateDecision.score,
      });

      if (gateDecision.allowed) {
        session.restraintMeterState = 'speaking';
        // Add to intervention history as spoken
        pushCapped(session.interventionHistory, {
          timestamp: Date.now(),
          text: replyText,
          reason: gateDecision.reason,
          score: gateDecision.score,
          status: 'spoken',
        });

        publish(session.sessionId, {
          kind: 'echosphere:restraint-meter-changed',
          state: 'speaking',
          score: gateDecision.score,
        });
      } else {
        session.restraintMeterState = 'held-back';
        const timestamp = Date.now();
        // Add to suppressed interventions log
        pushCapped(session.suppressedInterventions, {
          timestamp,
          text: replyText,
          reason: gateDecision.reason,
          score: gateDecision.score,
        });

        // Add to intervention history as suppressed
        pushCapped(session.interventionHistory, {
          timestamp,
          text: replyText,
          reason: gateDecision.reason,
          score: gateDecision.score,
          status: 'suppressed',
        });

        publishToTeachers(session.sessionId, {
          kind: 'echosphere:intervention-suppressed',
          timestamp,
          text: replyText,
          reason: gateDecision.reason,
          score: gateDecision.score,
        });

        publish(session.sessionId, {
          kind: 'echosphere:restraint-meter-changed',
          state: 'held-back',
          score: gateDecision.score,
        });

        // Set to listening after a delay
        setTimeout(() => {
          if (session.restraintMeterState === 'held-back') {
            session.restraintMeterState = 'listening';
            publish(session.sessionId, {
              kind: 'echosphere:restraint-meter-changed',
              state: 'listening',
            });
          }
        }, 3000);
      }
    }

    // 3. Send response back to the agent
    if (!gateDecision.allowed) {
      // Suppress speech: return empty response so agent stays silent
      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        const encoder = new TextEncoder();
        reply.raw.write(encoder.encode('data: [DONE]\n\n'));
        reply.raw.end();
        return reply;
      } else {
        return reply.send({
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        });
      }
    }

    // Allowed to speak: return replyText
    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const encoder = new TextEncoder();
      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      const sseChunk = (delta: any, finishReason: string | null = null) =>
        encoder.encode(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );

      // Start SSE Stream
      reply.raw.write(sseChunk({ role: 'assistant', content: '' }));

      // Split into words and stream with slight delay to mimic real completion
      const words = replyText.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunk = words[i] + (i === words.length - 1 ? '' : ' ');
        reply.raw.write(sseChunk({ content: chunk }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }

      reply.raw.write(sseChunk({}, 'stop'));
      reply.raw.write(encoder.encode('data: [DONE]\n\n'));
      reply.raw.end();

      // Reset restraint meter state to listening after speech ends (simulated delay or rely on state relay)
      if (session) {
        setTimeout(() => {
          if (session.restraintMeterState === 'speaking') {
            session.restraintMeterState = 'listening';
            publish(session.sessionId, {
              kind: 'echosphere:restraint-meter-changed',
              state: 'listening',
            });
          }
        }, 5000);
      }

      return reply;
    } else {
      return reply.send({
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: replyText }, finish_reason: 'stop' }],
      });
    }
  });
}
