/**
 * Teacher dashboard — PS31 §3.4 (lesson upload), §3.5 (per-student level),
 * §3.9 (live gap dashboard and post-class report), §3.10 (control panel).
 *
 * Same Meet-style tile stage / screen-share stage as the student view, with
 * the control panel, lesson material, workspace, targeted reading, restraint
 * meter, suppressed interventions, gap dashboard, roster, and quiz results
 * moved into a slide-out drawer so the room itself isn't buried under panels.
 *
 * Layout notes (per teacher request):
 *   - Language selector is pinned to the top-right corner of the viewport.
 *   - Transcript can be pinned as a persistent right-hand sidebar, visible
 *     alongside the room/whiteboard/screen-share stage at the same time,
 *     independent of the Menu drawer.
 *   - Absent Dispatcher and 1:1 Slots moved off the main header into the
 *     Controls tab of the Menu drawer.
 *   - Muting/unmuting Athena lives as a single mic icon on her tile in
 *     ParticipantGrid, not as separate header buttons.
 *   - Share Screen / Whiteboard / 3D Models are icon-only buttons in the
 *     header (tooltips still describe them via `title`).
 *   - Room background is the same animated space scene as the join page.
 */

'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  SessionReport,
  TeacherCommand,
  VerbosityLevel,
  InterventionRecord,
} from '@echosphere/shared-types';
import { ClassroomShell } from '@/components/classroom/ClassroomShell';
import { ClassroomAudio } from '@/components/classroom/ClassroomAudioLazy';
import { ClassroomSpaceBackground } from '@/components/ClassroomSpaceBackground';
import { TeacherControlPanel } from '@/components/classroom/TeacherControlPanel';
import {
  AgentAbsentNotice,
  BlockedAttempts,
  IllustrationFailures,
  FloorIndicator,
  GapPanel,
  QuizCards,
  RosterPanel,
  TranscriptFeed,
} from '@/components/classroom/panels';
import { ParticipantGrid } from '@/components/classroom/ParticipantGridLazy';
import { Model3DStage } from '@/components/classroom/Model3DStageLazy';
import { Model3DPicker } from '@/components/classroom/Model3DPicker';
import { TeacherToolsBag } from '@/components/classroom/TeacherToolsBag';
import { ScreenShareStage } from '@/components/classroom/ScreenShareStageLazy';
import { ExcalidrawBoard } from '@/components/classroom/ExcalidrawBoardLazy';
import { DigitalLibraryStage } from '@/components/library/DigitalLibraryStageLazy';
import { ScreenShareControls } from '@/components/classroom/ScreenShareControls';
import { ClassroomDrawer, type DrawerTab } from '@/components/classroom/ClassroomDrawer';
import { useClassroom } from '@/hooks/useClassroom';
import {
  clearIdentity,
  loadIdentity,
  orchestrator,
  type StoredIdentity,
} from '@/lib/orchestrator';
import { RestraintMeter } from '@/components/meraki/RestraintMeter';
import { SuppressedInterventionsPanel } from '@/components/meraki/SuppressedInterventionsPanel';
import { MiroWorkspacePane } from '@/components/workspace/MiroWorkspacePane';
import { AbsentStudentPacketModal } from '@/components/support/AbsentStudentPacketModal';
import { CatchupBookingModal } from '@/components/support/CatchupBookingModal';
import { LanguageSelector } from '@/components/support/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CatchupChatbot } from '@/components/classroom/CatchupChatbot';
import { t } from '@/lib/i18n';

function AppMenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
      <circle cx="3" cy="3" r="2" />
      <circle cx="9" cy="3" r="2" />
      <circle cx="15" cy="3" r="2" />
      <circle cx="3" cy="9" r="2" />
      <circle cx="9" cy="9" r="2" />
      <circle cx="15" cy="9" r="2" />
      <circle cx="3" cy="15" r="2" />
      <circle cx="9" cy="15" r="2" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScreenShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M12 8v5m0-5-2.2 2.2M12 8l2.2 2.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WhiteboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 12l3-3 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TeacherDashboardPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [showAbsentPacket, setShowAbsentPacket] = useState(false);
  const [showCatchupBooking, setShowCatchupBooking] = useState(false);
  const [showLibraryStage, setShowLibraryStage] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [speakingUid, setSpeakingUid] = useState<string | null>(null);
  const [transcriptionLive, setTranscriptionLive] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  /**
   * True while this tab is in the background.
   *
   * This browser is the room's transcript relay, and the relay runs on timers
   * the browser throttles heavily once the tab is hidden — so this is not a
   * cosmetic warning, it is the room's transcript stopping.
   */
  const [relayHidden, setRelayHidden] = useState(false);
  /**
   * Keeps the relay warning on screen briefly after the tab comes back.
   *
   * A banner shown only while hidden is a banner nobody can read. The teacher
   * needs to learn what happened at the moment they return, so the notice
   * outlives the condition by a few seconds.
   */
  const [relayWasHidden, setRelayWasHidden] = useState(false);
  useEffect(() => {
    if (relayHidden) {
      setRelayWasHidden(true);
      return;
    }
    if (!relayWasHidden) return;
    const id = setTimeout(() => setRelayWasHidden(false), 8000);
    return () => clearTimeout(id);
  }, [relayHidden, relayWasHidden]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [lessonText, setLessonText] = useState('');
  const [lessonName, setLessonName] = useState('');
  const [lessonInfo, setLessonInfo] = useState<{
    chunks: number;
    topics: string[];
    sources: string[];
  } | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('controls');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  /** Persistent right-hand transcript sidebar, independent of the Menu drawer. */
  const [transcriptPinned, setTranscriptPinned] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  /**
   * Whether Athena's one-time entrance intro has already played. Lives here,
   * not inside ParticipantGrid, because that component unmounts whenever the
   * stage switches to the whiteboard or a screen share and back — tracking
   * this locally there meant every return to the room replayed the video.
   * Defaults true so a page reload while she's already present doesn't
   * wrongly replay it; only startAgent() resets it to false.
   */
  const [introPlayed, setIntroPlayed] = useState(true);
  /**
   * Mirrors the server-side mute state locally, same pattern as micEnabled
   * and isScreenSharing elsewhere in this file. Surfaced as a single icon
   * on Athena's tile (ParticipantGrid) instead of separate Mute/Unmute
   * header buttons.
   */
  const [agentMuted, setAgentMuted] = useState(false);
  /** Which tool-bag panel (if any) is open: quiz and gaps no longer live in the Menu drawer. */
  const [activeToolPanel, setActiveToolPanel] = useState<'quiz' | 'gaps' | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stored = loadIdentity(sessionId);
    if (!stored || stored.role !== 'teacher') {
      router.replace('/join');
      return;
    }

    void orchestrator
      .resume(sessionId, stored.participantId)
      .then(() => {
        if (!cancelled) setIdentity(stored);
      })
      .catch(() => {
        if (cancelled) return;
        clearIdentity();
        router.replace('/join');
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, router]);

  const view = useClassroom(sessionId, identity?.participantId ?? null);

  const refreshLesson = useCallback(async () => {
    try {
      setLessonInfo(await orchestrator.getLesson(sessionId));
    } catch {
      // Non-fatal; the panel just shows nothing.
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshLesson();
  }, [refreshLesson]);

  const send = useCallback(
    async (command: TeacherCommand) => {
      if (!identity) return;
      setBusy(true);
      setNotice(null);
      try {
        const result = await orchestrator.sendCommand(
          sessionId,
          identity.participantId,
          command,
        );
        if (!result.ok && result.detail) setNotice(result.detail);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Command failed');
      } finally {
        setBusy(false);
      }
    },
    [identity, sessionId],
  );

  const toggleAgentMute = useCallback(() => {
    if (agentMuted) {
      void send({ type: 'RESUME_AGENT' });
    } else {
      void send({ type: 'MUTE_AGENT' });
    }
    setAgentMuted((m) => !m);
  }, [agentMuted, send]);

  const startAgent = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    setNotice(null);
    setIntroPlayed(false);
    try {
      await orchestrator.startAgent(sessionId, identity.participantId);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not start Athena',
      );
    } finally {
      setBusy(false);
    }
  }, [identity, sessionId]);

  const stopAgent = useCallback(async () => {
    setBusy(true);
    try {
      await orchestrator.stopAgent(sessionId);
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  /** Replaces the separate "Bring Athena in" / "Send Athena out" header buttons. */
  const toggleAgentPresence = useCallback(() => {
    if (view.room?.agentId) {
      void stopAgent();
    } else {
      void startAgent();
    }
  }, [view.room?.agentId, startAgent, stopAgent]);

  const endSession = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    try {
      await orchestrator.sendCommand(sessionId, identity.participantId, {
        type: 'END_SESSION',
      });
      setReport(
        await orchestrator.getReport(sessionId, identity.participantId),
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not end lesson',
      );
    } finally {
      setBusy(false);
    }
  }, [identity, sessionId]);

  const uploadLesson = useCallback(async () => {
    if (!identity || lessonText.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await orchestrator.uploadLesson(
        sessionId,
        identity.participantId,
        lessonName.trim() || 'lesson-notes',
        lessonText,
      );
      setNotice(
        `Indexed ${result.chunks} chunk(s). ` +
          (result.appliedToAgent
            ? 'Athena is now grounded in this material.'
            : 'It will reach Athena when you bring her in.'),
      );
      setLessonText('');
      await refreshLesson();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }, [identity, sessionId, lessonName, lessonText, refreshLesson]);

  const leave = useCallback(async () => {
    if (identity) {
      await orchestrator
        .leave(sessionId, identity.participantId)
        .catch(() => undefined);
    }
    clearIdentity();
    router.push('/join');
  }, [identity, sessionId, router]);

  const toggleScreenShare = useCallback(async () => {
    if (!identity) return;
    const next = !isScreenSharing;
    try {
      await view.toggleScreenShare(next);
      setIsScreenSharing(next);
    } catch {
      // The orchestrator already logged the reason (e.g. someone else is sharing).
    }
  }, [identity, isScreenSharing, view]);

  const stopScreenShareFromBrowser = useCallback(() => {
    setIsScreenSharing(false);
    if (identity) void view.toggleScreenShare(false).catch(() => undefined);
  }, [identity, view]);

  // `showLibraryStage` is local to this tab; `presentLibrary` is what puts the
  // book on every student's stage (their stage is gated on
  // `library.isPresenting`). Opening the modal without the second call is what
  // silently desynced the library: the teacher saw a book nobody else did, and
  // with no student ever on a page the Free Read "Jump to reader" chips had
  // nothing to list. Both toggles go through these so the two cannot drift.
  const openLibraryStage = useCallback(() => {
    setShowLibraryStage(true);
    void view.presentLibrary(true);
  }, [view]);

  const closeLibraryStage = useCallback(() => {
    setShowLibraryStage(false);
    void view.presentLibrary(false);
  }, [view]);

  if (!identity) {
    return (
      <main className="eco-room flex min-h-screen items-center justify-center p-6 text-sm text-[var(--eco-cream-dim)]">
        Loading…
      </main>
    );
  }

  const someoneElseIsSharing =
    view.activeScreenShare !== null &&
    view.activeScreenShare.participantId !== identity.participantId;

  const lang = view.myLanguage;

  const tabs: DrawerTab[] = [
    {
      id: 'controls',
      label: t('tabControls', lang),
      content: (
        <div className="flex flex-col gap-4">
          <TeacherControlPanel
            policy={view.policy}
            agentRunning={Boolean(view.room?.agentId)}
            busy={busy}
            language={lang}
            onMute={() => void send({ type: 'MUTE_AGENT' })}
            onResume={() => void send({ type: 'RESUME_AGENT' })}
            onEndTurn={() => void send({ type: 'END_AGENT_TURN' })}
            onForceSpeak={(topic) =>
              void send({ type: 'FORCE_AGENT_SPEAK', topic })
            }
            onVerbosity={(level: VerbosityLevel) =>
              void send({ type: 'ADJUST_VERBOSITY', level })
            }
            onSetStudentInvocation={(enabled) =>
              void send({ type: 'SET_STUDENT_INVOCATION', enabled })
            }
            onDisableTopic={(topic) =>
              void send({ type: 'DISABLE_TOPIC', topic })
            }
            onEnableTopic={(topic) =>
              void send({ type: 'ENABLE_TOPIC', topic })
            }
            onStartQuiz={(topic) => void send({ type: 'START_QUIZ', topic })}
            onStartAgent={() => void startAgent()}
            onStopAgent={() => void stopAgent()}
            onEndSession={() => void endSession()}
          />

          <section className="eco-panel flex flex-col gap-2 p-4">
            <h2 className="eco-label">{t('lessonMaterial', lang)}</h2>
            <p className="text-xs text-[var(--eco-cream-faint)]">
              Paste slides or notes. Athena grounds her answers in this and uses
              your terminology.
              {lessonInfo && lessonInfo.chunks > 0 && (
                <>
                  {' '}
                  Currently indexed: {lessonInfo.chunks} chunk(s) from{' '}
                  {lessonInfo.sources.join(', ')}.
                </>
              )}
            </p>
            <input
              className="rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
              style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
              value={lessonName}
              onChange={(e) => setLessonName(e.target.value)}
              placeholder="Source name, e.g. week-4-slides"
            />
            <textarea
              className="min-h-28 rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
              style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
              value={lessonText}
              onChange={(e) => setLessonText(e.target.value)}
              placeholder="Paste the lesson text here…"
            />
            <button
              type="button"
              disabled={busy || lessonText.trim().length === 0}
              onClick={() => void uploadLesson()}
              className="self-start rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ background: 'var(--eco-glow)', color: 'var(--eco-ink)' }}
            >
              Index material
            </button>
          </section>

          <ScreenShareControls
            participants={view.participants}
            screenShareAllowed={view.screenShareAllowed}
            activeScreenShare={view.activeScreenShare}
            onSetPermission={(pid, allowed) => void view.setScreenSharePermission(pid, allowed)}
          />
        </div>
      ),
    },
    {
      id: 'workspace',
      label: t('tabWorkspace', lang),
      content: (
        <MiroWorkspacePane
          sessionId={sessionId}
          participantId={identity.participantId}
          role="teacher"
          workspace={view.workspace}
          onRefresh={view.refreshWorkspace}
        />
      ),
    },
    {
      id: 'transcript',
      label: t('tabTranscript', lang),
      content: (
        <TranscriptFeed
          transcript={view.transcript}
          participants={view.participants}
          agentPresent={Boolean(view.room?.agentId)}
          language={lang}
        />
      ),
    },
    {
      id: 'insights',
      label: t('tabGaps', lang),
      content: (
        <div className="flex flex-col gap-5">
          <RestraintMeter
            state={view.restraintMeterState}
            score={view.restraintScore}
          />
          <SuppressedInterventionsPanel
            interventions={view.suppressedInterventions}
          />
          <GapPanel
            gaps={view.gaps}
            participants={view.participants}
            onQuiz={(topic, targetStudentIds) =>
              void send({ type: 'START_QUIZ', topic, targetStudentIds })
            }
            language={lang}
          />
          <BlockedAttempts attempts={view.blockedAttempts} language={lang} />
          <IllustrationFailures failures={view.illustrationFailures} language={lang} />
        </div>
      ),
    },
    {
      id: 'roster',
      label: t('inTheRoom', lang),
      content: (
        <RosterPanel
          participants={view.participants}
          agentPresent={Boolean(view.room?.agentId)}
          agentUid={identity.agentUid}
          speakingUid={speakingUid}
          onSetProficiency={(studentId, proficiency) =>
            void send({ type: 'SET_PROFICIENCY', studentId, proficiency })
          }
          language={lang}
        />
      ),
    },
    {
      id: 'slots',
      label: '1:1 Catch-up Slots',
      content: (
        <div className="flex flex-col gap-4">
          <div className="eco-panel p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="eco-label">1:1 Student Connect Appointments</h2>
              <button
                type="button"
                onClick={() => setShowCatchupBooking(true)}
                className="rounded-lg bg-[var(--eco-amber)] px-3 py-1 text-xs font-semibold text-[var(--eco-ink)] hover:brightness-110"
              >
                + Add / Manage Slots
              </button>
            </div>
            <p className="text-xs text-[var(--eco-cream-faint)]">
              Scheduled office hours and remedial sessions booked by students.
            </p>
          </div>

          <div className="space-y-2">
            {view.catchupSlots && view.catchupSlots.filter((s) => s.isBooked).length > 0 ? (
              view.catchupSlots
                .filter((s) => s.isBooked)
                .map((slot) => (
                  <div
                    key={slot.slotId}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs text-[var(--eco-cream)] space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-300">
                        {slot.bookedByStudentName || 'Student'}
                      </span>
                      <span className="rounded bg-[var(--eco-panel)] px-2 py-0.5 text-[10px] font-bold text-amber-400">
                        {slot.date} · {slot.startTime}-{slot.endTime}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--eco-cream-dim)]">
                      <strong>Focus Topic:</strong> {slot.topic || 'General Review'}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-emerald-400 font-medium">✓ Confirmed with Athena AI</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await orchestrator.cancelCatchupSlot(sessionId, slot.slotId);
                          await view.refreshCatchupSlots?.();
                        }}
                        className="text-[10px] text-rose-400 hover:underline"
                      >
                        Cancel Slot
                      </button>
                    </div>
                  </div>
                ))
            ) : (
              <div className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] p-6 text-center text-xs text-[var(--eco-cream-faint)]">
                No 1:1 appointments booked yet. Students can schedule directly from their classroom menu.
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'quizzes',
      label: t('tabQuizzes', lang),
      content: (
        <QuizCards quizzes={view.quizzes} canAnswer={false} onAnswer={() => undefined} language={lang} />
      ),
    },
  ];

  return (
    <ClassroomSpaceBackground>
    <main className="eco-room mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-4 md:h-screen md:overflow-hidden">
      {/* Pinned to the top-right corner of the viewport, per request. */}
      {/* Pinned readable regardless of theme, same as the header below --
          see its comment. */}
      <div
        className="fixed right-4 top-4 z-30 flex items-center gap-2"
        style={{
          '--eco-cream': '#ffffff',
          '--eco-cream-dim': '#e5e7eb',
          '--eco-cream-faint': '#cbd5e1',
          // Text was pinned for the always-dark starfield, but the surface
          // tokens behind it (the leave button, LanguageSelector's button and
          // dropdown) were not -- they still flip light in light mode, which
          // turned white text on a now-pale fill. Pin them dark too.
          '--eco-ink-raised': '#151417',
          '--eco-ink-sunken': '#101013',
        } as CSSProperties}
      >
        <ThemeToggle />
        <LanguageSelector
          currentLanguage={view.myLanguage}
          onLanguageChange={view.changeLanguage}
        />
        <button
          type="button"
          onClick={() => void leave()}
          className="flex h-9 w-9 items-center justify-center rounded-full border text-[var(--eco-cream-dim)] transition-colors hover:border-[var(--eco-red)] hover:text-[var(--eco-red)]"
          style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-panel, var(--eco-ink-sunken))' }}
          aria-label={t('leaveClassroom', lang)}
          title={t('leave', lang)}
        >
          <LeaveIcon />
        </button>
      </div>

      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eco-rule)] pb-4"
        /* Pinned readable regardless of theme: this header sits directly on
           ClassroomSpaceBackground's always-dark starfield (it never follows
           data-eco-theme), so the theme-adaptive --eco-cream tokens -- which
           flip to near-black text in light mode -- go unreadable here. Same
           fix already applied on the join page's header. Surface tokens
           (ink-raised/-sunken) are pinned dark too, for FloorIndicator's
           eco-panel-sunken chips ("Open floor" / "Listening only"), which
           otherwise pair the pinned light text with a light fill. */
        style={{
          '--eco-cream': '#ffffff',
          '--eco-cream-dim': '#e5e7eb',
          '--eco-cream-faint': '#cbd5e1',
          '--eco-ink-raised': '#151417',
          '--eco-ink-sunken': '#101013',
        } as CSSProperties}
      >
        <div className="flex flex-col gap-1">
          <h1 className="eco-display text-2xl text-[var(--eco-cream)]">
            {view.room?.title ?? t('teacherDashboard', lang)}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="eco-numerals text-[var(--eco-cream-faint)]">
              {t('teacher', lang)}: {identity.displayName} · {view.connected ? 'connected' : 'reconnecting…'}
            </span>
            <span className="text-[var(--eco-rule)]">|</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[var(--eco-cream-dim)]">Class Share Code:</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(sessionId);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-0.5 font-mono text-xs font-bold tracking-widest transition shadow-sm hover:scale-105"
                style={{
                  background: 'color-mix(in srgb, var(--eco-athena) 20%, transparent)',
                  color: 'var(--eco-athena)',
                  border: '1px solid color-mix(in srgb, var(--eco-athena) 50%, transparent)',
                }}
                title="Click to copy 4-digit class share code"
              >
                <span className="text-sm font-bold">{sessionId}</span>
                <span className="text-[10px] font-sans font-normal opacity-80">
                  {copiedCode ? '✓ Copied' : 'Copy'}
                </span>
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTranscriptPinned((on) => !on)}
            data-active={transcriptPinned}
            className="eco-action-chip"
            style={{ '--chip-accent': 'var(--eco-blue)' } as CSSProperties}
            title={
              transcriptPinned
                ? 'Unpin the transcript sidebar'
                : 'Pin the transcript alongside the room'
            }
          >
            {transcriptPinned ? 'Unpin Transcript' : 'Pin Transcript'}
          </button>

          <button
            type="button"
            onClick={() => void toggleScreenShare()}
            disabled={!isScreenSharing && someoneElseIsSharing}
            className="eco-action-chip flex h-9 w-9 items-center justify-center !px-0 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ '--chip-accent': 'var(--eco-blue)' } as CSSProperties}
            aria-label={isScreenSharing ? t('stopScreenShare', lang) : t('screenShare', lang)}
            title={isScreenSharing ? t('stopScreenShare', lang) : t('screenShare', lang)}
          >
            <ScreenShareIcon />
          </button>

          <button
            type="button"
            onClick={() => void view.presentWhiteboard(!view.activeWhiteboard)}
            data-active={Boolean(view.activeWhiteboard)}
            className="eco-action-chip flex h-9 w-9 items-center justify-center !px-0"
            style={{ '--chip-accent': 'var(--eco-green)' } as CSSProperties}
            aria-label={
              view.activeWhiteboard
                ? 'Stop showing the whiteboard to the room'
                : 'Show the whiteboard to everyone'
            }
            title={
              view.activeWhiteboard
                ? 'Stop showing the whiteboard to the room'
                : 'Show the whiteboard to everyone'
            }
          >
            <WhiteboardIcon />
          </button>

          <FloorIndicator floor={view.floor} policy={view.policy} language={lang} />
          <button
            type="button"
            onClick={() => setMicEnabled((on) => !on)}
            className="eco-mic-button flex h-9 w-9 items-center justify-center border text-xs font-medium transition-colors"
            style={
              micEnabled
                ? { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
                : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-faint)' }
            }
            aria-label={micEnabled ? t('mute', lang) : t('unmute', lang)}
            title={micEnabled ? t('mute', lang) : t('unmute', lang)}
          >
            {micEnabled ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-11 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold transition-colors"
            style={
              menuOpen
                ? { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow)', color: 'var(--eco-ink)' }
                : { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
            }
            aria-label="Open menu"
            title="Controls, workspace, reading, insights, roster, quizzes"
          >
            <AppMenuIcon />
            <span>Menu</span>
          </button>
        </div>
      </header>

      {view.raisedHands.length > 0 && (
        <div
          className="flex items-center justify-between rounded-xl border px-4 py-2.5 text-xs animate-in fade-in"
          style={{
            borderColor: 'color-mix(in srgb, var(--eco-amber) 40%, transparent)',
            background: 'color-mix(in srgb, var(--eco-amber) 10%, transparent)',
            color: 'var(--eco-amber)',
          }}
        >
          <div className="flex items-center gap-2">
            <span>
              <strong>{view.raisedHands.length} student(s) raised their hand:</strong>{' '}
              {view.raisedHands
                .map((id) => view.participants.find((p) => p.participantId === id)?.displayName ?? id)
                .join(', ')}
            </span>
          </div>
          <span className="text-[10px] text-[var(--eco-cream-faint)]">Signal received over control plane</span>
        </div>
      )}

      {notice && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-amber)', background: 'var(--eco-amber-dim)', color: 'var(--eco-cream)' }}
        >
          {notice}
        </p>
      )}

      {!view.room?.agentId && <AgentAbsentNotice isTeacher language={lang} />}

      {transcriptionError && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-red)', background: 'var(--eco-red-dim)', color: 'var(--eco-cream)' }}
        >
          Transcription could not start: {transcriptionError}. Athena cannot hear
          the room. Reload the page; if it persists, check the browser console.
        </p>
      )}

      {view.room?.agentId && !transcriptionLive && !transcriptionError && (
        <p className="eco-panel-sunken px-4 py-3 text-sm text-[var(--eco-cream-dim)]">
          Connecting the transcript pipeline…
        </p>
      )}

      {relayWasHidden && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-amber)', background: 'var(--eco-amber-dim)', color: 'var(--eco-cream)' }}
        >
          {relayHidden
            ? 'This tab is in the background, so the class transcript is paused.'
            : 'The class transcript was paused while this tab was in the background.'}{' '}
          Your browser slows down background tabs, and this page is what records
          the room. Keep it visible to keep the transcript live.
        </p>
      )}

      {micError && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-amber)', background: 'var(--eco-amber-dim)', color: 'var(--eco-cream)' }}
        >
          {micError} You can still see the room, but Athena and the class
          will not hear you until a microphone is available.
        </p>
      )}

      {view.gaps
        .filter((gap) => gap.affectedStudentIds.length >= 2 && !gap.addressedAt)
        .map((gap) => (
          <article
            key={gap.gapId}
            className="eco-panel flex flex-col justify-between gap-3 border-l-4 p-4 sm:flex-row sm:items-center"
            style={{
              borderColor: 'var(--eco-amber)',
              background: 'var(--eco-amber-dim)',
            }}
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="eco-lamp eco-lamp-glow eco-lamp-amber" style={{ width: '8px', height: '8px' }} />
                <h3 className="text-sm font-semibold text-[var(--eco-cream)]">
                  Athena has detected a class-wide gap on &quot;{gap.topic}&quot;
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--eco-cream-dim)]">
                {gap.affectedStudentIds.length} students (
                {gap.affectedStudentIds
                  .map(
                    (id) =>
                      view.participants.find((p) => p.participantId === id)
                        ?.displayName ?? id,
                  )
                  .join(', ')}
                ) are struggling with this concept. Launch quiz to resolve?
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void send({
                  type: 'START_QUIZ',
                  topic: gap.topic,
                  targetStudentIds: gap.affectedStudentIds,
                });
              }}
              className="self-start whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 sm:self-center"
              style={{
                background: 'var(--eco-amber)',
                color: 'var(--eco-ink)',
              }}
            >
              Launch Quiz
            </button>
          </article>
        ))}

      {report ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReportView report={report} title={view.room?.title} />
        </div>
      ) : (
        <ClassroomShell identity={identity}>
          {(rtm) => (
            <>
              <ClassroomAudio
                sessionId={sessionId}
                channel={identity.channel}
                appId={identity.appId}
                uid={identity.uid}
                rtcToken={identity.rtcToken}
                rtmClient={rtm}
                agentUid={identity.agentUid}
                isRelay
                micEnabled={micEnabled}
                onToolkitReady={setTranscriptionLive}
                onToolkitError={setTranscriptionError}
                onMicError={setMicError}
                onSpeakingChange={setSpeakingUid}
                onRelayHiddenChange={setRelayHidden}
              />

              {/* Stage + optional pinned transcript sidebar, side by side. */}
              <div className="flex min-h-0 flex-1 gap-3">
                <div className="flex min-h-0 flex-1 flex-col">
                  {view.activeScreenShare ? (
                    <ScreenShareStage
                      isSharing={isScreenSharing}
                      onSharingEnded={stopScreenShareFromBrowser}
                      activeScreenShare={view.activeScreenShare}
                      selfUid={identity.uid}
                    />
                                    ) : view.activeWhiteboard ? (
                    <div className="eco-panel relative min-h-0 flex-1 overflow-hidden">
                      <ExcalidrawBoard
                        scene={view.boardScene}
                        files={view.boardFiles}
                        canDraw
                        onSceneChange={view.pushBoardScene}
                      />
                    </div>
                  ) : view.activeModel ? (
                    <div className="eco-panel relative min-h-0 flex-1 overflow-hidden">
                      <Model3DStage modelId={view.activeModel.modelId} />
                    </div>
                  ) : view.library?.isPresenting && view.libraryBook && !showLibraryStage ? (
                    /* `!showLibraryStage` keeps this from double-mounting behind
                       the teacher's own modal, now that opening that modal is
                       what sets `isPresenting`. Two FlipBooks would mean two
                       page-flip engines and a duplicated `id="book"`. This
                       branch still covers the case it was written for: Athena
                       citing a page presents the library with no modal open. */
                    <DigitalLibraryStage
                      sessionId={sessionId}
                      participantId={identity.participantId}
                      role="teacher"
                      library={view.library}
                      book={view.libraryBook}
                      books={view.libraryBooks}
                      participants={view.participants}
                      onTurnPage={view.turnLibraryPage}
                      onToggleLock={view.toggleLibraryLock}
                                  onSelectBook={view.selectLibraryBook}
                      onAddBook={view.addLibraryBook}
                      onRemoveBook={view.removeLibraryBook}
                      onCloseStage={closeLibraryStage}
                    />
                  ) : (
                    <ParticipantGrid
                      sessionId={sessionId}
                      participants={view.participants}
                      agentPresent={Boolean(view.room?.agentId)}
                      agentUid={identity.agentUid}
                      speakingUid={speakingUid}
                      selfUid={identity.uid}
                      selfMicEnabled={micEnabled}
                      raisedHands={view.raisedHands}
                      agentMuted={agentMuted}
                      onToggleAgentMute={toggleAgentMute}
                      agentBusy={busy}
                      onToggleAgentPresence={toggleAgentPresence}
                    />
                  )}
                </div>

                {transcriptPinned && (
                  <aside className="eco-panel flex w-80 shrink-0 flex-col overflow-hidden">
                    <div
                      className="flex items-center justify-between border-b px-3 py-2"
                      style={{ borderColor: 'var(--eco-rule)' }}
                    >
                      <h2 className="eco-label">Transcript</h2>
                      <button
                        type="button"
                        onClick={() => setTranscriptPinned(false)}
                        className="text-xs text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
                        aria-label="Unpin transcript"
                        title="Unpin transcript"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                      <TranscriptFeed
                        transcript={view.transcript}
                        participants={view.participants}
                        agentPresent={Boolean(view.room?.agentId)}
                      />
                    </div>
                  </aside>
                )}
              </div>
            </>
          )}
        </ClassroomShell>
      )}

      <ClassroomDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <TeacherToolsBag
        onOpenAbsentDispatcher={() => setShowAbsentPacket(true)}
        onOpenModels={() => {
          if (view.activeModel) {
            void view.presentModel(null);
          } else {
            setModelPickerOpen(true);
          }
        }}
        onOpenQuiz={() => setActiveToolPanel('quiz')}
        onOpenGaps={() => setActiveToolPanel('gaps')}
        onOpenLibrary={openLibraryStage}
      />

      {activeToolPanel && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: 'color-mix(in srgb, var(--eco-ink) 65%, transparent)' }}
          onClick={() => setActiveToolPanel(null)}
        >
          <div
            className="eco-panel flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--eco-rule)' }}>
              <h2 className="eco-label text-base">
                {activeToolPanel === 'quiz' ? t('tabQuizzes', lang) : t('tabGaps', lang)}
              </h2>
              <button
                type="button"
                onClick={() => setActiveToolPanel(null)}
                className="text-sm text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {activeToolPanel === 'quiz' ? (
              <QuizCards quizzes={view.quizzes} canAnswer={false} onAnswer={() => undefined} language={lang} />
            ) : (
              <div className="flex flex-col gap-5">
                <RestraintMeter state={view.restraintMeterState} score={view.restraintScore} />
                <SuppressedInterventionsPanel interventions={view.suppressedInterventions} />
                <GapPanel
                  gaps={view.gaps}
                  participants={view.participants}
                  onQuiz={(topic, targetStudentIds) =>
                    void send({ type: 'START_QUIZ', topic, targetStudentIds })
                  }
                  language={lang}
                />
                <BlockedAttempts attempts={view.blockedAttempts} language={lang} />
                <IllustrationFailures failures={view.illustrationFailures} language={lang} />
              </div>
            )}
          </div>
        </div>
      )}

      <Model3DPicker
        isOpen={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(modelId) => {
          setModelPickerOpen(false);
          void view.presentModel(modelId);
        }}
      />
      {showLibraryStage && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: 'color-mix(in srgb, var(--eco-ink) 65%, transparent)' }}
          onClick={closeLibraryStage}
        >
          <div
            className="flex h-[85vh] w-full max-w-6xl flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {view.libraryBook ? (
              <DigitalLibraryStage
                sessionId={sessionId}
                participantId={identity.participantId}
                role="teacher"
                library={view.library}
                book={view.libraryBook}
                books={view.libraryBooks}
                participants={view.participants}
                onTurnPage={view.turnLibraryPage}
                onToggleLock={view.toggleLibraryLock}
                onSelectBook={view.selectLibraryBook}
                onAddBook={view.addLibraryBook}
                onRemoveBook={view.removeLibraryBook}
                onCloseStage={closeLibraryStage}
              />
            ) : (
              <div className="eco-panel flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-sm text-[var(--eco-cream-dim)]">Loading textbook…</p>
                <button
                  type="button"
                  onClick={() => void view.refreshLibrary()}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[var(--eco-rule)] text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)] hover:border-[var(--eco-cream-dim)] transition"
                >
                  Retry / Refresh Textbook
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <AbsentStudentPacketModal
        sessionId={sessionId}
        isOpen={showAbsentPacket}
        onClose={() => setShowAbsentPacket(false)}
        onOpenCatchupBooking={() => setShowCatchupBooking(true)}
      />

      <CatchupBookingModal
        sessionId={sessionId}
        studentId={identity.participantId}
        studentName={identity.displayName}
        isOpen={showCatchupBooking}
        onClose={() => setShowCatchupBooking(false)}
      />

      <CatchupChatbot
        sessionId={sessionId}
        participantId={identity.participantId}
        displayName={identity.displayName}
        role="teacher"
      />
    </main>
    </ClassroomSpaceBackground>
  );
}

