/**
 * Subscribes to the orchestrator's control path and keeps a local mirror of the
 * classroom (PS31 §2).
 *
 * The orchestrator is authoritative for everything here — roster, floor state,
 * agent policy, quizzes, gaps, screen sharing. This hook never derives those
 * locally; it only applies the events it is sent. That way the teacher's mute
 * and the students' view of the room can never disagree.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentPolicy,
  ClassroomEvent,
  FloorSnapshot,
  LearningGap,
  ProficiencyTag,
  PublicParticipant,
  PublicQuiz,
  RoomState,
  SpeakDenialReason,
  TranscriptSegment,
  MiroWorkspaceState,
  TargetedReadingItem,
  CatchupAvailabilitySlot,
  LanguageCode,
  ActiveWhiteboard,
  ActiveModel,
  BoardElement,
  BoardFile,
  WhiteboardJoin,
  WhiteboardPublicState,
  LibraryPublicState,
  LibraryBook,
} from '@echosphere/shared-types';
import { orchestrator } from '@/lib/orchestrator';

export interface QuizCardState {
  quiz: PublicQuiz;
  /** Revealed to the teacher immediately, to students once they answer. */
  correctAnswer?: string;
  myAnswer?: string;
  myResult?: 'correct' | 'incorrect';
  /** participantId -> correct, teacher view only. */
  results: Record<string, boolean>;
}

/**
 * A diagram Athena was asked for that never reached the board.
 *
 * Kept as its own list rather than folded into `blockedAttempts`, because the
 * two mean opposite things: a blocked attempt is the floor rules working, and
 * this is a feature failing. Surfacing it at all is the point — the spoken half
 * of the turn still happens, so without a notice the only evidence is a board
 * that stays empty.
 */
export interface IllustrationFailure {
  /** Unique per entry, for React's list key. Same reasoning as BlockedAttempt. */
  id: string;
  topic: string;
  stage: 'spec' | 'excalidraw' | 'empty';
  at: number;
}

export interface BlockedAttempt {
  /**
   * Unique per entry, for React's list key. The timestamp and reason are not
   * enough on their own: one turn can be held back several times inside the
   * same millisecond, which produced two children with the same key.
   */
  id: string;
  reason: SpeakDenialReason;
  at: number;
}

export interface SuppressedIntervention {
  timestamp: number;
  text: string;
  reason: string;
  score: number;
}

/** Fires once when this student answers every question in a quiz set correctly. */
export interface CelebrationTrigger {
  topic: string;
  at: number;
}

export interface ActiveScreenShare {
  participantId: string;
  displayName: string;
}

export interface ClassroomView {
  room: RoomState | null;
  participants: PublicParticipant[];
  floor: FloorSnapshot | null;
  policy: AgentPolicy | null;
  transcript: TranscriptSegment[];
  quizzes: QuizCardState[];
  gaps: LearningGap[];
  blockedAttempts: BlockedAttempt[];
  illustrationFailures: IllustrationFailure[];
  ended: boolean;
  connected: boolean;
  recordAnswer: (quizId: string, answer: string) => void;
  suppressedInterventions: SuppressedIntervention[];
  restraintMeterState: 'listening' | 'ready' | 'held-back' | 'speaking';
  restraintScore?: number;
  celebration: CelebrationTrigger | null;
  whiteboard: WhiteboardPublicState | null;
  whiteboardJoin: WhiteboardJoin | null;
  whiteboardJoinError: string | null;
  /** Non-null while someone is presenting the board, mirroring activeScreenShare. */
  activeWhiteboard: ActiveWhiteboard | null;
  boardScene: BoardElement[];
  /** Bytes for the image elements in `boardScene`, keyed by their `fileId`. */
  boardFiles: BoardFile[];
  presentWhiteboard: (on: boolean) => Promise<void>;
  pushBoardScene: (elements: BoardElement[], files: BoardFile[]) => void;
  workspace: MiroWorkspaceState | null;
  targetedReadings: TargetedReadingItem[];
  catchupSlots: CatchupAvailabilitySlot[];
  raisedHands: string[];
  myLanguage: LanguageCode;
  toggleHandRaise: () => Promise<void>;
  changeLanguage: (lang: LanguageCode) => void;
  refreshWorkspace: () => Promise<void>;
  refreshCatchupSlots: () => Promise<void>;
  screenShareAllowed: string[];
  activeScreenShare: ActiveScreenShare | null;
  toggleScreenShare: (sharing: boolean) => Promise<void>;
  setScreenSharePermission: (targetParticipantId: string, allowed: boolean) => Promise<void>;
  /** Non-null while someone is presenting a 3D model, mirroring activeWhiteboard. */
  activeModel: ActiveModel | null;
  presentModel: (modelId: string | null) => Promise<void>;

