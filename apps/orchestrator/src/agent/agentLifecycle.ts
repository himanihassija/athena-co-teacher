/**
 * ConvoAI agent lifecycle — PS31 §3.1 (agent joins the live classroom),
 * §3.3 (barge-in), §3.6 (spoken quizzes), §3.10 (teacher override actions).
 *
 * Wraps the `agora-agents` SDK. The live `AgentSession` object must be held in
 * memory to call `interrupt()` / `say()` / `think()` / `update()` on it — which
 * is the concrete reason the orchestrator is a long-lived process rather than
 * serverless functions.
 *
 * Configuration follows the official Next.js quickstart's `invite-agent` route.
 * The classroom-specific changes are:
 *   - `remoteUids: ['*']` so the agent hears every participant, not just one
 *     requester (§3.1 multi-party).
 *   - `skipPatterns: [5]` on TTS, opening the brace control channel (§3.6, §3.9).
 *   - `idleTimeout: 0` so the agent does not drop out of a quiet classroom.
 *   - semantic end-of-speech, so a teacher pausing mid-explanation is not read
 *     as end-of-turn without charging every ordinary turn a fixed 2s wait.
 *   - `interruption` in keyword mode, so only someone addressing Athena by
 *     name can cut her off — not a scraping chair or a student's aside.
 *
 * There is deliberately NO Selective Attention Locking (SAL) here. A `sal`
 * block used to be sent, but `advanced_features.enable_sal` never was, and
 * Agora documents that flag as what turns the feature on — so nothing was
 * separating voices and the comments claiming otherwise described behaviour
 * that had never run. Enabling it properly is not the fix either: the join
 * schema states `sal.sample_urls` supports "Only one voiceprint URL", so
 * `recognition` mode can enrol exactly one speaker, which a classroom of
 * rotating students cannot use. Cross-talk is therefore a known, unmitigated
 * property of this deployment rather than a solved problem.
 *
 * The LLM is selected by LLM_VENDOR: either an OpenAI model Agora resells
 * (no OpenAI key anywhere in this project; billed through the Agora project)
 * or gpt-oss-120b on Groq with a dedicated key (GROQ_AGENT_API_KEY). The Groq
 * path exists because the Anam avatar's lip-sync drifted against Agora on the
 * resold path; see config.ts.
 */

import {
  Agent,
  AgoraClient,
  Area,
  ExpiresIn,
  Groq,
  OpenAI,
  type AgentSession,
  SarvamSTT,
  SarvamTTS,
  DeepgramSTT,
  MiniMaxTTS,
} from 'agora-agents';
import { GREETING, buildClassroomInstructions, getGreetingForLanguage } from './prompt.js';
import { AGENT_UID, type ClassroomSession } from '../state/sessionRegistry.js';
import { config } from '../config.js';
import { isReasoningModel, reasoningHeadroom } from '../llm/reasoning.js';

/**
 * Models Agora resells under its own billing presets. The SDK types the
 * reseller path as this literal union rather than `string`, so a configured
 * value has to be checked against it before use. Mirrored here rather than
 * imported because the package exports the type only from a deep path.
 */
const RESELLER_MODELS = [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-5-nano',
  'gpt-5-mini',
] as const;

type ResellerModel = (typeof RESELLER_MODELS)[number];

/** Falls back to the smallest supported preset if LLM_MODEL is not resold. */
export function resellerModel(): ResellerModel {
  const configured = config.llmModel;
  return RESELLER_MODELS.includes(configured as ResellerModel)
    ? (configured as ResellerModel)
    : 'gpt-4o-mini';
}

/**
 * What LLM_MODEL was set to versus what the agent will actually run.
 *
 * These diverge silently. `resellerModel()` falls back to `gpt-4o-mini` for any
 * value outside `RESELLER_MODELS` — a typo, or a model Agora does not resell —
 * and nothing anywhere logs it. `/health` then echoed the raw env var, so a
 * deployment could report a model it was not running.
 *
 * That is not a hypothetical: `gpt-4o-mini` is the model that answered a
 * restraint instruction by saying the word "Silence." out loud, so a typo in a
 * deployment env var silently reinstates a fixed bug while the health endpoint
 * insists the model was changed. Both values are surfaced so the two can never
 * be confused again.
 */
