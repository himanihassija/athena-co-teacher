'use client';

import { useState } from 'react';
import type { LearningGap, TeachingAssistantMode, TeachingAssistantResponse } from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface OneOnOneTutorModalProps {
  sessionId: string;
  studentId: string;
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
  gaps: LearningGap[];
}

interface AssistantTurn {
  role: 'student' | 'athena';
  text: string;
  mode?: TeachingAssistantMode;
  analogy?: string;
  steps?: string[];
  practice?: TeachingAssistantResponse['interactivePractice'];
}

export function OneOnOneTutorModal({
  sessionId,
  studentId,
  studentName,
  isOpen,
  onClose,
  gaps,
}: OneOnOneTutorModalProps) {
  const [selectedMode, setSelectedMode] = useState<TeachingAssistantMode>('step_by_step');
  const [hintLevel, setHintLevel] = useState<number>(1);
  const [messages, setMessages] = useState<AssistantTurn[]>([
    {
      role: 'athena',
      text: `Hello ${studentName}! I am your personal AI Teaching Assistant. I am here to help you master any tricky concept at your own pace without pressure.`,
      analogy: `Remember: Math is like building with LEGO blocks — we just need to get the foundation pieces in place first!`,
      steps: [
        'Step 1: Choose a mode below (Step-by-Step, Socratic Hints, Concept Simplifier, or Practice)',
        'Step 2: Ask any question or click a flagged topic to begin',
      ],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [practiceAnswer, setPracticeAnswer] = useState<Record<number, string>>({});
  const [practiceGraded, setPracticeGraded] = useState<Record<number, boolean>>({});

  if (!isOpen) return null;

  const handleSend = async (queryText?: string, modeOverride?: TeachingAssistantMode) => {
    const query = (queryText ?? input).trim();
    if (!query || loading) return;

    const currentMode = modeOverride ?? selectedMode;
    setMessages((prev) => [...prev, { role: 'student', text: query, mode: currentMode }]);
    if (!queryText) setInput('');
    setLoading(true);

    try {
      const res = await orchestratorClient.askTeachingAssistant(sessionId, {
        sessionId,
        studentId,
        studentName,
        question: query,
        mode: currentMode,
        hintLevel,
      });

      setMessages((prev) => [
        ...prev,
        {
          role: 'athena',
          text: res.reply,
          mode: res.mode,
          analogy: res.analogyOrExample,
          steps: res.stepByStepSteps,
          practice: res.interactivePractice,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'athena',
          text: `Let's break down "${query}" step-by-step: Whenever we add unlike fractions, find the common denominator first, multiply numerators accordingly, and then add!`,
          analogy: `Think of a pizza with equal slices before sharing.`,
          steps: [
            '1. Find the Least Common Denominator (LCD)',
            '2. Multiply top and bottom to match the LCD',
            '3. Add the top numbers (numerators)',
          ],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: string, mode: TeachingAssistantMode) => {
    setSelectedMode(mode);
    void handleSend(prompt, mode);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--eco-ink)_80%,transparent)] p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="eco-display text-base font-semibold text-[var(--eco-cream)]">
                  AI Teaching Assistant for {studentName}
                </h3>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400 ring-1 ring-amber-400/30">
                  Adaptive Remediation
                </span>
              </div>
              <p className="text-xs text-[var(--eco-cream-faint)]">
                Patient, step-by-step Socratic scaffolding & visual analogies
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-[var(--eco-cream-faint)] hover:bg-[var(--eco-ink-raised)] hover:text-[var(--eco-cream)]"
          >
            ✕
          </button>
        </header>

        {/* Mode Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)]/60 px-5 py-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-[var(--eco-cream-faint)] mr-1">Tutor Mode:</span>
            <button
              type="button"
              onClick={() => setSelectedMode('step_by_step')}
              className={`rounded-lg px-2.5 py-1 transition ${
                selectedMode === 'step_by_step'
                  ? 'bg-[var(--eco-athena)] text-[var(--eco-ink)] font-semibold'
                  : 'bg-[var(--eco-ink)] text-[var(--eco-cream-dim)] hover:text-[var(--eco-cream)]'
              }`}
            >
              Step-by-Step
            </button>
            <button
              type="button"
              onClick={() => setSelectedMode('socratic_hint')}
              className={`rounded-lg px-2.5 py-1 transition ${
                selectedMode === 'socratic_hint'
                  ? 'bg-amber-400 text-[var(--eco-ink)] font-semibold'
                  : 'bg-[var(--eco-ink)] text-[var(--eco-cream-dim)] hover:text-[var(--eco-cream)]'
              }`}
            >
              Socratic Hints
            </button>
            <button
              type="button"
              onClick={() => setSelectedMode('concept_simplify')}
              className={`rounded-lg px-2.5 py-1 transition ${
                selectedMode === 'concept_simplify'
                  ? 'bg-emerald-400 text-[var(--eco-ink)] font-semibold'
                  : 'bg-[var(--eco-ink)] text-[var(--eco-cream-dim)] hover:text-[var(--eco-cream)]'
              }`}
            >
              Visual Analogy
            </button>
            <button
              type="button"
              onClick={() => setSelectedMode('practice_problem')}
              className={`rounded-lg px-2.5 py-1 transition ${
                selectedMode === 'practice_problem'
                  ? 'bg-blue-400 text-[var(--eco-ink)] font-semibold'
                  : 'bg-[var(--eco-ink)] text-[var(--eco-cream-dim)] hover:text-[var(--eco-cream)]'
              }`}
            >
              Practice Problem
            </button>
          </div>

          {selectedMode === 'socratic_hint' && (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-[var(--eco-cream-faint)]">Hint Level:</span>
              {[1, 2, 3].map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setHintLevel(lvl)}
                  className={`h-5 w-5 rounded-full text-[10px] font-bold transition ${
                    hintLevel === lvl
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-[var(--eco-ink)] text-[var(--eco-cream-faint)]'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Flagged Topics Pills */}
        {gaps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--eco-rule)]/40 bg-[var(--eco-ink-sunken)] px-5 py-2 text-xs">
            <span className="text-[11px] font-semibold text-amber-400 mr-1">Identified Misconceptions:</span>
            {gaps.map((gap) => (
              <button
                key={gap.gapId}
                type="button"
                onClick={() =>
                  handleQuickPrompt(
                    `Can you explain why "${gap.description}" happens and show me the easy way to solve it?`,
                    'step_by_step',
                  )
                }
                className="rounded-md bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-300 border border-amber-500/30 hover:bg-amber-900/40 transition"
              >
                {gap.topic} ↗
              </button>
            ))}
          </div>
        )}

        {/* Message / Card Flow */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-[16rem]">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${m.role === 'student' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'athena' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-400 to-yellow-300 text-xs font-bold text-slate-950">
                  A
                </div>
              )}
              <div
                className={`max-w-xl space-y-2.5 rounded-2xl p-3.5 text-xs leading-relaxed ${
                  m.role === 'student'
                    ? 'bg-amber-400 text-slate-950 font-medium'
                    : 'bg-[var(--eco-ink-sunken)] text-[var(--eco-cream)]/90 border border-[var(--eco-rule)]'
                }`}
              >
                <p className="whitespace-pre-line">{m.text}</p>

                {/* Visual Analogy Card */}
                {m.analogy && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-2.5 text-amber-200">
                    <p className="text-[11px] font-medium leading-relaxed">{m.analogy}</p>
                  </div>
                )}

                {/* Numbered Steps */}
                {m.steps && m.steps.length > 0 && (
                  <div className="rounded-xl border border-[var(--eco-rule)]/60 bg-[var(--eco-ink)] p-3 space-y-1.5">
                    <h5 className="text-[11px] font-semibold text-[var(--eco-cream)]">
                      Step-by-Step Breakdown:
                    </h5>
                    {m.steps.map((st, sIdx) => (
                      <div key={sIdx} className="flex items-start gap-2 text-[11px] text-[var(--eco-cream-dim)]">
                        <span className="font-semibold text-amber-400">{sIdx + 1}.</span>
                        <span>{st.replace(/^Step \d+:\s*/i, '')}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Interactive Diagnostic Practice Card */}
                {m.practice && (
                  <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                        Quick Diagnostic Practice
                      </span>
                      {practiceGraded[idx] && (
                        <span className="text-[10px] font-semibold text-emerald-400">
                          {practiceAnswer[idx] === m.practice.correctAnswer ? '✓ Correct!' : '✗ Try again!'}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-semibold text-[var(--eco-cream)]">
                      {m.practice.question}
                    </p>

                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {m.practice.options.map((opt, oIdx) => {
                        const isSelected = practiceAnswer[idx] === opt;
                        const isCorrect = opt === m.practice?.correctAnswer;
                        let btnStyle = 'border-[var(--eco-rule)] bg-[var(--eco-ink)] text-[var(--eco-cream-dim)] hover:bg-[var(--eco-ink-raised)]';

                        if (practiceGraded[idx]) {
                          if (isCorrect) {
                            btnStyle = 'border-emerald-500 bg-emerald-950/40 text-emerald-300 font-semibold';
                          } else if (isSelected) {
                            btnStyle = 'border-rose-500 bg-rose-950/40 text-rose-300';
                          }
                        } else if (isSelected) {
                          btnStyle = 'border-amber-400 bg-amber-950/40 text-amber-300 font-semibold';
                        }

                        return (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() => {
                              setPracticeAnswer((prev) => ({ ...prev, [idx]: opt }));
                              setPracticeGraded((prev) => ({ ...prev, [idx]: true }));
                            }}
                            className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition ${btnStyle}`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    {practiceGraded[idx] && (
                      <p className="text-[10px] text-blue-200/90 pt-1">
                        {m.practice.explanation}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-[var(--eco-cream-faint)]">
              <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400" />
              <span>Athena is breaking this down into simple steps...</span>
            </div>
          )}
        </div>

        {/* Quick Suggestion Chips */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--eco-rule)]/40 bg-[var(--eco-ink-sunken)] px-4 py-2">
          <button
            type="button"
            onClick={() => handleQuickPrompt('Can you give me a simple pizza analogy for common denominators?', 'concept_simplify')}
            className="rounded-full bg-[var(--eco-panel)] px-2.5 py-1 text-[10px] text-[var(--eco-cream-dim)] ring-1 ring-[var(--eco-rule)] hover:bg-[var(--eco-ink-raised)] transition"
          >
            Pizza Analogy
          </button>
          <button
            type="button"
            onClick={() => handleQuickPrompt('Give me a step-by-step example for finding the LCD of 4 and 6', 'step_by_step')}
            className="rounded-full bg-[var(--eco-panel)] px-2.5 py-1 text-[10px] text-[var(--eco-cream-dim)] ring-1 ring-[var(--eco-rule)] hover:bg-[var(--eco-ink-raised)] transition"
          >
            LCD of 4 & 6
          </button>
          <button
            type="button"
            onClick={() => handleQuickPrompt('Give me a practice problem to test if I understand adding unlike fractions', 'practice_problem')}
            className="rounded-full bg-[var(--eco-panel)] px-2.5 py-1 text-[10px] text-[var(--eco-cream-dim)] ring-1 ring-[var(--eco-rule)] hover:bg-[var(--eco-ink-raised)] transition"
          >
            Practice Question
          </button>
        </div>

        {/* Input Footer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="border-t border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] p-4"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={`Ask for help in ${selectedMode.replace('_', ' ')} mode...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-ink)] px-4 py-2.5 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-50 transition"
            >
              Ask AI Assistant
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
