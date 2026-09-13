'use client';

import type { PublicParticipant } from '@echosphere/shared-types';

export function ScreenShareControls({
  participants,
  screenShareAllowed,
  activeScreenShare,
  onSetPermission,
}: {
  participants: PublicParticipant[];
  screenShareAllowed: string[];
  activeScreenShare: { participantId: string; displayName: string } | null;
  onSetPermission: (participantId: string, allowed: boolean) => void;
}) {
  const students = participants.filter((p) => p.role === 'student');

  return (
    <section className="eco-panel flex flex-col gap-3 p-4">
      <h2 className="eco-label">Screen sharing</h2>
      {students.length === 0 ? (
        <p className="text-sm text-[var(--eco-cream-faint)]">No students in the room yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {students.map((student) => {
            const allowed = screenShareAllowed.includes(student.participantId);
            const sharingNow = activeScreenShare?.participantId === student.participantId;
            return (
              <li
                key={student.participantId}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                style={{ borderColor: 'var(--eco-rule)' }}
              >
                <div className="flex flex-col">
                  <span className="text-sm text-[var(--eco-cream)]">{student.displayName}</span>
                  {sharingNow && (
                    <span className="text-xs" style={{ color: 'var(--eco-glow-bright)' }}>
                      Sharing now
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onSetPermission(student.participantId, !allowed)}
                  className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                  style={
                    allowed
                      ? { borderColor: 'var(--eco-green)', background: 'var(--eco-green-dim)', color: 'var(--eco-green)' }
                      : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
                  }
                >
                  {allowed ? 'Revoke' : 'Allow'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}