export function modelResolution(): {
  vendor: 'agora' | 'groq';
  configured: string;
  resolved: string;
  supported: boolean;
} {
  if (config.llmVendor === 'groq') {
    // Bring-your-own-key: whatever is configured is sent verbatim, so there is
    // no fallback to diverge from. A wrong name fails loudly at Groq instead.
    const model = config.groqAgentModel;
    return { vendor: 'groq', configured: model, resolved: model, supported: true };
  }
  const configured = config.llmModel;
  const resolved = resellerModel();
  return { vendor: 'agora', configured, resolved, supported: configured === resolved };
}

/** The model name the in-call agent actually runs, for either vendor. */
function agentModel(): string {
  return modelResolution().resolved;
}

/**
 * Sampling and length settings for the configured model.
 *
 * The GPT-5 family takes a different parameter set from GPT-4, and sending the
 * GPT-4 one is a hard 400 from the API rather than an ignored field — the whole
 * pipeline fails to start and the room is told transcription is unavailable:
 *
 *   "Unsupported parameter: 'max_tokens' is not supported with this model.
 *    Use 'max_completion_tokens' instead."
 *
 * Two differences, both handled here:
 *   - the output cap was renamed `max_tokens` → `max_completion_tokens`
 *   - `temperature` and `top_p` are fixed at their defaults and are rejected
 *     if sent at all, so they are omitted rather than set
 *
 * Keyed off the model name rather than a config flag, because the two must
 * never disagree: a deployment that changes LLM_MODEL and forgets a second
 * switch would break in exactly the way this exists to prevent.
 */
/** How much SPOKEN reply a classroom turn is meant to be worth. */
const VISIBLE_REPLY_TOKENS = 700;

function llmParams(): Record<string, unknown> {
  const model = agentModel();

  // Two independent axes, deliberately not collapsed into one branch.
  //
  // Whether the model burns hidden reasoning tokens decides the SIZE of the cap
  // — 700 was the whole budget, and a reasoning pass can consume all of it and
  // return an empty string. Shared with the orchestrator's own LLM calls so the
  // two can no longer disagree about what counts as a reasoning model.
  const maxTokens = isReasoningModel(model)
    ? reasoningHeadroom(VISIBLE_REPLY_TOKENS)
    : VISIBLE_REPLY_TOKENS;

  // Whether it is GPT-5 decides the NAME of the cap. GPT-5 renamed
  // `max_tokens` to `max_completion_tokens` and rejects `temperature`/`top_p`
  // outright — a hard 400 that fails the whole pipeline, not an ignored field.
  // Groq's gpt-oss-120b takes the GPT-4 set (verified against the API: all
  // three accepted, reasoning returned in a separate field, never in content).
  return model.startsWith('gpt-5')
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens, temperature: 0.4, top_p: 0.9 };
}

/**
 * The LLM vendor object for the pipeline, per LLM_VENDOR.
 *
 * Both vendors are OpenAI-style on the wire, so the behavioural settings —
 * greeting, failure line, history depth, sampling — are identical. The only
 * difference is billing: the resold path sends no URL or key and the SDK
 * attaches an Agora preset header; the Groq path sends the completions URL and
 * the dedicated key, exactly as Agora's Groq integration page documents.
 */
function agentLlm(greeting: string): Groq | OpenAI {
  const shared = {
    greetingMessage: greeting,
    failureMessage: 'One moment.',
    maxHistory: 15,
    params: llmParams(),
  };
  if (config.llmVendor === 'groq') {
    return new Groq({
      ...shared,
      model: config.groqAgentModel,
      apiKey: config.groqAgentApiKey,
      url: 'https://api.groq.com/openai/v1/chat/completions',
    });
  }
  // Managed mode types `model` as the reseller literal union, not `string`.
  return new OpenAI({ ...shared, model: resellerModel() });
}

/**
 * The words that may cut Athena off mid-sentence.
 *
 * Derived from the room's own wake phrase so a teacher who renames her keeps a
 * working barge-in. "athena" is included as a bare token too: the wake phrase
 * defaults to "hey athena", and someone cutting in almost never repeats the
 * whole phrase — they say her name.
 *
 * Deduplicated and lowercased. The engine caps this list at 128 entries; this
 * produces at most three.
 */
function interruptKeywords(session: ClassroomSession): string[] {
  const wake = session.policy?.wakePhrase?.trim().toLowerCase();
  const candidates = [wake, 'athena', 'stop'].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );
  return [...new Set(candidates)];
}

