'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { CatchupMessage } from '@echosphere/shared-types';
import { orchestrator } from '@/lib/orchestrator';

const STUDENT_PROMPTS = [
  'What did I miss?',
  'What did the teacher just say?',
  'Explain with an example',
  'Give me a practice problem',
];

const TEACHER_PROMPTS = [
  'Suggest a check-in question',
  'Give a real-world analogy',
  'Summarize student progress',
  'Draft a board challenge problem',
];

function displayText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, row: string) =>
      `- ${row
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(' - ')}`,
    )
    .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, '$1$2')
    .replace(/\\([()[\]{}])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function CatchupChatbot({
  sessionId,
  participantId,
  displayName,
  role = 'student',
}: {
  sessionId: string;
  participantId: string;
  displayName: string;
  role?: 'student' | 'teacher';
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CatchupMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const prompts = role === 'teacher' ? TEACHER_PROMPTS : STUDENT_PROMPTS;

  // Built on demand rather than during render: `Date.now()` in a render path is
  // impure — React may recompute it on any re-render — and it also made the
  // greeting a new object every pass, which the effect below would depend on.
  const buildGreeting = useCallback(
    (): CatchupMessage => ({
      role: 'athena',
      text:
        role === 'teacher'
          ? `Hello Teacher ${displayName}! I am Athena, your AI Co-Teacher & Pedagogical Copilot. How can I help you with today's lesson, check-in questions, student insights, or quick board examples?`
          : `Hello ${displayName}! I am Athena, your AI Classroom Co-Teacher. If you missed something, have a question, or need a concept explained step-by-step, feel free to ask me anytime!`,
      at: Date.now(),
    }),
    [role, displayName],
  );

  useEffect(() => {
    if (!open) return;
    void orchestrator
      .getCatchup(sessionId, participantId)
      .then((r) => {
        if (r.history && r.history.length > 0) {
          setMessages(r.history);
        } else {
          setMessages([buildGreeting()]);
        }
      })
      .catch(() => {
        setMessages([buildGreeting()]);
      });
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open, sessionId, participantId, buildGreeting]);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, busy]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      setDraft('');
      setMessages((prev) => [...prev, { role: role === 'teacher' ? 'teacher' : 'student', text: trimmed, at: Date.now() }]);
      try {
        const result = await orchestrator.askCatchup(sessionId, participantId, trimmed);
        setMessages(result.history);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reach Athena');
        setMessages((prev) => prev.slice(0, -1));
        setDraft(trimmed);
      } finally {
        setBusy(false);
      }
    },
    [busy, participantId, sessionId, role],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  return (
    <>
      {/* Floating Bottom-Right Launcher Icon */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
        {!open && (
          <div className="hidden sm:flex items-center rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-1.5 text-xs text-[var(--eco-cream)] shadow-lg animate-in fade-in slide-in-from-right-2 duration-200">
            <span className="font-medium">Need help? Ask Athena AI</span>
          </div>
        )}

        <button
          type="button"
          className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 text-base font-bold shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95"
          style={{
            borderColor: 'var(--eco-athena)',
            background: open ? 'var(--eco-ink-raised)' : 'linear-gradient(135deg, var(--eco-athena), #f59e0b)',
            color: open ? 'var(--eco-athena)' : '#0f172a',
            boxShadow: '0 0 20px rgba(245, 158, 11, 0.35)',
          }}
          aria-expanded={open}
          aria-controls="athena-ai-chat"
          aria-label={open ? 'Close Athena AI Chat' : 'Open Athena AI Chat'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <span className="text-xl leading-none">✕</span>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {!open && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500 border border-slate-950" />
            </span>
          )}
        </button>
      </div>

      {/* Expandable Chat Drawer Window */}
      {open && (
        <section
          id="athena-ai-chat"
          className="eco-panel fixed bottom-24 right-6 z-50 flex w-[min(26rem,calc(100vw-2rem))] max-h-[34rem] flex-col rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-200"
          aria-label="Athena AI Assistant Chat"
        >
          {/* Header */}
          <header
            className="flex items-center justify-between border-b px-4 py-3 bg-[var(--eco-ink-sunken)]"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            <div className="flex items-center gap-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="eco-display text-sm font-semibold text-[var(--eco-cream)]">
                    Athena AI Assistant
                  </h3>
                  <span className="rounded-full bg-emerald-950/70 px-2 py-0.5 text-[9px] font-semibold text-emerald-400 border border-emerald-500/30">
                    Live LLM
                  </span>
                </div>
                <p className="text-[11px] text-[var(--eco-cream-faint)]">
                  {role === 'teacher' ? 'Pedagogical copilot & lesson Q&A' : 'Private co-teacher & concept catch-up'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-[var(--eco-cream-faint)] hover:bg-[var(--eco-ink-raised)] hover:text-[var(--eco-cream)]"
            >
              ✕
            </button>
          </header>

          {/* Conversation Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[16rem] max-h-[22rem] bg-[var(--eco-bg)]/40">
            {messages.map((message, index) => {
              const isUser = message.role === 'student' || message.role === 'teacher';

              return (
                <div
                  key={`${message.at}-${index}`}
                  className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-400 text-[11px] font-bold text-slate-950">
                      A
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-amber-400 text-slate-950 font-medium rounded-tr-sm'
                        : 'bg-[var(--eco-ink-sunken)] text-[var(--eco-cream)]/90 border border-[var(--eco-rule)]/60 rounded-tl-sm shadow-sm'
                  }`}
                >
                    <p className="whitespace-pre-line">{displayText(message.text)}</p>
                  </div>
                </div>
              );
            })}

            {busy && (
              <div className="flex items-center gap-2 text-xs text-[var(--eco-cream-faint)] pt-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400" />
                <span>Athena is formulating a response…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts */}
          <div className="flex flex-wrap gap-1.5 border-t border-[var(--eco-rule)]/40 bg-[var(--eco-ink-sunken)]/60 px-3 py-2">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={busy}
                onClick={() => void send(prompt)}
                className="rounded-full border border-[var(--eco-rule)] bg-[var(--eco-ink)] px-2.5 py-1 text-[10px] text-[var(--eco-cream-dim)] hover:border-amber-400/60 hover:text-[var(--eco-cream)] hover:bg-[var(--eco-ink-raised)] disabled:opacity-40 transition"
              >
                {prompt}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-rose-950/60 border-t border-rose-500/30 px-3 py-1.5 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          {/* Input Footer */}
          <form
            onSubmit={onSubmit}
            className="flex gap-2 border-t p-3 bg-[var(--eco-ink-sunken)]"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            <input
              ref={inputRef}
              className="min-w-0 flex-1 rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-ink)] px-3 py-2 text-xs text-[var(--eco-cream)] outline-none placeholder-[var(--eco-cream-faint)]/50 focus:border-amber-400"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={role === 'teacher' ? 'Ask Athena for lesson advice, analogies...' : 'Ask about fractions, what you missed...'}
              maxLength={800}
              disabled={busy}
              aria-label="Athena chatbot input"
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-40 transition"
            >
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}
