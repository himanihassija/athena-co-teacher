/**
 * Control/data-path event envelope carried over Agora RTM.
 *
 * PS31 §2: two channels of communication matter — the audio path (Agora RTC,
 * driven by the ConvoAI engine) and the control path. This file defines the
 * control path's wire format.
 *
 * The agent's own transcript and state events already arrive on the RTM channel
 * from Agora's engine; these classroom events share that channel under a
 * distinct `kind` namespace so a single RTM subscription serves both.
 */

import type { Role, ProficiencyTag } from './identity.js';
import type {
  AgentPolicy,
  FloorSnapshot,
  TeacherCommand,
  SpeakDenialReason,
} from './floor.js';
import type { LearningGap, QuizQuestion, TranscriptSegment } from './lesson.js';
import type {
  ActiveWhiteboard,
  BoardElement,
  BoardFile,
  WhiteboardCommand,
  WhiteboardPublicState,
} from './whiteboard.js';
import type { MiroWorkspaceState, MiroStickyNote, MiroCommand } from './workspace.js';
import type { TargetedReadingItem, CatchupAvailabilitySlot, LanguageCode } from './support.js';
import type {
  LibraryPublicState,
  LibraryOpenPayload,
  LibraryPageTurnPayload,
  LibraryLockPayload,
  LibraryPresentPayload,
  LibraryBookAddedPayload,
  LibraryBookRemovedPayload,
} from './library.js';

/** Discriminator prefix so classroom events are never confused with Agora's own. */
export const ECHOSPHERE_EVENT_PREFIX = 'echosphere:' as const;

export type ClassroomEvent =
  /** Full room state, sent to a client right after it joins. */
  | { kind: 'echosphere:room-state'; state: RoomState }
  | { kind: 'echosphere:participant-joined'; participant: PublicParticipant }
  | { kind: 'echosphere:participant-left'; participantId: string }
  | { kind: 'echosphere:floor-changed'; floor: FloorSnapshot }
  | { kind: 'echosphere:policy-changed'; policy: AgentPolicy }
  /** Agent was denied the floor — shown in the teacher panel as an audit trail. */
  | { kind: 'echosphere:agent-blocked'; reason: SpeakDenialReason; at: number }
  | { kind: 'echosphere:transcript'; segment: TranscriptSegment }
  /** Quiz card to render. `correctAnswer` is stripped before broadcast. */
  | { kind: 'echosphere:quiz-issued'; quiz: PublicQuiz }
  | { kind: 'echosphere:quiz-closed'; quizId: string; correctAnswer: string }
  | {
      kind: 'echosphere:quiz-result';
      quizId: string;
      participantId: string;
      correct: boolean;
      /**
       * The option the answer resolved to, so a spoken answer shows up on the
       * card as the chosen one. Without it the overlay only ever highlighted a
       * tap, and a student who said the right answer out loud watched the card
       * reveal the correct option with nothing of theirs marked — which reads
       * as the quiz having picked an option by itself.
       *
       * Absent when the answer resolved to nothing (a blank auto-submitted at
       * expiry), because there is no option to highlight.
       */
      answer?: string;
    }
  /** Teacher-only: a new or updated learning gap. */
  | { kind: 'echosphere:gap-detected'; gap: LearningGap }
  | { kind: 'echosphere:proficiency-changed'; participantId: string; proficiency: ProficiencyTag }
    | {
      kind: 'echosphere:screen-share-permission-changed';
      participantId: string;
      allowed: boolean;
    }
  | {
      kind: 'echosphere:screen-share-started';
      participantId: string;
      displayName: string;
    }
  | { kind: 'echosphere:screen-share-stopped'; participantId: string }
  | { kind: 'echosphere:model-started'; presenter: ActiveModel }
  | { kind: 'echosphere:model-stopped'; participantId: string }
  | { kind: 'echosphere:session-ended'; sessionId: string }
  | { kind: 'echosphere:command'; command: TeacherCommand; issuedBy: string }
  | { kind: 'echosphere:restraint-meter-changed'; state: 'listening' | 'ready' | 'held-back' | 'speaking'; score?: number }
  | { kind: 'echosphere:intervention-suppressed'; timestamp: number; text: string; reason: string; score: number }
  /** A student answered every question in a quiz set correctly. Sent only to that student. */
  | { kind: 'echosphere:quiz-set-perfect'; topic: string }
  /**
   * Athena was asked to draw something and could not.
   *
   * Worth its own event because the spoken half of that turn still happened:
   * she says "here's a diagram", the picture never lands, and without this the
   * room is left looking at an empty board with nothing anywhere saying why.
   * `stage` says how far the attempt got — `spec` is the model failing to
   * decide what to draw, `excalidraw` is the drawing service refusing or timing
   * out, `empty` is a scene that came back with nothing new on it.
   */
  | {
      kind: 'echosphere:illustration-failed';
      topic: string;
      stage: 'spec' | 'excalidraw' | 'empty';
      detail: string;
      at: number;
    }
  | { kind: 'echosphere:whiteboard'; board: WhiteboardPublicState }
  /** Someone began presenting the board, the way a screen share starts. */
  | { kind: 'echosphere:whiteboard-started'; presenter: ActiveWhiteboard }
  | { kind: 'echosphere:whiteboard-stopped'; participantId: string }
  /**
   * Drawing changed. Carries only the elements that moved rather than the whole
   * scene — a stroke is a stream of small edits and resending everything would
   * saturate the bus.
   */
  | {
      kind: 'echosphere:whiteboard-scene';
      elements: BoardElement[];
      /**
       * Bytes for any newly referenced `image` element. Sent once per file
       * rather than on every scene tick — a photo is megabytes and the elements
       * around it are bytes.
       */
      files?: BoardFile[];
      by: string;
    }
  | { kind: 'echosphere:whiteboard-command'; command: WhiteboardCommand }
  | { kind: 'echosphere:workspace-changed'; workspace: MiroWorkspaceState }
  | { kind: 'echosphere:sticky-note-added'; note: MiroStickyNote }
  | { kind: 'echosphere:sticky-note-updated'; note: MiroStickyNote }
  | { kind: 'echosphere:targeted-reading-updated'; items: TargetedReadingItem[] }
  | { kind: 'echosphere:catchup-slots-updated'; slots: CatchupAvailabilitySlot[] }
  | { kind: 'echosphere:hand-raised'; participantId: string; displayName: string; at: number }
  | { kind: 'echosphere:hand-lowered'; participantId: string }
  | { kind: 'echosphere:language-changed'; participantId: string; language: LanguageCode }
  | { kind: 'echosphere:library-state'; state: LibraryPublicState }
  | { kind: 'echosphere:library-open'; payload: LibraryOpenPayload }
  | { kind: 'echosphere:library-page'; payload: LibraryPageTurnPayload }
  | { kind: 'echosphere:library-lock'; payload: LibraryLockPayload }
  | { kind: 'echosphere:library-present'; payload: LibraryPresentPayload }
  | { kind: 'echosphere:library-book-added'; payload: LibraryBookAddedPayload }
  | { kind: 'echosphere:library-book-removed'; payload: LibraryBookRemovedPayload }
  | { kind: 'echosphere:library-student-position'; position: import('./library.js').StudentReadingPosition };

