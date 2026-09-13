'use client';

import { useState, useEffect } from 'react';
import type { AbsentStudentPacket } from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface AbsentStudentPacketModalProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenCatchupBooking?: () => void;
}

export function AbsentStudentPacketModal({
  sessionId,
  isOpen,
  onClose,
  onOpenCatchupBooking,
}: AbsentStudentPacketModalProps) {
  const [packet, setPacket] = useState<AbsentStudentPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Dispatch States
  const [studentName, setStudentName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [parentNote, setParentNote] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<{
    success: boolean;
    channel: string;
    msg: string;
    whatsappLink?: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setDispatchStatus(null);
    orchestratorClient
      .getAbsentPacket(sessionId)
      .then((data: AbsentStudentPacket) => {
        setPacket(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to generate packet');
        setLoading(false);
      });
  }, [sessionId, isOpen]);

  if (!isOpen) return null;

  const handleSelectAnswer = (quizId: string, option: string) => {
    if (quizSubmitted) return;
    setQuizAnswers((prev) => ({ ...prev, [quizId]: option }));
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDispatch = async (channel: 'whatsapp' | 'email' | 'both') => {
    if (!recipientPhone && channel === 'whatsapp') {
      setDispatchStatus({
        success: false,
        channel,
        msg: 'Please enter a WhatsApp phone number (with country code).',
      });
      return;
    }
    if (!recipientEmail && channel === 'email') {
      setDispatchStatus({
        success: false,
        channel,
        msg: 'Please enter a recipient email address.',
      });
      return;
    }

    setIsDispatching(true);
    setDispatchStatus(null);

    try {
      const res = await orchestratorClient.dispatchAbsentPacket(sessionId, {
        sessionId,
        studentName: studentName.trim() || 'Student',
        recipientPhone: recipientPhone.trim(),
        recipientEmail: recipientEmail.trim(),
        channel,
        includeQuiz: true,
        includeTranscript: true,
        parentNote: parentNote.trim(),
      });

      // `res.emailSent` reports whether the server actually delivered the mail;
      // a composed-but-undelivered packet used to show up here as a success.
      const emailFailed = channel !== 'whatsapp' && res.emailSent === false;

      setDispatchStatus({
        success: !emailFailed,
        channel,
        msg: emailFailed
          ? `Email could not be sent: ${res.emailError ?? 'unknown error'}. Opening your mail app as a fallback.`
          : res.emailSent
          ? `Email sent to ${recipientEmail || 'the parent on file'} via ${res.emailProvider}. (Receipt: ${res.deliveryReceiptId})`
          : `Successfully prepared ${channel.toUpperCase()} digest! (Receipt: ${res.deliveryReceiptId})`,
        whatsappLink: res.whatsappDeepLink,
      });

      if (channel === 'whatsapp' || channel === 'both') {
        window.open(res.whatsappDeepLink, '_blank');
      }

      // Only hand the teacher a mailto when the server could not deliver —
      // doing it unconditionally made a failed send look like a successful one.
      if (emailFailed) {
        const mailto = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(res.emailSubject)}&body=${encodeURIComponent(res.whatsappMessageText)}`;
        window.location.href = mailto;
      }
    } catch (err) {
      setDispatchStatus({
        success: false,
        channel,
        msg: err instanceof Error ? err.message : 'Failed to dispatch packet',
      });
    } finally {
      setIsDispatching(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--eco-ink)_80%,transparent)] p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-bg)] shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="eco-display text-lg font-semibold text-[var(--eco-cream)]">
                  The Absent-Student Packet
                </h2>
                <span className="rounded-full bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--eco-amber)] ring-1 ring-amber-400/40">
                  Comprehensive Lesson Catch-Up
                </span>
              </div>
              <p className="text-xs text-[var(--eco-cream-faint)]">
                {packet?.lessonTitle ? `${packet.lessonTitle} · ` : ''}Everything you missed, structured with AI co-teacher notes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-lg bg-[var(--eco-panel)] px-3 py-1.5 text-xs font-medium text-[var(--eco-cream)] ring-1 ring-[var(--eco-rule)] hover:bg-[var(--eco-ink-raised)]"
            >
              Print / PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-[var(--eco-cream-faint)] hover:bg-[var(--eco-ink-raised)] hover:text-[var(--eco-cream)]"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-[var(--eco-cream-faint)]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--eco-amber)] border-t-transparent" />
              <p className="text-sm">Synthesizing lesson notes, audio timeline & diagnostic quiz...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--eco-red)_30%,transparent)] bg-[color-mix(in_srgb,var(--eco-red)_10%,transparent)] p-6 text-center text-[var(--eco-red)]">
              <p className="font-medium">Could not generate absent packet</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : packet ? (
            <>
              {/* Dispatch Action Panel */}
              <section className="rounded-xl border border-[color-mix(in_srgb,var(--eco-athena)_40%,transparent)] bg-gradient-to-br from-[var(--eco-ink-sunken)] to-[var(--eco-panel)] p-5 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--eco-rule)]/40 pb-3">
                  <div className="flex items-center gap-2">
                    <div>
                      <h3 className="eco-display text-sm font-semibold text-[var(--eco-cream)]">
                        Dispatch Packet to Absent Student & Parents
                      </h3>
                      <p className="text-[11px] text-[var(--eco-cream-faint)]">
                        Instantly deliver the full transcript, takeaways, and quiz via WhatsApp and Email
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                      ⚡ AI Auto-Formatted
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--eco-cream-dim)] mb-1">
                      Student Name
                    </label>
                    <input
                      type="text"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="e.g. Alex Rivera"
                      className="w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink)] px-3 py-1.5 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-athena)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--eco-cream-dim)] mb-1">
                      WhatsApp Phone (with country code)
                    </label>
                    <input
                      type="tel"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="+1234567890"
                      className="w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink)] px-3 py-1.5 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-athena)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--eco-cream-dim)] mb-1">
                      Parent / Student Email
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="parent@example.com"
                      className="w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink)] px-3 py-1.5 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-athena)] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-[11px] font-medium text-[var(--eco-cream-dim)] mb-1">
                    Custom Teacher / AI Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={parentNote}
                    onChange={(e) => setParentNote(e.target.value)}
                    placeholder="e.g. Please review the 3 diagnostic quiz questions before tomorrow's class!"
                    className="w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink)] px-3 py-1.5 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-athena)] focus:outline-none"
                  />
                </div>

                {dispatchStatus && (
                  <div
                    className={`mt-3 rounded-lg p-2.5 text-xs flex items-center justify-between gap-2 ${
                      dispatchStatus.success
                        ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                        : 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                    }`}
                  >
                    <span>{dispatchStatus.msg}</span>
                    {dispatchStatus.whatsappLink && (
                      <a
                        href={dispatchStatus.whatsappLink}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-slate-950 hover:bg-emerald-400"
                      >
                        Open WhatsApp ↗
                      </a>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isDispatching}
                    onClick={() => void handleDispatch('whatsapp')}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition"
                  >
                    <span>Share via WhatsApp</span>
                  </button>

                  <button
                    type="button"
                    disabled={isDispatching}
                    onClick={() => void handleDispatch('email')}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50 transition"
                  >
                    <span>Send via Email</span>
                  </button>

                  <button
                    type="button"
                    disabled={isDispatching}
                    onClick={() => void handleDispatch('both')}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--eco-athena)] px-3.5 py-1.5 text-xs font-semibold text-[var(--eco-ink)] shadow-sm hover:brightness-110 disabled:opacity-50 transition"
                  >
                    <span>Dispatch Both (Omni-channel)</span>
                  </button>
                </div>
              </section>

              {/* Section 1: Executive Summary */}
              <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--eco-amber)]">
                  Section 1: Executive Summary
                </div>
                <h3 className="mt-1 eco-display text-base font-medium text-[var(--eco-cream)]">
                  {packet.lessonTitle} ({packet.durationMinutes} minutes class)
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[var(--eco-cream)]/90 whitespace-pre-line">
                  {packet.executiveSummary}
                </p>

                {/* Key Takeaways */}
                <div className="mt-4 border-t border-[var(--eco-rule)]/40 pt-3">
                  <h4 className="text-xs font-semibold text-[var(--eco-cream)]">Key Learning Takeaways:</h4>
                  <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {packet.keyTakeaways.map((takeaway, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 rounded-lg bg-[var(--eco-ink-sunken)] p-2.5 text-xs text-[var(--eco-cream)]/90 border border-[var(--eco-rule)]/30"
                      >
                        <span className="font-bold text-[var(--eco-amber)]">✓</span>
                        <span>{takeaway}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              {/* Section 2: Flagged Misconceptions */}
              {packet.flaggedConcepts.length > 0 && (
                <section className="rounded-xl border border-[color-mix(in_srgb,var(--eco-athena)_30%,transparent)] bg-[color-mix(in_srgb,var(--eco-athena)_10%,var(--eco-ink-sunken))] p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--eco-athena)]">
                    Section 2: Core Concepts & Pitfalls Addressed
                  </div>
                  <div className="mt-3 space-y-3">
                    {packet.flaggedConcepts.map((item, idx) => (
                      <div key={idx} className="rounded-lg bg-[var(--eco-ink-sunken)] p-3 border border-[color-mix(in_srgb,var(--eco-athena)_20%,transparent)]">
                        <h4 className="text-xs font-semibold text-[var(--eco-athena)]">{item.concept}</h4>
                        <p className="mt-1 text-xs text-[var(--eco-cream)]/80 leading-relaxed">
                          {item.explanation}
                        </p>
                        <p className="mt-1.5 text-[11px] text-[var(--eco-amber)]/90 italic">
                          Common Pitfall: {item.commonMisconception}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 3: Audio Timeline Highlights */}
              <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--eco-blue)]">
                  Section 3: Key Audio Highlights
                </div>
                <div className="mt-3 space-y-2 max-h-56 overflow-y-auto">
                  {packet.timelineHighlights.length === 0 ? (
                    <p className="text-xs text-[var(--eco-cream-faint)]">No recorded moments.</p>
                  ) : (
                    packet.timelineHighlights.map((hl, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 rounded-lg bg-[var(--eco-ink-sunken)] p-2.5 text-xs border border-[var(--eco-rule)]/30"
                      >
                        <span className="rounded bg-[color-mix(in_srgb,var(--eco-blue)_20%,transparent)] px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--eco-blue)]">
                          {hl.speaker}
                        </span>
                        <div className="flex-1">
                          <p className="text-[var(--eco-cream)]/90">&ldquo;{hl.text}&rdquo;</p>
                          <span className="mt-0.5 block text-[10px] text-[var(--eco-cream-faint)]">
                            {hl.significance}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Section 4: Shared Workspace Sticky Notes Snapshot */}
              {packet.stickyNotesSnapshot.length > 0 && (
                <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--eco-amber)]">
                    Section 4: Shared Workspace & Held-Back Doubts
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {packet.stickyNotesSnapshot.slice(0, 6).map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg border border-[color-mix(in_srgb,var(--eco-amber)_30%,transparent)] bg-[color-mix(in_srgb,var(--eco-amber)_10%,var(--eco-ink-sunken))] p-3 text-xs"
                      >
                        <div className="flex items-center justify-between text-[10px] text-[var(--eco-amber)]">
                          <span className="font-semibold">{note.topic}</span>
                          <span>by {note.authorName}</span>
                        </div>
                        <p className="mt-1 text-[var(--eco-cream)]/90 leading-relaxed">{note.content}</p>
                        {note.suggestedAnswer && (
                          <p className="mt-1.5 text-[11px] text-[var(--eco-amber)]/80 bg-[var(--eco-ink-sunken)] p-1.5 rounded">
                            Athena: {note.suggestedAnswer}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 5: Diagnostic Quick-Check Quiz */}
              <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--eco-green)]">
                    Section 5: Diagnostic Quick-Check
                  </div>
                  {quizSubmitted && (
                    <span className="rounded-full bg-[color-mix(in_srgb,var(--eco-green)_20%,transparent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--eco-green)]">
                      Graded
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-4">
                  {packet.diagnosticQuiz.map((q, idx) => {
                    const selected = quizAnswers[q.quizId];
                    const isCorrect = selected === q.correctAnswer;

                    return (
                      <div key={q.quizId} className="rounded-lg bg-[var(--eco-ink-sunken)] p-4 border border-[var(--eco-rule)]/30">
                        <p className="text-xs font-semibold text-[var(--eco-cream)]">
                          {idx + 1}. {q.question}
                        </p>

                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {q.options?.map((opt, optIdx) => {
                            let btnStyle = 'border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] text-[var(--eco-cream)]/80 hover:bg-[var(--eco-ink-raised)]';
                            if (quizSubmitted) {
                              if (opt === q.correctAnswer) {
                                btnStyle = 'border-[var(--eco-green)] bg-[color-mix(in_srgb,var(--eco-green)_20%,transparent)] text-[var(--eco-green)] font-semibold';
                              } else if (selected === opt) {
                                btnStyle = 'border-[var(--eco-red)] bg-[color-mix(in_srgb,var(--eco-red)_20%,transparent)] text-[var(--eco-red)]';
                              }
                            } else if (selected === opt) {
                              btnStyle = 'border-[var(--eco-amber)] bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] text-[var(--eco-amber)] font-semibold';
                            }

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => handleSelectAnswer(q.quizId, opt)}
                                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${btnStyle}`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>

                        {quizSubmitted && (
                          <div className="mt-2 text-xs">
                            {isCorrect ? (
                              <span className="font-semibold text-[var(--eco-green)]">✓ Correct!</span>
                            ) : (
                              <span className="text-[var(--eco-red)]">
                                ✗ Incorrect. Correct answer is: <strong>{q.correctAnswer}</strong>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {!quizSubmitted && packet.diagnosticQuiz.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuizSubmitted(true)}
                    className="mt-4 rounded-lg bg-[var(--eco-green)] px-4 py-2 text-xs font-semibold text-[var(--eco-ink)] hover:bg-[var(--eco-green)]"
                  >
                    Submit & Check Understanding
                  </button>
                )}
              </section>

              {/* Section 6: Next Steps & Catch-up CTA */}
              <section className="rounded-xl border border-[color-mix(in_srgb,var(--eco-amber)_40%,transparent)] bg-gradient-to-r from-amber-950/30 to-yellow-950/30 p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="eco-display text-sm font-semibold text-[var(--eco-amber)]">
                    Still have questions or need 1:1 guidance?
                  </h4>
                  <p className="mt-1 text-xs text-[var(--eco-cream)]/80">
                    Book a live 1:1 catch-up tutoring session or start an interactive chat with Athena.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCatchupBooking?.();
                    }}
                    className="rounded-lg bg-[var(--eco-amber)] px-4 py-2 text-xs font-semibold text-[var(--eco-ink)] hover:bg-[var(--eco-amber)] shadow-md transition"
                  >
                    Schedule 1:1 Catch-up
                  </button>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