  /** Digital Library shared state and operations. */
  library: LibraryPublicState | null;
  libraryBook: LibraryBook | null;
  libraryBooks: LibraryBook[];
  turnLibraryPage: (page: number) => Promise<void>;
  toggleLibraryLock: (locked: boolean) => Promise<void>;
  presentLibrary: (presenting: boolean) => Promise<void>;
  selectLibraryBook: (bookId: string) => Promise<void>;
  addLibraryBook: (book: LibraryBook) => Promise<void>;
  removeLibraryBook: (bookId: string) => Promise<void>;
  refreshLibrary: () => Promise<void>;
}

/** Keeps the rendered transcript bounded; the full log lives on the server. */
const MAX_TRANSCRIPT = 200;

export function useClassroom(
  sessionId: string,
  participantId: string | null,
): ClassroomView {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<PublicParticipant[]>([]);
  const [floor, setFloor] = useState<FloorSnapshot | null>(null);
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [quizzes, setQuizzes] = useState<QuizCardState[]>([]);
  const [gaps, setGaps] = useState<LearningGap[]>([]);
  const [blockedAttempts, setBlockedAttempts] = useState<BlockedAttempt[]>([]);
  // Distinguishes entries that share a timestamp and a reason.
  const blockedSeq = useRef(0);
  const [illustrationFailures, setIllustrationFailures] = useState<IllustrationFailure[]>([]);
  const illustrationSeq = useRef(0);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [suppressedInterventions, setSuppressedInterventions] = useState<SuppressedIntervention[]>([]);
  const [restraintMeterState, setRestraintMeterState] = useState<'listening' | 'ready' | 'held-back' | 'speaking'>('listening');
  const [restraintScore, setRestraintScore] = useState<number | undefined>(undefined);
  const [celebration, setCelebration] = useState<CelebrationTrigger | null>(null);
  const [whiteboard, setWhiteboard] = useState<WhiteboardPublicState | null>(null);
  const [activeWhiteboard, setActiveWhiteboard] = useState<ActiveWhiteboard | null>(null);
  const [boardScene, setBoardScene] = useState<BoardElement[]>([]);
  const [boardFiles, setBoardFiles] = useState<BoardFile[]>([]);
  const [whiteboardJoin, setWhiteboardJoin] = useState<WhiteboardJoin | null>(null);
  const [whiteboardJoinError, setWhiteboardJoinError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<MiroWorkspaceState | null>(null);
  const [targetedReadings, setTargetedReadings] = useState<TargetedReadingItem[]>([]);
  const [catchupSlots, setCatchupSlots] = useState<CatchupAvailabilitySlot[]>([]);
  const [raisedHands, setRaisedHands] = useState<string[]>([]);
  const [myLanguage, setMyLanguage] = useState<LanguageCode>('en');
  const [screenShareAllowed, setScreenShareAllowed] = useState<string[]>([]);
  const [activeScreenShare, setActiveScreenShare] = useState<ActiveScreenShare | null>(null);
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null);
  const [library, setLibrary] = useState<LibraryPublicState | null>(null);
  const activeLibraryBookId = library?.activeBookId;
  const [libraryBook, setLibraryBook] = useState<LibraryBook | null>(null);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);

  const sourceRef = useRef<EventSource | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const res = await orchestrator.getLibrary(sessionId);
      if (res.library) setLibrary(res.library);
      if (res.book) setLibraryBook(res.book);
      if (res.books) setLibraryBooks(res.books);
    } catch {
      // Ignored
    }
  }, [sessionId]);

  const apply = useCallback((event: ClassroomEvent) => {
    switch (event.kind) {
      case 'echosphere:room-state':
        setRoom(event.state);
        setParticipants(event.state.participants);
        setFloor(event.state.floor);
        setPolicy(event.state.policy);
        setEnded(event.state.endedAt !== null);
        setSuppressedInterventions(event.state.suppressedInterventions ?? []);
        setRestraintMeterState(event.state.restraintMeterState ?? 'listening');
        if (event.state.whiteboard) {
          setWhiteboard(event.state.whiteboard);
          setActiveWhiteboard(event.state.whiteboard.presenting ?? null);
          setBoardScene(event.state.whiteboard.scene ?? []);
          setBoardFiles(event.state.whiteboard.files ?? []);
        }
        if (event.state.library) {
          setLibrary(event.state.library);
          void refreshLibrary();
        }
        if (event.state.workspace) setWorkspace(event.state.workspace);
        if (event.state.targetedReadings) setTargetedReadings(event.state.targetedReadings);
        // Restored: the screen-share merge dropped these two, which is what
        // hydrates a late joiner or a reload. Without them a reloading student
        // loses their raised hand and the room's booked catch-up slots.
        if (event.state.catchupSlots) setCatchupSlots(event.state.catchupSlots);
        if (event.state.raisedHands) setRaisedHands(event.state.raisedHands);
        if (event.state.language) setMyLanguage(event.state.language);
        // No cast needed: RoomState declares both fields.
        setScreenShareAllowed(event.state.screenShareAllowed ?? []);
        setActiveScreenShare(event.state.activeScreenShare ?? null);
        setActiveModel(event.state.activeModel ?? null);
        break;

      case 'echosphere:participant-joined':
        setParticipants((prev) =>
          prev.some((p) => p.participantId === event.participant.participantId)
            ? prev.map((p) =>
                p.participantId === event.participant.participantId
                  ? event.participant
                  : p,
              )
            : [...prev, event.participant],
        );
        break;

      case 'echosphere:participant-left':
        setParticipants((prev) =>
          prev.filter((p) => p.participantId !== event.participantId),
        );
        break;

      case 'echosphere:floor-changed':
        setFloor(event.floor);
        break;

      case 'echosphere:policy-changed':
        setPolicy(event.policy);
        break;

      case 'echosphere:agent-blocked': {
        // Numbered outside the updater, which must stay pure.
        blockedSeq.current += 1;
        const id = `${event.at}-${event.reason}-${blockedSeq.current}`;
        setBlockedAttempts((prev) =>
          [...prev, { id, reason: event.reason, at: event.at }].slice(-12),
        );
        break;
      }

      case 'echosphere:illustration-failed': {
        illustrationSeq.current += 1;
        const id = `${event.at}-${event.stage}-${illustrationSeq.current}`;
        setIllustrationFailures((prev) =>
          [...prev, { id, topic: event.topic, stage: event.stage, at: event.at }].slice(-12),
        );
        break;
      }

      case 'echosphere:transcript':
        setTranscript((prev) => {
          const i = prev.findIndex((s) => s.segmentId === event.segment.segmentId);
          if (i === -1) {
            return [...prev, event.segment].slice(-MAX_TRANSCRIPT);
          }
          // Same segmentId reaching here twice means one of two different
          // things, and only one of them is a no-op. A reconnect can replay
          // an event the client still holds unchanged — nothing to do. But
          // the server also deliberately republishes the SAME segmentId with
          // longer text as a turn grows across relays (`republishTurn` in
          // classroomController.ts, upsertByTurn's whole reason to exist),
          // which used to be silently dropped here: this checked existence,
          // not content, so "And" — the first fragment of "And yep, that's
          // it, could you take it forward?" — stayed on screen forever while
          // the server's own transcript store had the completed sentence.
          // Replacing in place rather than appending is what keeps a
          // corrected turn from also showing up as a second, duplicate line.
          if (prev[i].text === event.segment.text) return prev;
          const next = [...prev];
          next[i] = event.segment;
          return next;
        });
        break;

      case 'echosphere:quiz-issued':
        setQuizzes((prev) =>
          prev.some((q) => q.quiz.quizId === event.quiz.quizId)
            ? // Re-issued rather than new: the server pushed the deadline out
              // once the agent finished reading the options aloud, so the
              // countdown restarts against the window it is really holding us
              // to. Everything already on the card is kept.
              prev.map((q) =>
                q.quiz.quizId === event.quiz.quizId
                  ? { ...q, quiz: { ...q.quiz, deadline: event.quiz.deadline } }
                  : q,
              )
            : [...prev, { quiz: event.quiz, results: {} }],
        );
        break;

      case 'echosphere:quiz-closed':
        setQuizzes((prev) =>
          prev.map((q) =>
            q.quiz.quizId === event.quizId
              ? { ...q, correctAnswer: event.correctAnswer }
              : q,
          ),
        );
        break;

      case 'echosphere:quiz-result':
        setQuizzes((prev) =>
          prev.map((q) => {
            if (q.quiz.quizId !== event.quizId) return q;
            const mine = event.participantId === participantId;
            return {
              ...q,
              results: { ...q.results, [event.participantId]: event.correct },
              myResult: mine
                ? event.correct
                  ? 'correct'
                  : 'incorrect'
                : q.myResult,
              // An answer spoken out loud is scored on the server, so this is
              // the only way it ever reaches the card. Without it a student who
              // said the right answer saw nothing of theirs marked and then
              // watched the correct option light up on its own.
              myAnswer: mine && event.answer !== undefined ? event.answer : q.myAnswer,
            };
          }),
        );
        break;

      case 'echosphere:gap-detected':
        setGaps((prev) => {
          const next = prev.filter((g) => g.gapId !== event.gap.gapId);
          return [...next, event.gap].sort(
            (a, b) =>
              b.affectedStudentIds.length - a.affectedStudentIds.length ||
              b.lastSeenAt - a.lastSeenAt,
          );
        });
        break;

      case 'echosphere:proficiency-changed':
        setParticipants((prev) =>
          prev.map((p) =>
            p.participantId === event.participantId
              ? { ...p, proficiency: event.proficiency as ProficiencyTag }
              : p,
          ),
        );
        break;

      case 'echosphere:session-ended':
        setEnded(true);
        break;

      case 'echosphere:restraint-meter-changed':
        setRestraintMeterState(event.state);
        setRestraintScore(event.score);
        break;

      case 'echosphere:intervention-suppressed':
        setSuppressedInterventions((prev) =>
          [
            ...prev,
            {
              timestamp: event.timestamp,
              text: event.text,
              reason: event.reason,
              score: event.score,
            },
          ].slice(-50),
        );
        break;

      case 'echosphere:quiz-set-perfect':
        // publishTo already scoped this to just this student on the server,
        // so no participantId check is needed here.
        setCelebration({ topic: event.topic, at: Date.now() });
        break;

      case 'echosphere:command':
        // Commands are applied server-side; the resulting policy/floor events
        // carry the effect. Nothing to mirror here.
        break;

      case 'echosphere:whiteboard':
        setWhiteboard(event.board);
        break;

      case 'echosphere:whiteboard-started':
        setActiveWhiteboard(event.presenter);
        break;

      case 'echosphere:whiteboard-stopped':
        setActiveWhiteboard(null);
        break;

      case 'echosphere:whiteboard-scene':
        // Never apply your own edits coming back. A freehand stroke is one
        // element whose points grow as you drag, so the copy the server echoes
        // is always older than what is under the pointer — feeding it back
        // rewound the stroke to its first point every tick, which is why a drag
        // rendered as a single dot. The author already has these elements.
        if (event.by === participantId) break;
        // Files carry no version — an id is minted per insert and its bytes
        // never change — so first copy wins and repeats are ignored.
        if (event.files?.length) {
          setBoardFiles((prev) => {
            const known = new Set(prev.map((f) => f.id));
            const added = event.files!.filter((f) => !known.has(f.id));
            return added.length > 0 ? [...prev, ...added] : prev;
          });
        }
        // Merged the same way the orchestrator does, by element version, so a
        // client that missed a message cannot drop strokes it never saw.
        setBoardScene((prev) => {
          const byId = new Map(prev.map((el) => [el.id, el]));
          for (const el of event.elements) {
            const existing = byId.get(el.id);
            if (!existing || el.version >= existing.version) byId.set(el.id, el);
          }
          return [...byId.values()];
        });
        break;

      case 'echosphere:whiteboard-command':
        // The board's own state event carries the result; this exists so the
        // teacher's tab can act as the writer without re-deriving intent.
        break;

      case 'echosphere:workspace-changed':
        setWorkspace(event.workspace);
        break;

      case 'echosphere:sticky-note-added':
        setWorkspace((prev) =>
          prev
            ? { ...prev, notes: [event.note, ...prev.notes.filter((n) => n.id !== event.note.id)] }
            : null,
        );
        break;

      case 'echosphere:sticky-note-updated':
        setWorkspace((prev) =>
          prev
            ? { ...prev, notes: prev.notes.map((n) => (n.id === event.note.id ? event.note : n)) }
            : null,
        );
        break;

      case 'echosphere:targeted-reading-updated':
        setTargetedReadings(event.items);
        break;

      case 'echosphere:catchup-slots-updated':
        setCatchupSlots(event.slots);
        break;

      case 'echosphere:hand-raised':
        setRaisedHands((prev) => [...new Set([...prev, event.participantId])]);
        break;

      case 'echosphere:hand-lowered':
        setRaisedHands((prev) => prev.filter((id) => id !== event.participantId));
        break;

      case 'echosphere:language-changed':
        setParticipants((prev) =>
          prev.map((p) =>
            p.participantId === event.participantId ? { ...p, language: event.language } : p,
          ),
        );
        setMyLanguage(event.language);
        break;

      case 'echosphere:screen-share-permission-changed':
        setScreenShareAllowed((prev) =>
          event.allowed
            ? [...new Set([...prev, event.participantId])]
            : prev.filter((id) => id !== event.participantId),
        );
        break;

      case 'echosphere:screen-share-started':
        setActiveScreenShare({
          participantId: event.participantId,
          displayName: event.displayName,
        });
        break;

      case 'echosphere:screen-share-stopped':
        setActiveScreenShare((prev) =>
          prev?.participantId === event.participantId ? null : prev,
        );
        break;

      case 'echosphere:model-started':
        setActiveModel(event.presenter);
        break;

      case 'echosphere:model-stopped':
        setActiveModel((prev) =>
          prev?.participantId === event.participantId ? null : prev,
        );
        break;

      case 'echosphere:library-state':
        setLibrary(event.state);
        if (event.state?.activeBookId) {
          setLibraryBooks((prev) => {
            const found = prev.find((b) => b.id === event.state.activeBookId);
            if (found) setLibraryBook(found);
            return prev;
          });
          void refreshLibrary();
        }
        break;

      case 'echosphere:library-open':
        setLibrary((prev) =>
          prev
            ? {
                ...prev,
                activeBookId: event.payload.bookId,
                currentPage: 0,
              }
            : {
                activeBookId: event.payload.bookId,
                currentPage: 0,
                isLocked: true,
                isPresenting: false,
                presenterId: null,
                lastSequence: 0,
                glowPage: null,
              },
        );
        setLibraryBooks((prev) => {
          const found = prev.find((b) => b.id === event.payload.bookId);
          if (found) setLibraryBook(found);
          return prev;
        });
        void refreshLibrary();
        break;

      case 'echosphere:library-book-added':
        setLibraryBooks((prev) => {
          const filtered = prev.filter((b) => b.id !== event.payload.bookId);
          return [...filtered, event.payload.book];
        });
        setLibraryBook((prev) => (!prev || prev.id === event.payload.bookId ? event.payload.book : prev));
        void refreshLibrary();
        break;

      case 'echosphere:library-book-removed':
        setLibraryBooks((prev) => prev.filter((b) => b.id !== event.payload.bookId));
        setLibraryBook((prev) => (prev?.id === event.payload.bookId ? null : prev));
        void refreshLibrary();
        break;

      case 'echosphere:library-page':
        setLibrary((prev) =>
          prev
            ? {
                ...prev,
                activeBookId: event.payload.bookId,
                currentPage: event.payload.page,
                lastSequence: Math.max(prev.lastSequence, event.payload.seq),
                glowPage: event.payload.glow ? event.payload.page : null,
              }
            : null,
        );
        break;

      case 'echosphere:library-lock':
        setLibrary((prev) =>
          prev
            ? {
                ...prev,
                isLocked: event.payload.locked,
              }
            : null,
        );
        break;

      case 'echosphere:library-present':
        setLibrary((prev) =>
          prev
            ? {
                ...prev,
                isPresenting: event.payload.presenting,
                presenterId: event.payload.presenterId,
              }
            : null,
        );
        break;

      case 'echosphere:library-student-position':
        setLibrary((prev) => {
          if (!prev) return null;
          const currentPositions = prev.studentPositions || {};
          return {
            ...prev,
            studentPositions: {
              ...currentPositions,
              [event.position.participantId]: event.position,
            },
          };
        });
        break;
    }
  }, [participantId, refreshLibrary]);

  useEffect(() => {
    if (!participantId) return;

    let cancelled = false;
    void orchestrator
      .getTranscript(sessionId)
      .then((history) => {
        if (cancelled || history.length === 0) return;
        setTranscript((prev) => {
          if (prev.length > 0) return prev;
          return history.slice(-MAX_TRANSCRIPT);
        });
      })
      .catch(() => undefined);

    const source = orchestrator.openEventStream(
      sessionId,
      participantId,
      (event) => {
        setConnected(true);
        apply(event);
      },
      () => setConnected(false),
    );
    sourceRef.current = source;
    source.onopen = () => setConnected(true);

    return () => {
      cancelled = true;
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [sessionId, participantId, apply]);

  const toggleHandRaise = useCallback(async () => {
    if (!participantId) return;
    const isCurrentlyRaised = raisedHands.includes(participantId);
    try {
      await orchestrator.raiseHand(sessionId, participantId, !isCurrentlyRaised);
    } catch (err) {
      console.error('Hand raise failed', err);
    }
  }, [sessionId, participantId, raisedHands]);

  const changeLanguage = useCallback(
    (lang: LanguageCode) => {
      setMyLanguage(lang);
      if (!participantId) return;
      orchestrator.setLanguage(sessionId, participantId, lang).catch((err) => {
        console.error('Failed to set language on server', err);
      });
    },
    [sessionId, participantId],
  );

  // Fetch the participant-scoped local board state when the board opens.
  useEffect(() => {
    if (!participantId || !whiteboard?.open) {
      setWhiteboardJoin(null);
      return;
    }
    let cancelled = false;
    void orchestrator
      .getWhiteboard(sessionId, participantId)
      .then((payload) => {
        if (cancelled) return;
        setWhiteboardJoin(payload);
        setWhiteboardJoinError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setWhiteboardJoinError(
          err instanceof Error ? err.message : 'Could not join the board',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, participantId, whiteboard?.open]);

  const presentWhiteboard = useCallback(
    async (on: boolean) => {
      if (!participantId) return;
      await orchestrator.presentWhiteboard(sessionId, participantId, on).catch(() => undefined);
    },
    [sessionId, participantId],
  );

  const pushBoardScene = useCallback(
    (elements: BoardElement[], files: BoardFile[]) => {
      if (!participantId) return;
      void orchestrator
        .pushBoardScene(sessionId, participantId, elements, files)
        .catch(() => undefined);
    },
    [sessionId, participantId],
  );

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await orchestrator.getWorkspace(sessionId);
      setWorkspace(ws);
    } catch {
      // Ignored
    }
  }, [sessionId]);

  const refreshCatchupSlots = useCallback(async () => {
    try {
      const slots = await orchestrator.getCatchupSlots(sessionId);
      setCatchupSlots(slots);
    } catch {
      // Ignored
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // Reactive synchronization: ensure libraryBook is always matched with library.activeBookId
  useEffect(() => {
    if (!library?.activeBookId) return;
    const found = libraryBooks.find((b) => b.id === library.activeBookId);
    if (found) {
      setLibraryBook((current) => (current?.id === found.id ? current : found));
    } else {
      void refreshLibrary();
    }
  }, [library?.activeBookId, libraryBooks, refreshLibrary]);

  const selectLibraryBook = useCallback(
    async (bookId: string) => {
      setLibraryBooks((prev) => {
        const found = prev.find((b) => b.id === bookId);
        if (found) {
          setLibraryBook(found);
        }
        return prev;
      });
      setLibrary((prev) => (prev ? { ...prev, activeBookId: bookId, currentPage: 0 } : null));
      if (!participantId) return;
      try {
        const res = await orchestrator.openLibraryBook(sessionId, participantId, bookId);
        if (res?.state) setLibrary(res.state);
        await refreshLibrary();
      } catch (err) {
        console.error('Select library book failed', err);
      }
    },
    [sessionId, participantId, refreshLibrary],
  );

  const addLibraryBook = useCallback(
    async (book: LibraryBook) => {
      setLibraryBooks((prev) => {
        const filtered = prev.filter((b) => b.id !== book.id);
        return [...filtered, book];
      });
      setLibraryBook(book);
      if (!participantId) return;
      try {
        await orchestrator.addLibraryBook(sessionId, participantId, book);
        await refreshLibrary();
      } catch (err) {
        console.error('Add library book failed', err);
        throw err;
      }
    },
    [sessionId, participantId, refreshLibrary],
  );

  const removeLibraryBook = useCallback(
    async (bookId: string) => {
      setLibraryBooks((prev) => prev.filter((b) => b.id !== bookId));
      if (!participantId) return;
      try {
        await orchestrator.removeLibraryBook(sessionId, participantId, bookId);
        await refreshLibrary();
      } catch (err) {
        console.error('Remove library book failed', err);
        throw err;
      }
    },
    [sessionId, participantId, refreshLibrary],
  );

  const turnLibraryPage = useCallback(
    async (page: number) => {
      setLibrary((prev) => (prev ? { ...prev, currentPage: page } : null));
      if (!participantId) return;
      try {
        const res = await orchestrator.turnLibraryPage(sessionId, participantId, page, activeLibraryBookId);
        if (res?.state) setLibrary(res.state);
      } catch (err) {
        console.error('Turn library page failed', err);
      }
    },
    [sessionId, participantId, activeLibraryBookId],
  );

  const toggleLibraryLock = useCallback(
    async (locked: boolean) => {
      if (!participantId) return;
      try {
        const res = await orchestrator.lockLibrary(sessionId, participantId, locked);
        setLibrary((prev) => (prev ? { ...prev, isLocked: res.isLocked } : null));
      } catch (err) {
        console.error('Toggle library lock failed', err);
      }
    },
    [sessionId, participantId],
  );

  const presentLibrary = useCallback(
    async (presenting: boolean) => {
      if (!participantId) return;
      try {
        const res = await orchestrator.presentLibrary(sessionId, participantId, presenting);
        setLibrary((prev) => (prev ? { ...prev, isPresenting: res.isPresenting } : null));
      } catch (err) {
        console.error('Present library failed', err);
      }
    },
    [sessionId, participantId],
  );

  /** Optimistic local echo so the tapped option shows immediately. */
  const recordAnswer = useCallback((quizId: string, answer: string) => {
    setQuizzes((prev) =>
      prev.map((q) =>
        q.quiz.quizId === quizId ? { ...q, myAnswer: answer } : q,
      ),
    );
  }, []);

  const toggleScreenShare = useCallback(
    async (sharing: boolean) => {
      if (!participantId) return;
      try {
        await orchestrator.setScreenSharing(sessionId, participantId, sharing);
      } catch (err) {
        console.error('Screen share toggle failed', err);
        throw err;
      }
    },
    [sessionId, participantId],
  );

  const setScreenSharePermission = useCallback(
    async (targetParticipantId: string, allowed: boolean) => {
      if (!participantId) return;
      try {
        await orchestrator.setScreenSharePermission(
          sessionId,
          participantId,
          targetParticipantId,
          allowed,
        );
      } catch (err) {
        console.error('Screen share permission update failed', err);
      }
    },
    [sessionId, participantId],
  );

  const presentModel = useCallback(
    async (modelId: string | null) => {
      if (!participantId) return;
      await orchestrator.presentModel(sessionId, participantId, modelId).catch((err) => {
        console.error('Failed to present 3D model', err);
      });
    },
    [sessionId, participantId],
  );

  return {
    room,
    participants,
    floor,
    policy,
    transcript,
    quizzes,
    gaps,
    blockedAttempts,
    illustrationFailures,
    ended,
    connected,
    recordAnswer,
    suppressedInterventions,
    restraintMeterState,
    restraintScore,
    celebration,
    whiteboard,
    whiteboardJoin,
    whiteboardJoinError,
    activeWhiteboard,
    boardScene,
    boardFiles,
    presentWhiteboard,
    pushBoardScene,
    workspace,
    targetedReadings,
    catchupSlots,
    raisedHands,
    myLanguage,
    toggleHandRaise,
    changeLanguage,
    refreshWorkspace,
    refreshCatchupSlots,
    screenShareAllowed,
    activeScreenShare,
    toggleScreenShare,
    setScreenSharePermission,
    activeModel,
    presentModel,
    library,
    libraryBook,
    libraryBooks,
    turnLibraryPage,
    toggleLibraryLock,
    presentLibrary,
    selectLibraryBook,
    addLibraryBook,
    removeLibraryBook,
    refreshLibrary,
  };
}