/** Interactive timeline showing both spoken and suppressed interventions with their scores and reasons. */
function InterventionTimeline({ history }: { history: InterventionRecord[] }) {
  const [filter, setFilter] = useState<'all' | 'spoken' | 'suppressed'>('all');

  const filtered = history.filter((item) => {
    if (filter === 'all') return true;
    return item.status === filter;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="eco-label-dim font-semibold">Intervention Timeline</h3>
        <div className="flex gap-1">
          {(['all', 'spoken', 'suppressed'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilter(mode)}
              className="rounded border px-2.5 py-1 text-xs font-semibold capitalize transition-colors"
              style={{
                borderColor: filter === mode ? 'var(--eco-glow)' : 'var(--eco-rule)',
                background: filter === mode ? 'var(--eco-glow-dim)' : 'var(--eco-ink-sunken)',
                color: filter === mode ? 'var(--eco-glow-bright)' : 'var(--eco-cream-dim)',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-2 text-xs text-[var(--eco-cream-faint)]">
          No interventions recorded matching this filter.
        </p>
      ) : (
        <div className="relative ml-2 flex flex-col gap-4 border-l border-[var(--eco-rule)] pl-4">
          {filtered.map((item, idx) => {
            const isSpoken = item.status === 'spoken';
            return (
              <div key={idx} className="relative flex flex-col gap-1">
                <span
                  className="absolute -left-[1.375rem] top-1.5 h-3 w-3 rounded-full border-2"
                  style={{
                    borderColor: isSpoken ? 'var(--eco-glow-bright)' : 'var(--eco-red)',
                    background: 'var(--eco-ink)',
                  }}
                />
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        background: isSpoken ? 'var(--eco-green-dim)' : 'var(--eco-red-dim)',
                        color: isSpoken ? 'var(--eco-glow-bright)' : 'var(--eco-red)',
                      }}
                    >
                      {isSpoken ? 'Spoken' : 'Suppressed'}
                    </span>
                    <span className="eco-numerals text-[11px] text-[var(--eco-cream-faint)]">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className="eco-numerals text-[11px] text-[var(--eco-cream-dim)]">
                    Gate Score: <strong className="font-semibold">{item.score.toFixed(2)}</strong>
                  </span>
                </div>
                <p className="rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] p-2 text-xs italic text-[var(--eco-cream)]">
                  &quot;{item.text}&quot;
                </p>
                <p className="text-[10px] text-[var(--eco-cream-faint)]">
                  Reason: {item.reason}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Post-class report (§3.9), rendered inline once the lesson ends. */
function ReportView({ report, title }: { report: SessionReport; title?: string }) {
  const totalAnswered = report.perStudent.reduce((s, p) => s + p.quizzesAnswered, 0);
  const totalCorrect = report.perStudent.reduce((s, p) => s + p.quizzesCorrect, 0);
  const totalAsked = report.perStudent.reduce((s, p) => s + p.questionsAsked, 0);
  const grasp = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;

  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const durationMin = Math.max(1, Math.round((report.endedAt - report.startedAt) / 60000));

  return (
    <section className="eco-panel flex flex-col gap-6 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4" style={{ borderColor: 'var(--eco-rule)' }}>
        <div className="flex flex-col gap-1.5">
          <span className="eco-label">Post-class summary</span>
          <h2 className="eco-display text-2xl text-[var(--eco-cream)]">
            {title ?? 'Lesson'}
          </h2>
          <p className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
            {fmtDate(report.startedAt)} · {fmtTime(report.startedAt)}–{fmtTime(report.endedAt)} ({durationMin}m) ·{' '}
            {report.perStudent.length} student{report.perStudent.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          disabled
          className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream-faint)] opacity-50"
          style={{ borderColor: 'var(--eco-rule)' }}
          title="Export is not wired up in the demo build"
        >
          Export report
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="eco-panel-sunken flex flex-col gap-1 p-4">
          <span className="eco-label-dim">Key concept grasp</span>
          <span className="eco-numerals text-3xl text-[var(--eco-cream)]">
            {grasp === null ? '—' : `${grasp}%`}
          </span>
          <span className="text-xs text-[var(--eco-cream-faint)]">
            {totalCorrect} of {totalAnswered} quiz answers correct
          </span>
        </div>
        <div className="eco-panel-sunken flex flex-col gap-1 p-4">
          <span className="eco-label-dim">Questions to Athena</span>
          <span className="eco-numerals text-3xl text-[var(--eco-cream)]">{totalAsked}</span>
          <span className="text-xs text-[var(--eco-cream-faint)]">across the class</span>
        </div>
        <div className="eco-panel-sunken flex flex-col gap-1 p-4">
          <span className="eco-label-dim">Topics covered</span>
          <span className="eco-numerals text-3xl text-[var(--eco-cream)]">
            {report.topicsCovered.length}
          </span>
          <span className="truncate text-xs text-[var(--eco-cream-faint)]">
            {report.topicsCovered.join(', ') || '—'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-3">
          <h3 className="eco-label-dim">Identified learning gaps</h3>
          {report.commonMisconceptions.length === 0 ? (
            <p className="text-sm text-[var(--eco-cream-faint)]">
              No repeated misconceptions were detected.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {report.commonMisconceptions.map((m) => (
                <li
                  key={m.topic}
                  className="flex flex-col gap-1 rounded-[0.625rem] border p-3"
                  style={{ borderColor: 'var(--eco-amber)', background: 'var(--eco-amber-dim)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="eco-lamp eco-lamp-amber" style={{ width: 7, height: 7 }} />
                    <strong className="text-sm text-[var(--eco-cream)]">{m.topic}</strong>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--eco-cream-dim)]">
                    {m.description}
                  </p>
                  <p className="text-xs text-[var(--eco-cream-faint)]">
                    {m.studentNames.join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {report.suggestedFollowUp.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="eco-label-dim mt-1">Suggested follow-up</h3>
              <ul className="list-disc pl-5 text-sm text-[var(--eco-cream-dim)]">
                {report.suggestedFollowUp.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside
          className="flex flex-col gap-2 rounded-[0.75rem] border p-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--eco-athena) 30%, var(--eco-rule))',
            background: 'var(--eco-athena-dim)',
          }}
        >
          <span className="eco-label" style={{ color: 'var(--eco-athena)' }}>
            Athena · session read
          </span>
          <p className="text-sm leading-relaxed text-[var(--eco-cream)]">
            {report.narrative}
          </p>
        </aside>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="eco-label-dim mb-1">Per student</h3>
        <div className="overflow-x-auto">
          <table className="eco-numerals w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr
                className="border-b text-xs uppercase text-[var(--eco-cream-faint)]"
                style={{ borderColor: 'var(--eco-rule)' }}
              >
                <th className="py-1 pr-3 font-medium">Student</th>
                <th className="py-1 pr-3 font-medium">Level</th>
                <th className="py-1 pr-3 font-medium">Asked</th>
                <th className="py-1 pr-3 font-medium">Quiz</th>
                <th className="py-1 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {report.perStudent.map((s) => (
                <tr
                  key={s.participantId}
                  className="border-b text-[var(--eco-cream-dim)]"
                  style={{ borderColor: 'var(--eco-rule)' }}
                >
                  <td className="py-1 pr-3 font-medium text-[var(--eco-cream)]">
                    {s.displayName}
                  </td>
                  <td className="py-1 pr-3">{s.proficiency}</td>
                  <td className="py-1 pr-3">{s.questionsAsked}</td>
                  <td className="py-1 pr-3">
                    {s.quizzesCorrect}/{s.quizzesAnswered}
                  </td>
                  <td className="py-1">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="eco-label-dim mb-1">Concept Mastery Rankings</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {report.perStudent.map((s) => (
            <article key={s.participantId} className="eco-panel flex flex-col gap-2 bg-[var(--eco-ink-sunken)] p-3">
              <div className="flex items-center justify-between border-b pb-1" style={{ borderColor: 'var(--eco-rule)' }}>
                <h4 className="text-sm font-semibold text-[var(--eco-cream)]">{s.displayName}</h4>
                <span className="text-xs text-[var(--eco-cream-faint)]">Level: {s.proficiency}</span>
              </div>
              {s.conceptMastery && s.conceptMastery.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {s.conceptMastery.map((m) => (
                    <div key={m.topic} className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-[var(--eco-cream-dim)]">{m.topic}</span>
                        <span className="eco-numerals font-medium" style={{
                          color: m.status === 'mastered' ? 'var(--eco-glow-bright)' : m.status === 'struggling' ? 'var(--eco-red)' : 'var(--eco-amber)'
                        }}>{m.score}% ({m.status})</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--eco-rule)]">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${m.score}%`,
                          background: m.status === 'mastered' ? 'var(--eco-glow-bright)' : m.status === 'struggling' ? 'var(--eco-red)' : 'var(--eco-amber)'
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--eco-cream-faint)]">No topic data available for this student.</p>
              )}
            </article>
          ))}
        </div>
      </div>

      <InterventionTimeline history={report.interventionHistory} />
    </section>
  );
}