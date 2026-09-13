/**
 * Student view of a live classroom — PS31 §3.1, §3.6, §3.7.
 *
 * Audio-only by design except for screen sharing: there is no video of
 * people, only a Meet-style grid of participant avatar tiles (speaking
 * indicator, mic state, raised-hand badge). Everything else — transcript,
 * quiz cards, workspace, targeted reading — lives behind a slide-out menu.
 */

'use client';
import { ClassroomSpaceBackground } from '@/components/ClassroomSpaceBackground';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ClassroomShell } from '@/components/classroom/ClassroomShell';
import { ClassroomAudio } from '@/components/classroom/ClassroomAudioLazy';
import { CatchupChatbot } from '@/components/classroom/CatchupChatbot';
import { QuizOverlay } from '@/components/classroom/QuizOverlay';
import { QuizCelebration } from '@/components/classroom/QuizCelebration';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  AgentAbsentNotice,
  FloorIndicator,
  QuizCards,
  TranscriptFeed,
} from '@/components/classroom/panels';
import { ParticipantGrid } from '@/components/classroom/ParticipantGridLazy';
import { ScreenShareStage } from '@/components/classroom/ScreenShareStageLazy';
import { Model3DStage } from '@/components/classroom/Model3DStageLazy';
import { ExcalidrawBoard } from '@/components/classroom/ExcalidrawBoardLazy';
import { DigitalLibraryStage } from '@/components/library/DigitalLibraryStageLazy';
import { ClassroomDrawer, type DrawerTab } from '@/components/classroom/ClassroomDrawer';
import { MiroWorkspacePane } from '@/components/workspace/MiroWorkspacePane';
import { OneOnOneTutorModal } from '@/components/support/OneOnOneTutorModal';
import { LanguageSelector } from '@/components/support/LanguageSelector';
import { t } from '@/lib/i18n';
import { useClassroom } from '@/hooks/useClassroom';
import {
  clearIdentity,
  loadIdentity,
  orchestrator,
  type StoredIdentity,
} from '@/lib/orchestrator';

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


