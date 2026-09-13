/**
 * Presentational panels shared by the student classroom and the teacher
 * dashboard. All state arrives as props from `useClassroom` — nothing here
 * derives classroom truth locally.
 */

'use client';

import { useEffect, useRef } from 'react';
import type {
  AgentPolicy,
  FloorSnapshot,
  LearningGap,
  PublicParticipant,
  TranscriptSegment,
  LanguageCode,
} from '@echosphere/shared-types';
import type {
  BlockedAttempt,
  IllustrationFailure,
  QuizCardState,
} from '@/hooks/useClassroom';
import { seatColorVar } from '@/lib/seatColor';
import { t, type TranslationKey } from '@/lib/i18n';

/** Below this, a spoken-attribution guess is a close call, not a fact. */
const UNCERTAIN_ATTRIBUTION_THRESHOLD = 0.62;

// ─── Floor indicator (§3.3) — the on-air lamp ─────────────────────────────

const FLOOR_LABEL_KEY: Record<FloorSnapshot['state'], TranslationKey> = {
  TEACHER_HOLDS_FLOOR: 'teacherSpeaking',
  OPEN_FLOOR: 'openFloor',
  AGENT_SPEAKING: 'athenaSpeaking',
  STUDENT_QUESTION_PENDING: 'waitingOnAthena',
};

const FLOOR_LAMP: Record<FloorSnapshot['state'], string> = {
  TEACHER_HOLDS_FLOOR: 'eco-lamp-amber',
  OPEN_FLOOR: 'eco-lamp-off',
  AGENT_SPEAKING: 'eco-lamp-glow eco-pulse',
  STUDENT_QUESTION_PENDING: 'eco-lamp-amber eco-pulse',
};

export function FloorIndicator({
  floor,
  policy,
  language = 'en',
}: {
  floor: FloorSnapshot | null;
  policy: AgentPolicy | null;
  language?: LanguageCode;
}) {
  if (!floor) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eco-panel-sunken flex items-center gap-2 px-3 py-1.5">
        <span className={`eco-lamp ${FLOOR_LAMP[floor.state]}`} />
        <span className="text-xs font-medium text-[var(--eco-cream)]">
          {t(FLOOR_LABEL_KEY[floor.state], language)}
        </span>
      </span>
      {policy && !policy.studentsMayInvoke && !policy.muted && (
        <span className="eco-panel-sunken px-3 py-1.5 text-xs font-medium text-[var(--eco-cream-dim)]">
          {t('listeningOnly', language)}
        </span>
      )}
      {policy?.muted && (
        <span
          className="flex items-center gap-1.5 rounded-[0.625rem] border px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: 'var(--eco-red)',
            background: 'var(--eco-red-dim)',
            color: 'var(--eco-red)',
          }}
        >
          <span className="eco-lamp eco-lamp-red" />
          {t('aiMuted', language)}
        </span>
      )}
      {policy && policy.verbosity !== 'normal' && (
        <span className="eco-panel-sunken px-3 py-1.5 text-xs capitalize text-[var(--eco-cream-dim)]">
          {policy.verbosity}
        </span>
      )}
    </div>
  );
}

// ─── Roster (§3.2, §3.5) ────────────────────────────────────────────────