/** Live sessions, keyed by classroom sessionId. */
const liveAgents = new Map<string, AgentSession>();

export function getAgentSession(sessionId: string): AgentSession | undefined {
  return liveAgents.get(sessionId);
}

export function isAgentRunning(sessionId: string): boolean {
  return liveAgents.get(sessionId)?.status === 'running';
}

export async function startAgent(session: ClassroomSession): Promise<string> {
  const existing = liveAgents.get(session.sessionId);
  if (existing && existing.status === 'running') {
    return existing.id as string;
  }

  const client = new AgoraClient({
    area: Area.US,
    appId: config.agoraAppId,
    appCertificate: config.agoraAppCertificate,
  });

  const greeting = getGreetingForLanguage(session.language);
  const sttLang = session.language || config.sttLanguage || 'en';

  let agent = new Agent({
    client,
    instructions: buildClassroomInstructions(session),
    greeting,
    failureMessage: 'One moment.',
    maxHistory: 50,
    // Turn detection tuned for a classroom rather than a 1:1 call. The
    // quickstart's 480ms end-of-speech is too eager here: a teacher pausing
    // mid-explanation would repeatedly read as end-of-turn. This is the first
    // line of defence against the agent talking over the teacher; the floor
    // state machine is the second.
    turnDetection: {
      config: {
        speech_threshold: 0.5,
        start_of_speech: {
          mode: 'vad',
          vad_config: {
            // These two live under `start_of_speech`, whose schema description
            // is "Determines when a user begins speaking" — they gate turn
            // START, not barge-in.
            //
            // `interrupt_duration_ms` was pinned to the documented ceiling of
            // 1200 on the belief that it suppressed a one-word backchannel
            // cutting Athena off mid-sentence. That is the job of its sibling
            // `speaking_interrupt_duration_ms` ("Interruption duration in
            // milliseconds while the agent is speaking"), which is left at
            // Agora's default of 160 and is deliberately not set here.
            //
            // Because listening is Athena's resting state, the ceiling applied
            // to almost every utterance in the room: a speaker had to sustain
            // 1.2 continuous seconds above the VAD threshold before the engine
            // registered that a turn had begun at all. Teacher speech clears
            // that easily; student speech — "six", "yeah", "I don't get it" —
            // mostly does not, which is the shape of the missing-transcription
            // fault. 200 sits just above Agora's 160 default, keeping a little
            // of the noise margin the ceiling was reaching for.
            interrupt_duration_ms: 200,
            // Agora's default. How much audio from BEFORE the detected start is
            // kept, so 300 clipped the opening word of anything that did get
            // through — compounding the above rather than offsetting it.
            prefix_padding_ms: 800,
          },
        },
        // Semantic end-of-turn, not a silence stopwatch.
        //
        // This previously ran `mode: 'vad'` with `silence_duration_ms` pinned
        // to the documented ceiling of 2000. The reasoning was sound and the
        // cost was real: a flat timer cannot tell a thinking-pause from a
        // finished sentence, so the only way to stop one utterance being
        // fragmented into several turn_ids was to wait long enough that no
        // ordinary pause could close the turn — which meant EVERY turn, even
        // an obviously complete one, paid a two-second wait before Athena
        // could answer. That wait is the single largest contributor to the
        // conversation feeling sluggish.
        //
        // `semantic` asks the engine to decide whether the utterance is
        // actually finished rather than whether the room went quiet, so a
        // complete sentence closes promptly and a trailing-off one does not.
        // `pause_state_enabled` handles the exact case the old ceiling was
        // protecting: a speaker ending on "hold on" or "just a moment" is
        // understood as still holding the floor, not as end-of-turn.
        end_of_speech: {
          mode: 'semantic',
          semantic_config: {
            // The floor under the semantic decision, not the decision itself.
            // Well below the old 2000 because semantics — not this number — is
            // now what protects a mid-sentence pause.
            silence_duration_ms: 640,
            // Ceiling on waiting for that decision. On timeout the engine
            // falls back to its current read of the turn, so this bounds
            // worst-case latency rather than changing ordinary behaviour.
            max_wait_ms: 3000,
            pause_state_enabled: true,
          },
        },
      },
    },
    // Keyword-gated barge-in, handled inside the engine.
    //
    // The default is `start_of_speech`: ANY human voice cuts the agent off.
    // In a 1:1 call that is what you want. In a classroom it means a student
    // murmuring to a neighbour, a chair scraping into someone's mic, or a
    // one-word "okay" truncates an explanation the teacher asked for — which
    // is what `interrupt_duration_ms: 1200` above was straining to suppress by
    // demanding a long burst of speech before honouring an interrupt.
    //
    // Keyword mode replaces that guess with an intention: only a speaker
    // actually addressing Athena by name stops her. Room noise no longer can.
    // This runs in the engine, so it costs nothing and cannot race — unlike
    // the orchestrator's own `interruptAgent()`, which is a REST round-trip
    // measured at over three seconds.
    //
    // This governs BARGE-IN ONLY. It does not decide whether Athena may start
    // a turn, so the floor/permit machinery in classroomController is still
    // load-bearing and is deliberately left alone.
    interruption: {
      enable: true,
      mode: 'keywords',
      keywords_config: { trigger_keywords: interruptKeywords(session) },
    },
    advancedFeatures: { enable_rtm: true, enable_tools: true },
    parameters: {
      // Agora documents `aiserver` as "Optimized for interactions between the
      // user and the conversational AI agent in terms of latency and network
      // resilience", and it is what `default` maps to. This ran `chorus` —
      // "Real-time chorus scenario, where users have good network conditions
      // and require ultra-low latency" — which trades away exactly the network
      // resilience a room of student laptops on school wifi depends on.
      audio_scenario: 'aiserver',
      data_channel: 'rtm',
      enable_error_message: true,
      enable_metrics: true,
    },
  });

  const hasSarvam =
    Boolean(config.sarvamApiKey) &&
    config.sarvamApiKey !== 'mock_sarvam_api_key' &&
    config.sarvamApiKey !== 'mock_key';

  if (hasSarvam) {
    const sarvamLang =
      sttLang === 'hi' || (sttLang as string) === 'multi'
        ? 'hi-IN'
        : sttLang === 'ta'
          ? 'ta-IN'
          : sttLang === 'te'
            ? 'te-IN'
            : sttLang;
    agent = agent
      .withStt(
        new SarvamSTT({
          apiKey: config.sarvamApiKey,
          language: sarvamLang as any,
        }),
      )
      .withTts(
        new SarvamTTS({
          key: config.sarvamApiKey,
          speaker: config.sarvamSpeaker,
          targetLanguageCode: (sttLang === 'en' ? 'en-IN' : sarvamLang) as any,
          skipPatterns: [5],
        }),
      );
  } else {
    // Deepgram nova-3 supports en, fr, es, de, hi, ta, te natively.
    agent = agent
      .withStt(
        new DeepgramSTT({
          model: 'nova-3',
          language: sttLang,
        }),
      )
      .withTts(
        new MiniMaxTTS({
          model: 'speech_2_6_turbo',
          voiceId: config.ttsVoiceId || 'English_captivating_female1',
          skipPatterns: [5],
        }),
      );
  }

  agent = agent.withLlm(agentLlm(greeting));

  const agentSession = agent.createSession({
    channel: session.channel,
    agentUid: AGENT_UID,
    // '*' subscribes the agent to every participant in the channel. The
    // quickstart restricts this to a single requester; a classroom needs all of
    // them, and per-speaker attribution is recovered from the RTM transcript's
    // uid rather than from this filter.
    remoteUids: ['*'],
    // 0 disables the idle auto-exit. A class can sit silent through a written
    // exercise; the agent must still be there afterwards.
    idleTimeout: 0,
    expiresIn: ExpiresIn.hours(4),
    debug: config.debugAgora,
  });

  const agentId = await agentSession.start();
  liveAgents.set(session.sessionId, agentSession);
  return agentId;
}

