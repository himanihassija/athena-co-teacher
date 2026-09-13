'use client';

import { useState, useEffect } from 'react';
import type {
  CatchupAvailabilitySlot,
  LanguageCode,
} from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface CatchupBookingModalProps {
  sessionId: string;
  studentId: string;
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
  defaultTopic?: string;
}

export function CatchupBookingModal({
  sessionId,
  studentId,
  studentName,
  isOpen,
  onClose,
  defaultTopic = 'Unlike Fractions & Common Denominators',
}: CatchupBookingModalProps) {
  const [slots, setSlots] = useState<CatchupAvailabilitySlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [topic, setTopic] = useState(defaultTopic);
  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [loading, setLoading] = useState(true);
  const [isBooking, setIsBooking] = useState(false);
  const [bookedSlot, setBookedSlot] = useState<CatchupAvailabilitySlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setBookedSlot(null);
    orchestratorClient
      .getCatchupSlots(sessionId)
      .then((data: CatchupAvailabilitySlot[]) => {
        setSlots(data);
        const firstAvailable = data.find((s: CatchupAvailabilitySlot) => !s.isBooked);
        if (firstAvailable) setSelectedSlotId(firstAvailable.slotId);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load availability slots');
        setLoading(false);
      });
  }, [sessionId, isOpen]);

  if (!isOpen) return null;

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlotId) return;

    setIsBooking(true);
    setError(null);
    try {
      const booked = await orchestratorClient.bookCatchupSlot(sessionId, {
        slotId: selectedSlotId,
        studentId,
        studentName,
        topic: topic.trim() || defaultTopic,
        notes: notes.trim(),
        language,
      });
      setBookedSlot(booked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setIsBooking(false);
    }
  };

  const handleDownloadCalendar = () => {
    if (!bookedSlot) return;
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Athena EchoSphere//Catchup Tutoring//EN
BEGIN:VEVENT
SUMMARY:1:1 Catch-up Session: ${bookedSlot.topic ?? topic}
DESCRIPTION:1:1 Tutoring session with ${bookedSlot.teacherName} on ${bookedSlot.topic ?? topic}
DTSTART:${bookedSlot.date.replace(/-/g, '')}T${bookedSlot.startTime.replace(/:/g, '')}00Z
DTEND:${bookedSlot.date.replace(/-/g, '')}T${bookedSlot.endTime.replace(/:/g, '')}00Z
LOCATION:Athena EchoSphere Live Room (${sessionId})
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `catchup-${bookedSlot.date}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--eco-ink)_80%,transparent)] p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div>
              <h3 className="eco-display text-base font-semibold text-[var(--eco-cream)]">
                Book 1:1 Catch-up Tutoring Session
              </h3>
              <p className="text-xs text-[var(--eco-cream-faint)]">
                Schedule a focused 30-min session with your teacher & Athena AI
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-lg text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
          >
            ✕
          </button>
        </header>

        <div className="p-5">
          {bookedSlot ? (
            <div className="text-center py-6 space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--eco-green)_20%,transparent)] text-2xl text-[var(--eco-green)] ring-1 ring-emerald-500/40">
                ✓
              </div>
              <h4 className="eco-display text-lg font-semibold text-[var(--eco-cream)]">
                Session Confirmed!
              </h4>
              <p className="text-xs text-[var(--eco-cream)]/90 max-w-sm mx-auto">
                Your 1:1 tutoring session with <strong>{bookedSlot.teacherName}</strong> is scheduled for{' '}
                <strong>{bookedSlot.date}</strong> from <strong>{bookedSlot.startTime} to {bookedSlot.endTime}</strong>.
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDownloadCalendar}
                  className="rounded-lg bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] px-4 py-2 text-xs font-semibold text-[var(--eco-amber)] ring-1 ring-amber-400/40 hover:bg-[color-mix(in_srgb,var(--eco-amber)_30%,transparent)]"
                >
                  Add to Calendar (.ics)
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-[var(--eco-rule)] px-4 py-2 text-xs font-semibold text-[var(--eco-cream)]"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleBook} className="space-y-4">
              {error && (
                <div className="rounded-lg border border-[color-mix(in_srgb,var(--eco-red)_30%,transparent)] bg-[color-mix(in_srgb,var(--eco-red)_10%,transparent)] p-3 text-xs text-[var(--eco-red)]">
                  {error}
                </div>
              )}

              {/* Slot Picker */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-[var(--eco-cream)]">
                    Select Available Date & Time Slot
                  </label>
                  {slots.length > 0 && (
                    <span className="text-[10px] text-emerald-400 font-medium">
                      {slots.filter((s) => !s.isBooked).length} slots available
                    </span>
                  )}
                </div>

                {loading ? (
                  <p className="mt-2 text-xs text-[var(--eco-cream-faint)]">Loading teacher availability...</p>
                ) : (
                  <>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-48 overflow-y-auto pr-1">
                      {slots.map((slot) => {
                        const isSelected = selectedSlotId === slot.slotId;
                        const isBooked = slot.isBooked;

                        return (
                          <button
                            key={slot.slotId}
                            type="button"
                            disabled={isBooked}
                            onClick={() => setSelectedSlotId(slot.slotId)}
                            className={`rounded-xl border p-3 text-left text-xs transition ${
                              isBooked
                                ? 'border-[var(--eco-rule)] bg-[var(--eco-ink)]/40 opacity-40 cursor-not-allowed'
                                : isSelected
                                ? 'border-[var(--eco-amber)] bg-amber-950/30 text-amber-300 ring-1 ring-amber-400 font-semibold shadow-sm'
                                : 'border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] text-[var(--eco-cream)]/90 hover:border-amber-400/50 hover:bg-[var(--eco-ink-raised)]'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-[var(--eco-cream)]">{slot.date}</span>
                              <span className="rounded bg-[var(--eco-panel)] px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                                {slot.startTime} - {slot.endTime}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--eco-cream-faint)]">
                              <span>{slot.teacherName}</span>
                              <span>{isBooked ? '✗ Booked' : '✓ Available'}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Topic & Details */}
              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">
                  Focus Topic / Concept
                </label>
                <input
                  type="text"
                  required
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-2 text-xs text-[var(--eco-cream)] focus:border-[var(--eco-amber)] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--eco-cream)]">
                    Preferred Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                    className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-2 text-xs text-[var(--eco-cream)] focus:border-[var(--eco-amber)] focus:outline-none"
                  >
                    <option value="en">English (US)</option>
                    <option value="hi">Hindi (हिन्दी)</option>
                    <option value="es">Spanish (Español)</option>
                    <option value="fr">French (Français)</option>
                    <option value="de">German (Deutsch)</option>
                    <option value="ta">Tamil (தமிழ்)</option>
                    <option value="te">Telugu (తెలుగు)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--eco-cream)]">
                    Student Name
                  </label>
                  <input
                    type="text"
                    disabled
                    value={studentName}
                    className="mt-1 w-full rounded-lg border border-[var(--eco-rule)]/50 bg-[var(--eco-ink-sunken)] px-3 py-2 text-xs text-[var(--eco-cream-faint)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">
                  Specific questions or notes for the session
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. I got confused on the 2nd quiz when converting denominators."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-2 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-amber)] focus:outline-none"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--eco-rule)]/40 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isBooking || !selectedSlotId}
                  className="rounded-lg bg-[var(--eco-amber)] px-4 py-2 text-xs font-semibold text-[var(--eco-ink)] hover:bg-[var(--eco-amber)] disabled:opacity-50 transition"
                >
                  {isBooking ? 'Booking...' : 'Confirm Booking'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