/** First + last initial, e.g. "Ms Rao" -> "MR", "ana" -> "A". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  return (
    (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')
  ).toUpperCase();
}

function RoleBadge({ role }: { role: 'teacher' | 'student' }) {
  return (
    <span
      aria-hidden
      className="absolute -bottom-1 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border"
      style={{
        borderColor: 'var(--eco-ink)',
        background: 'var(--eco-ink-raised)',
        color: 'var(--eco-cream-dim)',
      }}
    >
      <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
        {role === 'teacher' ? (
          <path d="M8 2 1 6l7 4 5-2.86V11h2V5.5L8 2Zm-4 7.3v2.2C4 12.9 5.8 14 8 14s4-1.1 4-2.5V9.3l-4 2.29L4 9.3Z" />
        ) : (
          <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-3 0-5.5 1.6-5.5 3.6V15h11v-1.9c0-2-2.5-3.6-5.5-3.6Z" />
        )}
      </svg>
    </span>
  );
}

function Avatar({
  name,
  color,
  role,
  speaking,
}: {
  name: string;
  color: string;
  role: 'teacher' | 'student';
  speaking: boolean;
}) {
  return (
    <span
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
        speaking ? 'eco-avatar-speaking' : ''
      }`}
      style={{ background: color, color }}
    >
      <span className="text-sm font-semibold" style={{ color: 'var(--eco-ink)' }}>
        {initialsOf(name)}
      </span>
      <RoleBadge role={role} />
    </span>
  );
}

export function RosterPanel({
  participants,
  agentPresent,
  agentUid,
  speakingUid,
  onSetProficiency,
  language = 'en',
}: {
  participants: PublicParticipant[];
  agentPresent: boolean;
  agentUid?: string;
  /** RTC uid of whoever is speaking right now, from ClassroomAudio's volume poll. */
  speakingUid?: string | null;
  onSetProficiency?: (participantId: string, proficiency: string) => void;
  language?: LanguageCode;
}) {
  const teacher = participants.find((p) => p.role === 'teacher');
  const students = participants.filter((p) => p.role === 'student');

  const levelLabel = (p?: string) =>
    p === 'advanced' ? t('levelA', language) : p === 'beginner' ? t('levelC', language) : t('levelB', language);

  return (
    <section className="eco-panel flex flex-col gap-4 p-4">
      <h2 className="eco-label">{t('inTheRoom', language)}</h2>
      <ul className="flex flex-col gap-3.5 text-sm">
        {teacher && (
          <li className="flex items-center gap-3">
            <Avatar
              name={teacher.displayName}
              color={seatColorVar(teacher.participantId)}
              role="teacher"
              speaking={speakingUid != null && speakingUid === teacher.uid}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[var(--eco-cream)]">
                {teacher.displayName}
              </span>
              <span className="text-xs text-[var(--eco-cream-faint)]">{t('teacher', language)}</span>
            </div>
          </li>
        )}

        <li className="flex items-center gap-3">
          <span
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              agentPresent && speakingUid != null && speakingUid === agentUid
                ? 'eco-orb-speaking'
                : agentPresent
                  ? 'eco-orb-idle'
                  : ''
            }`}
            style={{
              background: agentPresent
                ? 'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--eco-athena) 55%, transparent), transparent 70%), var(--eco-ink-sunken)'
                : 'var(--eco-ink-sunken)',
              color: 'var(--eco-athena)',
              boxShadow: agentPresent
                ? '0 0 14px 1px color-mix(in srgb, var(--eco-athena) 35%, transparent)'
                : 'none',
            }}
          >
            A
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[var(--eco-cream)]">Athena</span>
            <span className="text-xs text-[var(--eco-cream-faint)]">
              {agentPresent ? t('aiTeacher', language) : t('athenaNotStarted', language)}
            </span>
          </div>
        </li>

        {students.map((student) => (
          <li key={student.participantId} className="flex items-center gap-3">
            <Avatar
              name={student.displayName}
              color={seatColorVar(student.participantId)}
              role="student"
              speaking={speakingUid != null && speakingUid === student.uid}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[var(--eco-cream)]">
                {student.displayName}
              </span>
              <span className="text-xs text-[var(--eco-cream-faint)]">{t('student', language)}</span>
            </div>
            {onSetProficiency ? (
              <select
                aria-label={`${t('explanationLevel', language)} for ${student.displayName}`}
                className="rounded-md border px-1.5 py-0.5 text-xs"
                style={{
                  borderColor: 'var(--eco-rule)',
                  background: 'var(--eco-ink-sunken)',
                  color: 'var(--eco-cream)',
                }}
                value={student.proficiency ?? 'intermediate'}
                onChange={(e) =>
                  onSetProficiency(student.participantId, e.target.value)
                }
              >
                <option value="advanced">{t('levelA', language)}</option>
                <option value="intermediate">{t('levelB', language)}</option>
                <option value="beginner">{t('levelC', language)}</option>
              </select>
            ) : (
              <span className="text-xs text-[var(--eco-cream-faint)]">
                {levelLabel(student.proficiency)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Explains an empty room when the AI is not in it.
 */
export function AgentAbsentNotice({
  isTeacher,
  language = 'en',
}: {
  isTeacher: boolean;
  language?: LanguageCode;
}) {
  return (
    <div
      className="rounded-[0.625rem] border px-4 py-3 text-sm"
      style={{
        borderColor: 'var(--eco-amber)',
        background: 'var(--eco-amber-dim)',
        color: 'var(--eco-cream)',
      }}
    >
      <strong style={{ color: 'var(--eco-amber)' }}>
        {t('absentNoticeTitle', language)}
      </strong>{' '}
      {isTeacher ? t('absentNoticeTeacher', language) : t('absentNoticeStudent', language)}
    </div>
  );
}

// ─── Transcript (§3.4) ─────────────────────────────────────────────────

export function TranscriptFeed({
  transcript,
  participants,
  agentPresent = true,
  language = 'en',
}: {
  transcript: TranscriptSegment[];
  participants: PublicParticipant[];
  /** When false, an empty transcript is expected rather than surprising. */
  agentPresent?: boolean;
  language?: LanguageCode;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript.length]);

  const nameOf = (segment: TranscriptSegment) => {
    if (segment.speaker === 'agent') return 'Athena';
    const match = participants.find(
      (p) => p.participantId === segment.participantId,
    );
    return match?.displayName ?? `Participant ${segment.uid}`;
  };

  const seatOf = (segment: TranscriptSegment): string =>
    segment.speaker === 'agent'
      ? 'var(--eco-athena)'
      : seatColorVar(segment.participantId ?? segment.uid);

  const timeOf = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="eco-label">{t('liveTranscript', language)}</h2>
        {transcript.length > 0 && (
          <span className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
            {transcript.length} {transcript.length === 1 ? t('turn', language) : t('turns', language)}
          </span>
        )}
      </div>
      <div className="eco-panel max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-4 md:max-h-none">
        {transcript.length === 0 ? (
          <p className="text-sm text-[var(--eco-cream-faint)]">
            {agentPresent
              ? t('nothingSpokenYet', language)
              : t('transcriptionStartsWhenJoined', language)}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {transcript.map((segment) => {
              const isAgent = segment.speaker === 'agent';
              const hue = seatOf(segment);
              const uncertain =
                segment.attributionConfidence !== undefined &&
                segment.attributionConfidence < UNCERTAIN_ATTRIBUTION_THRESHOLD;
              return (
                <li
                  key={segment.segmentId}
                  className={`flex flex-col gap-1 ${isAgent ? 'items-start' : 'items-end'}`}
                >
                  <span className="flex items-center gap-1.5 px-1">
                    <span
                      className="text-[0.7rem] font-semibold uppercase tracking-wide"
                      style={{ color: hue }}
                    >
                      {nameOf(segment)}
                    </span>
                    <span className="eco-numerals text-[0.7rem] text-[var(--eco-cream-faint)]">
                      {timeOf(segment.at)}
                    </span>
                    {segment.language && (
                      <span
                        className="rounded px-1 text-[0.625rem] font-semibold uppercase tracking-wider"
                        style={{
                          background: 'var(--eco-ink-raised)',
                          color: 'var(--eco-athena)',
                          border: '1px solid color-mix(in srgb, var(--eco-athena) 30%, transparent)',
                        }}
                      >
                        {segment.language}
                      </span>
                    )}
                    {uncertain && (
                      <span
                        className="rounded px-1 text-[0.625rem] font-medium uppercase tracking-wide"
                        style={{
                          background: 'var(--eco-amber-dim)',
                          color: 'var(--eco-amber)',
                        }}
                        title={t('unclearWhoTooltip', language)}
                      >
                        {t('unclearWho', language)}
                      </span>
                    )}
                  </span>
                  <span
                    className={`max-w-[85%] px-3 py-2 text-[15px] leading-relaxed text-[var(--eco-cream)] ${
                      isAgent
                        ? 'rounded-[0.75rem] rounded-tl-sm'
                        : 'rounded-[0.75rem] rounded-tr-sm'
                    }`}
                    style={{
                      background: isAgent
                        ? 'var(--eco-athena-dim)'
                        : 'var(--eco-ink-sunken)',
                      border: `1px solid color-mix(in srgb, ${hue} ${
                        isAgent ? 35 : 22
                      }%, transparent)`,
                    }}
                  >
                    {segment.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}

// ─── Quiz cards (§3.6) ─────────────────────────────────────────────────

const QUIZ_LETTERS = ['A', 'B', 'C', 'D'];

export function QuizCards({
  quizzes,
  canAnswer,
  onAnswer,
  language = 'en',
}: {
  quizzes: QuizCardState[];
  canAnswer: boolean;
  onAnswer: (quizId: string, answer: string) => void;
  language?: LanguageCode;
}) {
  if (quizzes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="eco-label" style={{ color: 'var(--eco-athena)' }}>
        {t('quiz', language)}
      </h2>
      {quizzes.slice(-3).map(({ quiz, myAnswer, myResult, correctAnswer, results }) => (
        <article
          key={quiz.quizId}
          className="eco-panel flex flex-col gap-2.5 p-3.5"
          style={{ borderColor: 'color-mix(in srgb, var(--eco-athena) 30%, var(--eco-rule))' }}
        >
          {quiz.setIndex && quiz.setTotal && (
            <span className="eco-label" style={{ color: 'var(--eco-athena)' }}>
              {t('questionNofTotal', language, { n: quiz.setIndex, total: quiz.setTotal })}
            </span>
          )}
          <p className="text-sm font-medium text-[var(--eco-cream)]">
            {quiz.question}
          </p>
          <ul className="flex flex-col gap-1.5">
            {(quiz.options ?? []).map((option, i) => {
              const chosen = myAnswer === option;
              const isCorrect = correctAnswer === option;
              const revealed = Boolean(correctAnswer) && isCorrect;
              const wrongChoice = chosen && myResult === 'incorrect';
              const emphasis = revealed
                ? 'var(--eco-athena)'
                : wrongChoice
                  ? 'var(--eco-red)'
                  : chosen
                    ? 'var(--eco-athena)'
                    : null;
              return (
                <li key={option}>
                  <button
                    type="button"
                    disabled={!canAnswer || myAnswer !== undefined}
                    onClick={() => onAnswer(quiz.quizId, option)}
                    className="flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-default"
                    style={{
                      borderColor: emphasis ?? 'var(--eco-rule)',
                      background: revealed
                        ? 'var(--eco-athena-dim)'
                        : wrongChoice
                          ? 'var(--eco-red-dim)'
                          : 'var(--eco-ink-sunken)',
                      color: 'var(--eco-cream)',
                      boxShadow: revealed
                        ? '0 0 10px -2px color-mix(in srgb, var(--eco-athena) 55%, transparent)'
                        : 'none',
                    }}
                  >
                    <span
                      className="eco-numerals flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-semibold"
                      style={{
                        borderColor: emphasis ?? 'var(--eco-rule)',
                        color: emphasis ?? 'var(--eco-cream-dim)',
                      }}
                    >
                      {QUIZ_LETTERS[i] ?? '·'}
                    </span>
                    <span className="min-w-0 flex-1">{option}</span>
                    {revealed && (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path
                          d="M3 8.5 6.5 12 13 4"
                          stroke="var(--eco-athena)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {myResult && (
            <p
              className="text-xs font-medium"
              style={{
                color: myResult === 'correct' ? 'var(--eco-athena)' : 'var(--eco-red)',
              }}
            >
              {myResult === 'correct' ? t('correct', language) : t('notQuite', language)}
            </p>
          )}
          {Object.keys(results).length > 0 && (
            <p className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
              {t('answeredCorrectly', language, {
                count: Object.values(results).filter(Boolean).length,
                total: Object.keys(results).length,
              })}
            </p>
          )}
          <p className="text-xs text-[var(--eco-cream-faint)]">
            {t('voiceAnswerPrompt', language)}
          </p>
        </article>
      ))}
    </section>
  );
}

// ─── Gap dashboard, teacher-only (§3.9) ─────────────────────────────────

export function GapPanel({
  gaps,
  participants,
  onQuiz,
  language = 'en',
}: {
  gaps: LearningGap[];
  participants: PublicParticipant[];
  onQuiz: (topic: string, studentIds: string[]) => void;
  language?: LanguageCode;
}) {
  const nameOf = (id: string) =>
    participants.find((p) => p.participantId === id)?.displayName ?? 'someone';

  return (
    <section className="flex flex-col gap-2">
      <h2 className="eco-label">{t('whoNeedsHelp', language)}</h2>
      {gaps.length === 0 ? (
        <p className="text-sm text-[var(--eco-cream-faint)]">
          {t('noGapsYet', language)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gaps.map((gap) => {
            const count = gap.affectedStudentIds.length;
            const severe = count >= 3;
            const moderate = count === 2;
            return (
              <li
                key={gap.gapId}
                className="flex flex-col gap-1 rounded-[0.625rem] border p-3"
                style={{
                  borderColor: severe
                    ? 'var(--eco-red)'
                    : moderate
                      ? 'var(--eco-amber)'
                      : 'var(--eco-rule)',
                  background: severe
                    ? 'var(--eco-red-dim)'
                    : moderate
                      ? 'var(--eco-amber-dim)'
                      : 'var(--eco-ink-sunken)',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--eco-cream)]">
                    {gap.topic}
                  </p>
                  <span className="eco-numerals text-xs text-[var(--eco-cream-dim)]">
                    {t('studentsCount', language, { count })}
                  </span>
                </div>
                <p className="text-xs text-[var(--eco-cream-dim)]">
                  {gap.affectedStudentIds.map(nameOf).join(', ')}
                </p>
                {gap.addressedAt && (
                  <p className="text-xs text-[var(--eco-cream-faint)]">
                    {t('athenaAddressedThis', language)}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onQuiz(gap.topic, gap.affectedStudentIds)}
                  className="self-start rounded-md border px-2 py-1 text-xs text-[var(--eco-cream)]"
                  style={{ borderColor: 'var(--eco-rule)' }}
                >
                  {t('quizTheseStudents', language)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Blocked-attempt audit trail (§3.10) ─────────────────────────────────

const DENIAL_LABEL: Record<string, string> = {
  AGENT_MUTED: 'blocked — you muted the AI',
  STUDENT_INVOCATION_DISABLED:
    'a student called her — floor is closed to students',
  TEACHER_HOLDS_FLOOR: 'blocked — you had the floor',
  AGENT_UNINVITED: 'held back — she started speaking uninvited',
  AGENT_ALREADY_SPEAKING: 'blocked — already speaking',
  TOPIC_DISABLED: 'blocked — topic disabled',
  SILENCE_GAP_TOO_SHORT: 'blocked — no natural pause yet',
  TOPIC_RECENTLY_ADDRESSED: 'held back — she just covered this',
  QUIZ_PAYLOAD_MISSING: 'quiz asked, but the question card never arrived',
  NO_SESSION: 'blocked — session not found',
};

const DRAWING_STAGE_LABEL: Record<IllustrationFailure['stage'], TranslationKey> = {
  spec: 'drawingFailedSpec',
  excalidraw: 'drawingFailedExcalidraw',
  empty: 'drawingFailedEmpty',
};

/**
 * Diagrams that were asked for and never arrived.
 *
 * Deliberately shown to the teacher rather than logged only. Athena says the
 * explanation out loud whether or not the picture lands, so a silent failure
 * leaves the teacher watching an empty board with no way to tell that anything
 * was attempted — and no way to tell a bad half from a broken half when only
 * some of the requests are working.
 */
export function IllustrationFailures({
  failures,
  language = 'en',
}: {
  failures: IllustrationFailure[];
  language?: LanguageCode;
}) {
  if (failures.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="eco-label">{t('drawingFailed', language)}</h2>
      <ul className="eco-numerals flex flex-col gap-0.5 text-xs text-[var(--eco-cream-dim)]">
        {failures
          .slice(-5)
          .reverse()
          .map((failure) => (
            <li key={failure.id}>
              {new Date(failure.at).toLocaleTimeString()} · &ldquo;{failure.topic}&rdquo; —{' '}
              {t(DRAWING_STAGE_LABEL[failure.stage], language)}
            </li>
          ))}
      </ul>
    </section>
  );
}

export function BlockedAttempts({
  attempts,
  language = 'en',
}: {
  attempts: BlockedAttempt[];
  language?: LanguageCode;
}) {
  if (attempts.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="eco-label">{t('aiHeldBack', language)}</h2>
      <ul className="eco-numerals flex flex-col gap-0.5 text-xs text-[var(--eco-cream-dim)]">
        {attempts
          .slice(-5)
          .reverse()
          .map((attempt) => (
            <li key={attempt.id}>
              {new Date(attempt.at).toLocaleTimeString()} ·{' '}
              {DENIAL_LABEL[attempt.reason] ?? attempt.reason}
            </li>
          ))}
      </ul>
    </section>
  );
}