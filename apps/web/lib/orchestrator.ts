/**
 * Typed client for the orchestration backend.
 *
 * Everything the classroom UI knows about roles, the floor, quizzes, and gaps
 * comes through here. Agora's own SDKs stay responsible for audio and for the
 * agent's transcript stream; this module covers the control path (PS31 §2).
 */

import type {
  ClassroomEvent,
  LearningGap,
  Role,
  RoomState,
  SessionReport,
  TeacherCommand,
  TranscriptSegment,
  CatchupReply,
  CatchupMessage,
  ActiveWhiteboard,
  BoardElement,
  BoardFile,
  WhiteboardJoin,
  LibraryBook,
  LibraryPublicState,
  LibrarySearchResult,
} from '@echosphere/shared-types';

import { getAccessToken } from './supabase';

const BASE =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:8787';

export interface SessionSummary {
  sessionId: string;
  channel: string;
  title: string;
  createdAt: number;
  endedAt: number | null;
  participantCount: number;
  agentId: string | null;
}

/** What a participant needs to connect to Agora, issued only after joining. */
export interface JoinResult {
  participantId: string;
  uid: string;
  channel: string;
  rtcToken: string;
  rtmToken: string;
  appId: string;
  agentUid: string;
  role: Role;
  sessionId: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Attached whenever a teacher happens to be signed in, and simply absent
  // otherwise — students have no account and must keep working untouched. The
  // orchestrator treats a missing token as an anonymous caller, so this is
  // additive: it upgrades a request from anonymous to owned rather than being
  // a precondition for one.
  const token = await getAccessToken();

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    // A rejected command (409) carries its reason in `detail`, a bad request in
    // `error` — surface whichever is present rather than a bare status code.
    throw new Error(
      body.error ??
        body.detail ??
        `${init?.method ?? 'GET'} ${path} failed with ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export const orchestrator = {
  baseUrl: BASE,

  health: () =>
    request<{
      ok: boolean;
      sessions: number;
      /** Raw LLM_MODEL env value. */
      modelConfigured: string;
      /** What the agent actually runs; differs when LLM_MODEL is unsupported. */
      modelResolved: string;
      modelSupported: boolean;
      stt: string;
    }>('/health'),

  listSessions: () => request<SessionSummary[]>('/api/sessions'),

  createSession: (title: string, seed?: 'unlike-fractions') =>
    request<SessionSummary>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title, seed }),
    }),

  getRoom: (sessionId: string) =>
    request<RoomState>(`/api/sessions/${sessionId}`),

  join: (
    sessionId: string,
    body: { displayName: string; role: Role; preferredLanguage?: string },
  ) =>
    request<JoinResult>(`/api/sessions/${sessionId}/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  leave: (sessionId: string, participantId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/leave`, {
      method: 'POST',
      body: JSON.stringify({ participantId }),
    }),

  /**
   * Clears a leave that should not have stuck — see `leaveBeacon` below and
   * the route's own comment. Call on every mount; a no-op if nothing needed
   * undoing.
   */
  resume: (sessionId: string, participantId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/resume`, {
      method: 'POST',
      body: JSON.stringify({ participantId }),
    }),

  /**
   * Tells the server a participant is gone, from a page-unload handler where
   * a normal `fetch` is not reliable — the browser is free to abandon it the
   * moment the page starts tearing down. `sendBeacon` is built for exactly
   * this: the browser guarantees the request is sent even as the page goes
   * away, at the cost of not being able to read a response, which nothing
   * here needs anyway.
   *
   * Fires on a refresh as well as a real close — the browser cannot tell
   * them apart from this event alone — so a refresh looks like a departure
   * for a moment. `resume` above is what undoes that once the page comes
   * back, which is why every mount calls it unconditionally.
   */
  leaveBeacon: (sessionId: string, participantId: string): void => {
    try {
      navigator.sendBeacon(
        `${BASE}/api/sessions/${sessionId}/leave`,
        new Blob([JSON.stringify({ participantId })], {
          type: 'application/json',
        }),
      );
    } catch {
      // Best-effort: a browser without sendBeacon just keeps the old
      // behaviour of relying on an explicit "Leave" click.
    }
  },

  startAgent: (sessionId: string, participantId: string) =>
    request<{ agentId: string; state: string }>(
      `/api/sessions/${sessionId}/agent/start`,
      { method: 'POST', body: JSON.stringify({ participantId }) },
    ),

  stopAgent: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/agent/stop`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /**
   * Short-lived Anam session token for the silent video overlay. Throws
   * (501) if Anam isn't configured on this deployment — callers should
   * treat that as "fall back to the Lottie loop," not a hard error.
   */
  getAnamToken: (sessionId: string) =>
    request<{ sessionToken: string }>(`/api/sessions/${sessionId}/anam-token`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /**
   * Relays one transcript segment from the browser's RTM stream to the
   * orchestrator. Agora's RTM has no server SDK, so the browser is the only
   * place these events can be observed — see the relay note in ClassroomRoom.
   */
  postTranscript: (
    sessionId: string,
    body: {
      uid: string;
      text: string;
      isFinal: boolean;
      turnId?: number;
      language?: string;
      /** How sure the relay was of `uid` — see TranscriptSegment. */
      attributionConfidence?: number;
    },
  ) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/transcript`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Relays the engine's agent state so the orchestrator can enforce §3.3.
   *
   * ConvoAI never asks permission before replying, so this is the orchestrator's
   * only chance to stop a turn it did not authorise.
   */
  postAgentState: (sessionId: string, state: string) =>
    request<{ interrupted: boolean }>(`/api/sessions/${sessionId}/agent-state`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    }),