export default function ClassroomPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [speakingUid, setSpeakingUid] = useState<string | null>(null);
  const [transcriptionLive, setTranscriptionLive] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const [show1on1Tutor, setShow1on1Tutor] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [transcriptPinned, setTranscriptPinned] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const stored = loadIdentity(sessionId);
    if (!stored) {
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

  const answer = useCallback(
    (quizId: string, option: string) => {
      if (!identity) return;
      view.recordAnswer(quizId, option);
      void orchestrator
        .answerQuiz(sessionId, quizId, identity.participantId, option, 'ui')
        .catch(() => undefined);
    },
    [identity, sessionId, view],
  );

  const leave = useCallback(async () => {
    if (identity) {
      await orchestrator.leave(sessionId, identity.participantId).catch(() => undefined);
      clearIdentity();
    }
    router.replace('/join');
  }, [identity, router, sessionId]);

  const toggleScreenShare = useCallback(async () => {
    if (!identity) return;
    try {
      if (isScreenSharing) {
        await view.toggleScreenShare(false);
        setIsScreenSharing(false);
      } else {
        await view.toggleScreenShare(true);
        setIsScreenSharing(true);
      }
    } catch {
      setIsScreenSharing(false);
    }
  }, [identity, isScreenSharing, view]);

  const stopScreenShareFromBrowser = useCallback(async () => {
    if (!identity) return;
    try {
      await view.toggleScreenShare(false);
    } finally {
      setIsScreenSharing(false);
    }
  }, [identity, view]);

  if (!identity) {
    return (
      <ClassroomSpaceBackground>
        <main className="eco-room flex min-h-screen items-center justify-center p-6 text-sm text-[var(--eco-cream-dim)]">
          Loading…
        </main>
      </ClassroomSpaceBackground>
    );
  }

  const isHandRaised = view.raisedHands.includes(identity.participantId);
  const canShareScreen = view.screenShareAllowed.includes(identity.participantId);
  const someoneElseIsSharing =
    view.activeScreenShare !== null &&
    view.activeScreenShare.participantId !== identity.participantId;

  const lang = view.myLanguage;

  const tabs: DrawerTab[] = [
    {
      id: 'workspace',
      label: t('tabWorkspace', lang),
      content: (
        <MiroWorkspacePane
          sessionId={sessionId}
          participantId={identity.participantId}
          role="student"
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
      id: 'library',
      label: 'Textbook',
      content: view.libraryBook ? (
        <DigitalLibraryStage
          sessionId={sessionId}
          participantId={identity.participantId}
          role="student"
          library={view.library}
          book={view.libraryBook}
          books={view.libraryBooks}
          participants={view.participants}
          onTurnPage={view.turnLibraryPage}
          onToggleLock={view.toggleLibraryLock}
          onSelectBook={view.selectLibraryBook}
          onAddBook={view.addLibraryBook}
          onRemoveBook={view.removeLibraryBook}
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-8 gap-3 text-center">
          <p className="text-sm text-[var(--eco-cream-dim)]">Loading textbook…</p>
          <button
            type="button"
            onClick={() => void view.refreshLibrary()}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--eco-rule)] text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)] hover:border-[var(--eco-cream-dim)] transition"
          >
            Retry / Refresh Textbook
          </button>
        </div>
      ),
    },
    {
      id: 'quizzes',
      label: t('tabQuizzes', lang),
      content: (
        <QuizCards
          quizzes={view.quizzes}
          canAnswer={!view.ended}
          onAnswer={answer}
          language={lang}
        />
      ),
    },
  ];

  return (
    <ClassroomSpaceBackground>
      <main className="eco-room mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-4 md:h-screen md:overflow-hidden">
      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eco-rule)] pb-4"
        /* Pinned readable regardless of theme: this header sits directly on
           ClassroomSpaceBackground's always-dark starfield (it never follows
           data-eco-theme), so the theme-adaptive --eco-cream tokens -- which
           flip to near-black text in light mode -- go unreadable here. Same
           fix already applied on the join page's header. Surface tokens
           (ink-raised/-sunken) are pinned dark too, for FloorIndicator's
           eco-panel-sunken chips, which otherwise pair the pinned light
           text with a light fill. */
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
            {view.room?.title ?? t('classroom', lang)}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--eco-cream-faint)]">
              {t('student', lang)}: {identity.displayName} · {view.connected ? 'connected' : 'reconnecting…'}
            </span>
            <span className="text-[var(--eco-rule)]">|</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[var(--eco-cream-dim)]">Class Code:</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(sessionId);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs font-bold tracking-widest transition shadow-sm hover:scale-105"
                style={{
                  background: 'color-mix(in srgb, var(--eco-athena) 20%, transparent)',
                  color: 'var(--eco-athena)',
                  border: '1px solid color-mix(in srgb, var(--eco-athena) 50%, transparent)',
                }}
                title="Click to copy 4-digit class code"
              >
                <span>{sessionId}</span>
                <span className="text-[10px] font-sans font-normal opacity-80" aria-hidden>
                  {copiedCode ? (
                    '✓'
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v7A1.5 1.5 0 0 0 4.5 12H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
            {view.policy?.studentsMayInvoke ? (
              <>
                <span className="text-[var(--eco-rule)]">|</span>
                <span className="text-[var(--eco-cream-faint)]">
                  {t('athenaReadyNotice', lang)}
                </span>
              </>
            ) : (
              <>
                <span className="text-[var(--eco-rule)]">|</span>
                <span className="text-[var(--eco-cream-faint)]">
                  {t('athenaListeningNotice', lang)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <LanguageSelector
            currentLanguage={view.myLanguage}
            onLanguageChange={view.changeLanguage}
          />

          <button
            type="button"
            onClick={() => setShow1on1Tutor(true)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:scale-105"
            style={{
              borderColor: 'color-mix(in srgb, var(--eco-amber) 60%, transparent)',
              background: 'color-mix(in srgb, var(--eco-amber) 15%, transparent)',
              color: 'var(--eco-amber)',
            }}
            title="Open dedicated Socratic AI Teaching Assistant for step-by-step help"
          >
            <span>{t('aiAssistant', lang)}</span>
          </button>

          <button
            type="button"
            onClick={() => void view.toggleHandRaise()}
            data-active={isHandRaised}
            className={`eco-action-chip ${isHandRaised ? 'eco-pulse' : ''}`}
            style={{ '--chip-accent': 'var(--eco-amber)' } as CSSProperties}
            title="Raise or lower your hand"
          >
            <span>{isHandRaised ? t('handLower', lang) : t('handRaise', lang)}</span>
          </button>

          {canShareScreen && (
            <button
              type="button"
              onClick={() => void toggleScreenShare()}
              disabled={!isScreenSharing && someoneElseIsSharing}
              className="eco-action-chip disabled:cursor-not-allowed disabled:opacity-40"
              style={{ '--chip-accent': 'var(--eco-blue)' } as CSSProperties}
              title="Share your screen"
            >
              {isScreenSharing ? t('stopScreenShare', lang) : t('screenShare', lang)}
            </button>
          )}

          <FloorIndicator floor={view.floor} policy={view.policy} language={lang} />

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
            title="Workspace, transcript, reading, quizzes"
          >
            <AppMenuIcon />
            <span>Menu</span>
          </button>

          <button
            type="button"
            onClick={() => void leave()}
            className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream-dim)]"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            {t('leave', lang)}
          </button>
        </div>
      </header>

      {view.ended && (
        <p className="eco-panel-sunken px-4 py-3 text-sm text-[var(--eco-cream-dim)]">
          This lesson has ended. Your teacher has the summary.
        </p>
      )}

      {!view.room?.agentId && <AgentAbsentNotice isTeacher={false} language={lang} />}

      {transcriptionError && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-red)', background: 'var(--eco-red-dim)', color: 'var(--eco-cream)' }}
        >
          Transcription could not start: {transcriptionError}. Athena cannot hear
          you. Try reloading the page.
        </p>
      )}

      {view.room?.agentId && !transcriptionLive && !transcriptionError && (
        <p className="eco-panel-sunken px-4 py-3 text-sm text-[var(--eco-cream-dim)]">
          Connecting the transcript pipeline…
        </p>
      )}

      {micError && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-amber)', background: 'var(--eco-amber-dim)', color: 'var(--eco-cream)' }}
        >
          {micError} You can still listen, but Athena will not hear you until
          a microphone is available.
        </p>
      )}

      {/* The stage lives INSIDE the shell because ScreenShareStage calls
          agora-rtc-react hooks, which need the AgoraRTCProvider the shell
          renders. Sitting outside it threw "Agora RTC client not found" the
          moment a share began. The teacher page already had this shape. */}
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
              isRelay={false}
              micEnabled={micEnabled}
              onToolkitReady={setTranscriptionLive}
              onToolkitError={setTranscriptionError}
              onMicError={setMicError}
              onSpeakingChange={setSpeakingUid}
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
                    {/* Students watch: drawing is teacher-and-Athena only, and the
                        orchestrator rejects a student scene post regardless. */}
                    <ExcalidrawBoard
                      scene={view.boardScene}
                      files={view.boardFiles}
                      canDraw={false}
                      onSceneChange={() => undefined}
                    />
                  </div>
                ) : view.library?.isPresenting && view.libraryBook ? (
                  <DigitalLibraryStage
                    sessionId={sessionId}
                    participantId={identity.participantId}
                    role="student"
                    library={view.library}
                    book={view.libraryBook}
                    books={view.libraryBooks}
                    participants={view.participants}
                    onTurnPage={view.turnLibraryPage}
                    onToggleLock={view.toggleLibraryLock}
                              onSelectBook={view.selectLibraryBook}
                    onAddBook={view.addLibraryBook}
                    onRemoveBook={view.removeLibraryBook}
                  />
                ) : view.activeModel ? (
                  <Model3DStage modelId={view.activeModel.modelId} />
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
                      language={lang}
                    />
                  </div>
                </aside>
              )}
            </div>
          </>
        )}
      </ClassroomShell>

      <ClassroomDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {!view.ended && (
        <QuizOverlay quizzes={view.quizzes} onAnswer={answer} />
      )}
      <QuizCelebration celebration={view.celebration} />

      {!view.ended && (
        <CatchupChatbot
          sessionId={sessionId}
          participantId={identity.participantId}
          displayName={identity.displayName}
        />
      )}

      <OneOnOneTutorModal
        sessionId={sessionId}
        studentId={identity.participantId}
        studentName={identity.displayName}
        isOpen={show1on1Tutor}
        onClose={() => setShow1on1Tutor(false)}
        gaps={view.gaps}
      />
    </main>
  </ClassroomSpaceBackground>
  );
}
