/**
 * Teacher control panel — PS31 §3.10.
 *
 * Every button issues a command to the orchestrator; none of them change local
 * state directly. The mute button in particular must reflect what the
 * orchestrator believes, not what was last clicked, because mute is the veto
 * the whole turn-taking design rests on.
 */

'use client';

import { useState } from 'react';
import type { AgentPolicy, VerbosityLevel, LanguageCode } from '@echosphere/shared-types';
import { t } from '@/lib/i18n';

export interface TeacherControlPanelProps {
  policy: AgentPolicy | null;
  agentRunning: boolean;
  busy: boolean;
  language?: LanguageCode;
  onMute: () => void;
  onResume: () => void;
  onEndTurn: () => void;
  onForceSpeak: (topic: string) => void;
  onVerbosity: (level: VerbosityLevel) => void;
  onSetStudentInvocation: (enabled: boolean) => void;
  onDisableTopic: (topic: string) => void;
  onEnableTopic: (topic: string) => void;
  onStartQuiz: (topic: string) => void;
  onStartAgent: () => void;
  onStopAgent: () => void;
  onEndSession: () => void;
}

export function TeacherControlPanel({
  policy,
  agentRunning,
  busy,
  language = 'en',
  onMute,
  onResume,
  onEndTurn,
  onForceSpeak,
  onVerbosity,
  onSetStudentInvocation,
  onDisableTopic,
  onEnableTopic,
  onStartQuiz,
  onStartAgent,
  onStopAgent,
  onEndSession,
}: TeacherControlPanelProps) {
  const [topic, setTopic] = useState('');
  const [banned, setBanned] = useState('');

  const muted = policy?.muted ?? false;
  const studentsMayInvoke = policy?.studentsMayInvoke ?? false;

  return (
    <section className="eco-panel flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="eco-label">{t('tabControls', language)}</h2>
        <span className="flex items-center gap-1.5 text-xs text-[var(--eco-cream-faint)]">
          <span
            className={`eco-lamp ${agentRunning ? 'eco-lamp-glow' : 'eco-lamp-off'}`}
          />
          {agentRunning ? t('athenaPresent', language) : t('athenaNotStarted', language)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {!agentRunning ? (
          <button
            type="button"
            disabled={busy}
            onClick={onStartAgent}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: 'var(--eco-glow)', color: 'var(--eco-ink)' }}
          >
            {t('bringAthenaIn', language)}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onStopAgent}
            className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream-dim)] disabled:opacity-40"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            Send Athena out
          </button>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={muted ? onResume : onMute}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
          style={
            muted
              ? { borderColor: 'var(--eco-red)', background: 'var(--eco-red)', color: 'var(--eco-ink)' }
              : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
          }
        >
          {muted ? t('unmuteAi', language) : t('muteAi', language)}
        </button>

        <button
          type="button"
          disabled={busy || !agentRunning}
          onClick={onEndTurn}
          className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream-dim)] disabled:opacity-40"
          style={{ borderColor: 'var(--eco-rule)' }}
        >
          Cut off current turn
        </button>
      </div>

      {/*
        The floor gate. While this is off Athena still hears everything and
        keeps building context, but has no route to the floor except the
        buttons below — a student saying her name will not summon her.
      */}
      <div className="eco-panel-sunken flex flex-col gap-1 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--eco-cream)]">
              {studentsMayInvoke
                ? 'Students can call on Athena'
                : 'Athena is listening only'}
            </p>
            <p className="text-xs text-[var(--eco-cream-faint)]">
              {studentsMayInvoke
                ? 'Saying “hey Athena” will get an answer.'
                : 'She hears the lesson and builds context, but will not speak unless you ask her to.'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-pressed={studentsMayInvoke}
            onClick={() => onSetStudentInvocation(!studentsMayInvoke)}
            className="shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
            style={
              studentsMayInvoke
                ? { borderColor: 'var(--eco-green)', background: 'var(--eco-green-dim)', color: 'var(--eco-green)' }
                : { borderColor: 'var(--eco-glow)', color: 'var(--eco-cream)' }
            }
          >
            {studentsMayInvoke ? 'Close the floor' : 'Let students ask'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="eco-label-dim">Explanation length</label>
        <div className="flex gap-1">
          {(['terse', 'normal', 'detailed'] as const).map((level) => (
            <button
              key={level}
              type="button"
              disabled={busy}
              onClick={() => onVerbosity(level)}
              className="flex-1 rounded-lg border px-2 py-1 text-xs capitalize transition-colors disabled:opacity-40"
              style={
                policy?.verbosity === level
                  ? { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
                  : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
              }
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="eco-label-dim">Ask Athena to cover a topic now</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
            style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. least common denominator"
          />
          <button
            type="button"
            disabled={busy || topic.trim().length === 0}
            onClick={() => onForceSpeak(topic.trim())}
            className="rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] disabled:opacity-40"
            style={{ borderColor: 'var(--eco-glow)' }}
          >
            Explain
          </button>
          <button
            type="button"
            disabled={busy || topic.trim().length === 0}
            onClick={() => onStartQuiz(topic.trim())}
            className="rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] disabled:opacity-40"
            style={{ borderColor: 'var(--eco-glow)' }}
          >
            Quiz
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="eco-label-dim">Topics Athena must not discuss</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
            style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
            value={banned}
            onChange={(e) => setBanned(e.target.value)}
            placeholder="e.g. next week's exam"
          />
          <button
            type="button"
            disabled={busy || banned.trim().length === 0}
            onClick={() => {
              onDisableTopic(banned.trim());
              setBanned('');
            }}
            className="rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream-dim)] disabled:opacity-40"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            Block
          </button>
        </div>
        {policy && policy.disabledTopics.length > 0 && (
          <ul className="flex flex-wrap gap-1 pt-1">
            {policy.disabledTopics.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => onEnableTopic(t)}
                  className="rounded-full border px-2 py-0.5 text-xs text-[var(--eco-cream-dim)]"
                  style={{ borderColor: 'var(--eco-rule)' }}
                  title="Click to unblock"
                >
                  {t} ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onEndSession}
        className="self-start rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream-dim)] disabled:opacity-40"
        style={{ borderColor: 'var(--eco-rule)' }}
      >
        End lesson &amp; generate report
      </button>
    </section>
  );
}