  /** Fetches the participant-scoped local board state. */
  getWhiteboard: (sessionId: string, participantId: string) =>
    request<WhiteboardJoin>(
      `/api/sessions/${sessionId}/whiteboard?participantId=${encodeURIComponent(participantId)}`,
    ),

  presentWhiteboard: (sessionId: string, participantId: string, presenting: boolean) =>
    request<{ ok: true; presenting: ActiveWhiteboard | null }>(
      `/api/sessions/${sessionId}/whiteboard/present`,
      { method: 'POST', body: JSON.stringify({ participantId, presenting }) },
    ),

  pushBoardScene: (
    sessionId: string,
    participantId: string,
    elements: BoardElement[],
    files: BoardFile[] = [],
  ) =>
    request<{ ok: true; count: number }>(
      `/api/sessions/${sessionId}/whiteboard/scene`,
      {
        method: 'POST',
        body: JSON.stringify({
          participantId,
          elements,
          ...(files.length > 0 ? { files } : {}),
        }),
      },
    ),

  // ─── 3D Model Presentation ──────────────────────────────────────────────

  /**
   * Present (or stop presenting) a 3D model to the whole room — mirrors
   * presentWhiteboard. Pass a modelId (from lib/models3d.ts) to start, or
   * null to stop.
   */
  presentModel: (sessionId: string, participantId: string, modelId: string | null) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/model/present`, {
      method: 'POST',
      body: JSON.stringify({ participantId, modelId }),
    }),

  askCatchup: (sessionId: string, participantId: string, text: string) =>
    request<CatchupReply>(`/api/sessions/${sessionId}/catchup`, {
      method: 'POST',
      body: JSON.stringify({ participantId, text }),
    }),

  getCatchup: (sessionId: string, participantId: string) =>
    request<{ history: CatchupMessage[] }>(
      `/api/sessions/${sessionId}/catchup?participantId=${encodeURIComponent(participantId)}`,
    ),

  getTranscript: (sessionId: string) =>
    request<TranscriptSegment[]>(`/api/sessions/${sessionId}/transcript`),

  sendCommand: (
    sessionId: string,
    participantId: string,
    command: TeacherCommand,
  ) =>
    request<{ ok: boolean; detail?: string }>(
      `/api/sessions/${sessionId}/command`,
      { method: 'POST', body: JSON.stringify({ participantId, command }) },
    ),

  uploadLesson: (
    sessionId: string,
    participantId: string,
    source: string,
    text: string,
  ) =>
    request<{
      source: string;
      chunks: number;
      appliedToAgent: boolean;
      topics: string[];
    }>(
      `/api/sessions/${sessionId}/lesson`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, source, text }),
      },
    ),

  getLesson: (sessionId: string) =>
    request<{ chunks: number; topics: string[]; sources: string[] }>(
      `/api/sessions/${sessionId}/lesson`,
    ),

  startQuiz: (
    sessionId: string,
    participantId: string,
    topic: string,
    targetStudentIds?: string[],
  ) =>
    request<{ ok: boolean; detail?: string }>(`/api/sessions/${sessionId}/quiz`, {
      method: 'POST',
      body: JSON.stringify({ participantId, topic, targetStudentIds }),
    }),

  answerQuiz: (
    sessionId: string,
    quizId: string,
    participantId: string,
    answer: string,
    via: 'ui' | 'voice' = 'ui',
  ) =>
    request<{ ok: boolean; detail?: string }>(
      `/api/sessions/${sessionId}/quiz/${quizId}/answer`,
      { method: 'POST', body: JSON.stringify({ participantId, answer, via }) },
    ),

  getGaps: (sessionId: string, participantId: string) =>
    request<Array<LearningGap & { severity: 'low' | 'medium' | 'high' }>>(
      `/api/sessions/${sessionId}/gaps?participantId=${encodeURIComponent(participantId)}`,
    ),

  getReport: (sessionId: string, participantId: string) =>
    request<SessionReport>(
      `/api/sessions/${sessionId}/report?participantId=${encodeURIComponent(participantId)}`,
    ),

  catchupChat: (sessionId: string, participantId: string, text: string) =>
    request<CatchupReply>(`/api/sessions/${sessionId}/catchup`, {
      method: 'POST',
      body: JSON.stringify({ participantId, text }),
    }),

  // ─── Shared Workspace & Sticky Notes (Miro Integration) ───────────────────

  getWorkspace: (sessionId: string) =>
    request<import('@echosphere/shared-types').MiroWorkspaceState>(
      `/api/sessions/${sessionId}/workspace`,
    ),

  addStickyNote: (
    sessionId: string,
    payload: {
      topic?: string;
      content: string;
      category?: import('@echosphere/shared-types').StickyNoteCategory;
      color?: import('@echosphere/shared-types').StickyNoteColor;
      authorName?: string;
      authorRole?: 'athena' | 'teacher' | 'student';
      authorParticipantId?: string;
      tags?: string[];
    },
  ) =>
    request<import('@echosphere/shared-types').MiroStickyNote>(
      `/api/sessions/${sessionId}/workspace/notes`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  updateStickyNote: (
    sessionId: string,
    noteId: string,
    patch: Partial<import('@echosphere/shared-types').MiroStickyNote>,
  ) =>
    request<import('@echosphere/shared-types').MiroStickyNote>(
      `/api/sessions/${sessionId}/workspace/notes/${noteId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  voteStickyNote: (sessionId: string, noteId: string, participantId: string) =>
    request<import('@echosphere/shared-types').MiroStickyNote>(
      `/api/sessions/${sessionId}/workspace/notes/${noteId}/vote`,
      { method: 'POST', body: JSON.stringify({ participantId }) },
    ),

  resolveStickyNote: (
    sessionId: string,
    noteId: string,
    status: import('@echosphere/shared-types').StickyNoteStatus,
  ) =>
    request<import('@echosphere/shared-types').MiroStickyNote>(
      `/api/sessions/${sessionId}/workspace/notes/${noteId}/resolve`,
      { method: 'POST', body: JSON.stringify({ status }) },
    ),

  deleteStickyNote: (sessionId: string, noteId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/workspace/notes/${noteId}`, {
      method: 'DELETE',
    }),

  explainStickyNote: (sessionId: string, noteId: string) =>
    request<{ ok: boolean; note: import('@echosphere/shared-types').MiroStickyNote }>(
      `/api/sessions/${sessionId}/workspace/notes/${noteId}/explain`,
      { method: 'POST' },
    ),

  // ─── Nobody Left Behind: Absent-Student Packet ─────────────────────────────

  getAbsentPacket: (sessionId: string) =>
    request<import('@echosphere/shared-types').AbsentStudentPacket>(
      `/api/sessions/${sessionId}/absent-packet`,
    ),

  dispatchAbsentPacket: (
    sessionId: string,
    payload: import('@echosphere/shared-types').AbsentDispatchPayload,
  ) =>
    request<import('@echosphere/shared-types').AbsentDispatchResult>(
      `/api/sessions/${sessionId}/absent-packet/dispatch`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  // ─── Nobody Left Behind: Socratic AI Teaching Assistant for Weaker Students ──

  askTeachingAssistant: (
    sessionId: string,
    payload: import('@echosphere/shared-types').TeachingAssistantRequest,
  ) =>
    request<import('@echosphere/shared-types').TeachingAssistantResponse>(
      `/api/sessions/${sessionId}/teaching-assistant/help`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  // ─── Nobody Left Behind: Targeted Reading (Teacher-Approved) ───────────────

  getTargetedReadings: (sessionId: string) =>
    request<import('@echosphere/shared-types').TargetedReadingItem[]>(
      `/api/sessions/${sessionId}/targeted-readings`,
    ),

  approveTargetedReading: (sessionId: string, readingId: string, participantId: string) =>
    request<import('@echosphere/shared-types').TargetedReadingItem>(
      `/api/sessions/${sessionId}/targeted-readings/${readingId}/approve`,
      { method: 'POST', body: JSON.stringify({ participantId }) },
    ),

  rejectTargetedReading: (sessionId: string, readingId: string, participantId: string) =>
    request<{ ok: boolean }>(
      `/api/sessions/${sessionId}/targeted-readings/${readingId}/reject`,
      { method: 'POST', body: JSON.stringify({ participantId }) },
    ),

  // ─── Nobody Left Behind: Catch-up Sessions from Real Availability ──────────

  getCatchupSlots: (sessionId: string) =>
    request<import('@echosphere/shared-types').CatchupAvailabilitySlot[]>(
      `/api/sessions/${sessionId}/catchup-slots`,
    ),

  bookCatchupSlot: (
    sessionId: string,
    booking: import('@echosphere/shared-types').CatchupBookingRequest,
  ) =>
    request<import('@echosphere/shared-types').CatchupAvailabilitySlot>(
      `/api/sessions/${sessionId}/catchup-slots/book`,
      { method: 'POST', body: JSON.stringify(booking) },
    ),

  createCatchupSlot: (
    sessionId: string,
    slotData: { date: string; startTime: string; endTime: string; teacherName?: string },
  ) =>
    request<import('@echosphere/shared-types').CatchupAvailabilitySlot>(
      `/api/sessions/${sessionId}/catchup-slots/create`,
      { method: 'POST', body: JSON.stringify(slotData) },
    ),

  cancelCatchupSlot: (sessionId: string, slotId: string) =>
    request<import('@echosphere/shared-types').CatchupAvailabilitySlot>(
      `/api/sessions/${sessionId}/catchup-slots/${slotId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  // ─── Hand-Raise Control Plane Signal ───────────────────────────────────────

  raiseHand: (sessionId: string, participantId: string, raised: boolean) =>
    request<{ ok: boolean; raisedHands: string[] }>(`/api/sessions/${sessionId}/hand-raise`, {
      method: 'POST',
      body: JSON.stringify({ participantId, raised }),
    }),
    
  // ─── Screen Sharing ────────────────────────────────────────────────

  setScreenSharePermission: (
    sessionId: string,
    participantId: string,
    targetParticipantId: string,
    allowed: boolean,
  ) =>
    request<{ ok: boolean; screenShareAllowed: string[] }>(
      `/api/sessions/${sessionId}/screen-share-permission`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, targetParticipantId, allowed }),
      },
    ),