/**
 * Rebuilds the system prompt from current classroom state and pushes it to the
 * running agent.
 *
 * This is the mechanism that replaces a custom LLM endpoint. Without one the
 * orchestrator cannot inject context per turn, so it re-states the whole
 * classroom whenever something the agent needs to know changes — a student
 * joins, the teacher retags someone's level, lesson material is uploaded, or
 * the verbosity/topic policy moves.
 *
 * Failures are swallowed deliberately: a stale prompt degrades the agent's
 * grounding, whereas a thrown error here would break the teacher action that
 * triggered it.
 */
export async function pushInstructions(
  session: ClassroomSession,
): Promise<boolean> {
  const agentSession = liveAgents.get(session.sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;

  try {
    await agentSession.update({
      llm: {
        system_messages: [
          { role: 'system', content: buildClassroomInstructions(session) },
        ],
        // `update` overwrites `params` wholesale rather than merging, so every
        // field has to be repeated — `model` above all. Omitting it wiped the
        // model from a running agent, and since this runs whenever the roster
        // changes, the LLM broke the moment a second person joined the room.
        // The engine then answered every turn with the failure message.
        // Same GPT-4/GPT-5 split as on start (see llmParams). This path is the
        // more dangerous of the two: it fires whenever the roster or policy
        // changes, so a wrong parameter set here breaks a lesson that was
        // already running rather than one that never started.
        params: { model: agentModel(), ...llmParams() },
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopAgent(sessionId: string): Promise<void> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession) return;
  try {
    await agentSession.stop();
  } finally {
    liveAgents.delete(sessionId);
  }
}

/**
 * Barge-in and END_AGENT_TURN (§3.3, §3.10). Safe to call when the agent is not
 * speaking — the engine treats it as a no-op, so callers need not race-check
 * the floor state first.
 */
/**
 * Interrupts already in flight, keyed by session.
 *
 * `interrupt()` is a remote Agora call that has been measured at over three
 * seconds. Enforcement can fire several times for one turn (the engine emits
 * `thinking` and `speaking` separately, and transcripts arrive alongside), and
 * without this each one opened its own request. They piled up, every one of
 * them logged a separate "held back" entry, and the teacher saw the same
 * interrupt reported five times for a single utterance.
 */
const interruptsInFlight = new Map<string, Promise<boolean>>();

/**
 * Interrupt the agent's current turn. Concurrent callers for the same session
 * share one remote call rather than issuing several.
 */
export async function interruptAgent(sessionId: string): Promise<boolean> {
  const inFlight = interruptsInFlight.get(sessionId);
  if (inFlight) return inFlight;

  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;

  const call = agentSession
    .interrupt()
    .then(() => true)
    .finally(() => {
      interruptsInFlight.delete(sessionId);
    });
  interruptsInFlight.set(sessionId, call);
  return call;
}

export interface SpeakOptions {
  /** INTERRUPT cuts off current speech; APPEND queues behind it. */
  priority?: 'INTERRUPT' | 'APPEND' | 'IGNORE';
  /** false prevents students talking over it. */
  interruptable?: boolean;
}

/**
 * Broadcast exact text through TTS without an LLM round-trip. Used for
 * teacher-authored announcements, where the wording must be deterministic.
 *
 * Deliberately not used for quiz questions: those go through `think`, so the
 * agent phrases the question itself and reports it on the control channel in
 * the same turn. That is what keeps the spoken question and the on-screen card
 * identical without a second model call.
 */
export async function speak(
  sessionId: string,
  text: string,
  options: SpeakOptions = {},
): Promise<boolean> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;
  await agentSession.say(text, {
    priority: options.priority ?? 'INTERRUPT',
    interruptable: options.interruptable ?? true,
  });
  return true;
}

/**
 * Inject an instruction into the running pipeline and let the LLM answer it in
 * its own words. This carries FORCE_AGENT_SPEAK (§3.10), the gap interjection
 * (§3.3b), and quiz delivery (§3.6).
 *
 * Unlike `speak`, the wording is generated — which is what allows the agent to
 * emit a control payload alongside it.
 */
export interface ThinkOptions {
  /**
   * Whether a human speaking may cut this turn short. Defaults to true — the
   * orchestrator has cleared the utterance, but a person talking still wins.
   * Set false for turns that must be delivered whole even over a stray "okay":
   * a quiz question truncated before its trailing control payload leaves no
   * quiz record at all, so nothing can be scored (see startQuiz).
   */
  interruptable?: boolean;
}

export async function think(
  sessionId: string,
  instruction: string,
  options: ThinkOptions = {},
): Promise<boolean> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;
  await agentSession.think(instruction, {
    // `on_listening_action` is the one that actually matters, and omitting it
    // was why forced speech silently did nothing: listening is the agent's
    // resting state, so a teacher pressing "explain this now" almost always
    // arrives while it is listening, and the server default there is not to
    // start a turn. 'interrupt' means begin a new round of dialogue now.
    on_listening_action: 'interrupt',
    on_thinking_action: 'interrupt',
    on_speaking_action: 'interrupt',
    interruptable: options.interruptable ?? true,
  });
  return true;
}

type HistoryItem = { role?: string; content?: unknown };

async function assistantTurns(
  agentSession: AgentSession,
): Promise<string[]> {
  const history = (await agentSession.getHistory()) as { contents?: HistoryItem[] };
  const contents = history.contents ?? [];
  const turns = contents
    .filter((c) => c.role === 'assistant' && typeof c.content === 'string')
    .map((c) => c.content as string)
    .filter((t) => t.trim().length > 0);

  // Distinguishes the four ways this comes back useless: the endpoint threw
  // (caught by the caller), `contents` absent, `contents` present with no
  // assistant role, or assistant entries whose content is not a string. All
  // four previously collapsed into the same empty array and the same
  // "(no turn)" log line, which is what made a dead quiz set indistinguishable
  // from a quiet one.
  if (turns.length === 0) {
    console.info(
      `[quiz] history: ${contents.length} entries, 0 usable assistant turns` +
        (contents.length > 0
          ? ` (roles=${[...new Set(contents.map((c) => c.role))].join(',')}` +
            ` contentTypes=${[...new Set(contents.map((c) => typeof c.content))].join(',')})`
          : ' (contents absent or empty)'),
    );
  }
  return turns;
}

/** Snapshot of the assistant turns already in history — pass to pollForPayloadTurn. */
export async function assistantTurnSnapshot(sessionId: string): Promise<Set<string>> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return new Set();
  try {
    return new Set(await assistantTurns(agentSession));
  } catch (error) {
    console.warn(
      `[quiz] getHistory failed taking the pre-turn snapshot in session ${sessionId}:`,
      error,
    );
    return new Set();
  }
}

/** True once the text holds at least one balanced `{ … }` object. */
function hasCompletePayload(text: string): boolean {
  let depth = 0;
  let opened = false;
  for (const ch of text) {
    if (ch === '{') {
      depth += 1;
      opened = true;
    } else if (ch === '}') {
      depth -= 1;
      if (opened && depth === 0) return true;
    }
  }
  return false;
}

/**
 * Polls the agent's history for a NEW assistant turn (not in `before`) that
 * carries a finished `{ … }` control payload, and returns its text.
 *
 * Why: `skipPatterns` strips the payload from the TTS *and* from the RTM
 * transcript the browser relays, so the orchestrator never sees a quiz question
 * that way. `getHistory()` keeps the raw LLM output, braces intact. Matching on
 * "a new turn with a balanced brace object" rather than a turn *count* makes
 * this robust to a flaky history endpoint and to the turn still streaming — a
 * half-written payload has no closing brace yet, so we keep waiting.
 */
export async function pollForPayloadTurn(
  sessionId: string,
  before: Set<string>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string | null> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return null;

  const { timeoutMs = 25_000, intervalMs = 1_500 } = options;
  const deadline = Date.now() + timeoutMs;
  let newestSeen: string | null = null;
  let loggedPollError = false;

  while (Date.now() < deadline) {
    try {
      const turns = await assistantTurns(agentSession);
      // Walk newest-first; stop at the first turn that already existed.
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const t = turns[i] ?? '';
        if (before.has(t)) break;
        newestSeen = newestSeen ?? t;
        if (hasCompletePayload(t)) return t;
      }
    } catch (error) {
      // The history endpoint 404s briefly right after start / between turns, so
      // this stays non-fatal — but it must not stay invisible. A persistent
      // failure here is indistinguishable from "the agent said nothing", which
      // is what made a dead quiz set look like a quiet one. Logged once per
      // poll rather than per tick, or 16 iterations would bury the log.
      if (!loggedPollError) {
        loggedPollError = true;
        console.warn(
          `[quiz] getHistory failed during payload poll for session ${sessionId} ` +
            `(further errors this poll suppressed):`,
          error,
        );
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Timed out — hand back the newest new turn we saw, if any, so the caller can
  // at least log what the agent said.
  return newestSeen;
}

export async function agentStatus(
  sessionId: string,
): Promise<{ agentId: string | null; status: string } | null> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession) return null;
  return { agentId: agentSession.id, status: agentSession.status };
}

/** Stops every live agent — used on shutdown so none are orphaned in Agora. */
export async function stopAllAgents(): Promise<void> {
  await Promise.allSettled(
    [...liveAgents.keys()].map((sessionId) => stopAgent(sessionId)),
  );
}