/** Who is presenting a 3D model, if anyone — mirrors ActiveWhiteboard/activeScreenShare. */
export interface ActiveModel {
  participantId: string;
  displayName: string;
  modelId: string;
}

export type ClassroomEventKind = ClassroomEvent['kind'];

/** Participant view safe to broadcast to every client in the room. */
export interface PublicParticipant {
  participantId: string;
  uid: string;
  displayName: string;
  role: Role;
  proficiency?: ProficiencyTag;
  language?: LanguageCode;
  handRaised?: boolean;
}

/**
 * A quiz as students see it: the answer key is removed. Keeping this a distinct
 * type (rather than an optional field) makes it impossible to broadcast the
 * answer by forgetting to delete it.
 */
export interface PublicQuiz {
  quizId: string;
  topic: string;
  question: string;
  options?: string[];
  difficulty: QuizQuestion['difficulty'];
  targetStudentIds: string[];
  createdAt: number;
  /** Epoch ms when the question stops accepting answers — drives the countdown. */
  deadline: number;
  /** "Question 2 of 3" — present only for a multi-question set. */
  setIndex?: number;
  setTotal?: number;
}

export function toPublicQuiz(quiz: QuizQuestion): PublicQuiz {
  return {
    quizId: quiz.quizId,
    topic: quiz.topic,
    question: quiz.question,
    options: quiz.options,
    difficulty: quiz.difficulty,
    targetStudentIds: quiz.targetStudentIds,
    createdAt: quiz.createdAt,
    deadline: quiz.deadline,
    setIndex: quiz.setIndex,
    setTotal: quiz.setTotal,
  };
}

export interface RoomState {
  sessionId: string;
  channel: string;
  title: string;
  participants: PublicParticipant[];
  floor: FloorSnapshot;
  policy: AgentPolicy;
  agentId: string | null;
  agentUid: string;
  startedAt: number;
  endedAt: number | null;
  suppressedInterventions?: Array<{ timestamp: number; text: string; reason: string; score: number }>;
  restraintMeterState?: 'listening' | 'ready' | 'held-back' | 'speaking';
  workspace?: MiroWorkspaceState;
  targetedReadings?: TargetedReadingItem[];
  catchupSlots?: CatchupAvailabilitySlot[];
  raisedHands?: string[];
  /**
   * Screen-share state at join time. The live `screen-share-*` events keep an
   * open client current, but a late joiner or a reload has no event to replay —
   * without these two the client starts with empty permissions and no idea
   * anyone is already sharing.
   */
  whiteboard?: WhiteboardPublicState;
  library?: LibraryPublicState;
  screenShareAllowed?: string[];
  activeScreenShare?: { participantId: string; displayName: string } | null;
  activeModel?: ActiveModel | null;
  language?: LanguageCode;
}

export function isClassroomEvent(value: unknown): value is ClassroomEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { kind: string }).kind.startsWith(ECHOSPHERE_EVENT_PREFIX)
  );
}