  setScreenSharing: (sessionId: string, participantId: string, sharing: boolean) =>
    request<{
      ok: boolean;
      activeScreenShare: { participantId: string; displayName: string } | null;
    }>(`/api/sessions/${sessionId}/screen-share`, {
      method: 'POST',
      body: JSON.stringify({ participantId, sharing }),
    }),

  // ─── Multilingual Real-Time Translation & Language Mode ───────────────────

  setLanguage: (
    sessionId: string,
    participantId: string,
    language: import('@echosphere/shared-types').LanguageCode,
  ) =>
    request<{ ok: boolean; language: import('@echosphere/shared-types').LanguageCode }>(
      `/api/sessions/${sessionId}/language`,
      { method: 'POST', body: JSON.stringify({ participantId, language }) },
    ),

  translateText: (
    sessionId: string,
    text: string,
    targetLanguage: import('@echosphere/shared-types').LanguageCode,
    sourceLanguage?: import('@echosphere/shared-types').LanguageCode,
  ) =>
    request<{ original: string; translated: string; language: string }>(
      `/api/sessions/${sessionId}/translate`,
      { method: 'POST', body: JSON.stringify({ text, targetLanguage, sourceLanguage }) },
    ),

  // ─── Digital Library (Synced Textbook & Athena Citations) ─────────────────

  getLibrary: (sessionId: string) =>
    request<{
      library: LibraryPublicState;
      book: LibraryBook;
      books: LibraryBook[];
    }>(`/api/sessions/${sessionId}/library`),

  getLibraryBooks: (sessionId: string) =>
    request<{ books: LibraryBook[] }>(`/api/sessions/${sessionId}/library/books`),

  addLibraryBook: (sessionId: string, participantId: string, book: LibraryBook) =>
    request<{ ok: boolean; book: LibraryBook }>(
      `/api/sessions/${sessionId}/library/books`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, book }),
      },
    ),

  removeLibraryBook: (sessionId: string, participantId: string, bookId: string) =>
    request<{ ok: boolean }>(
      `/api/sessions/${sessionId}/library/books/${bookId}?participantId=${encodeURIComponent(participantId)}`,
      {
        method: 'DELETE',
      },
    ),

  openLibraryBook: (sessionId: string, participantId: string, bookId: string) =>
    request<{ ok: boolean; state: LibraryPublicState }>(
      `/api/sessions/${sessionId}/library/open`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, bookId }),
      },
    ),

  turnLibraryPage: (
    sessionId: string,
    participantId: string,
    page: number,
    bookId?: string,
    glow?: boolean,
  ) =>
    request<{ ok: boolean; state: LibraryPublicState }>(
      `/api/sessions/${sessionId}/library/turn`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, page, bookId, glow }),
      },
    ),

  lockLibrary: (sessionId: string, participantId: string, locked: boolean) =>
    request<{ ok: boolean; isLocked: boolean }>(
      `/api/sessions/${sessionId}/library/lock`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, locked }),
      },
    ),

  presentLibrary: (sessionId: string, participantId: string, presenting: boolean) =>
    request<{ ok: boolean; isPresenting: boolean }>(
      `/api/sessions/${sessionId}/library/present`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, presenting }),
      },
    ),

  findLibraryPage: (sessionId: string, query: string, bookId?: string) =>
    request<{ result: LibrarySearchResult | null }>(
      `/api/sessions/${sessionId}/library/search?q=${encodeURIComponent(query)}${bookId ? `&bookId=${encodeURIComponent(bookId)}` : ''}`,
    ),

  /**
   * The exact system prompt the agent is running with. Useful for showing that
   * a proficiency change or a lesson upload actually reached the agent, since
   * with no custom LLM endpoint the prompt is where all of that lives.
   */
  getPrompt: (sessionId: string) =>
    request<{
      prompt: string;
      characters: number;
      lessonChunks: number;
      students: number;
    }>(`/api/sessions/${sessionId}/prompt`),

  /**
   * Opens the control-path event stream. Returns the EventSource so the caller
   * owns closing it — an un-closed stream keeps a server-side subscriber alive.
   */
  openEventStream(
    sessionId: string,
    participantId: string,
    onEvent: (event: ClassroomEvent) => void,
    onError?: (error: Event) => void,
  ): EventSource {
    const source = new EventSource(
      `${BASE}/api/sessions/${sessionId}/events?participantId=${encodeURIComponent(participantId)}`,
    );
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as ClassroomEvent);
      } catch {
        // A malformed frame must not kill the stream.
      }
    };
    if (onError) source.onerror = onError;
    return source;
  },
};

export const orchestratorClient = orchestrator;

// ─── Browser-local session identity ──────────────────────────────────────────

const STORAGE_KEY = 'echosphere.participant';

export interface StoredIdentity extends JoinResult {
  displayName: string;
}

/**
 * Persisted so a page refresh mid-lesson does not force a re-join with a new
 * uid, which would orphan the old participant in the roster.
 */
export function storeIdentity(identity: StoredIdentity): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private-mode browsers reject storage; the app still works for this tab.
  }
}

export function loadIdentity(sessionId: string): StoredIdentity | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIdentity;
    return parsed.sessionId === sessionId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}