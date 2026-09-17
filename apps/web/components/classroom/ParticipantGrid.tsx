'use client';

import { useMemo } from 'react';
import type { PublicParticipant } from '@echosphere/shared-types';
import { seatColorVar } from '@/lib/seatColor';
import { initialsOf } from '@/components/classroom/panels';
import { AthenaTalkingHead } from './AthenaTalkingHeadLazy';

interface Tile {
  key: string;
  participantId: string | null;
  name: string;
  role: 'Teacher' | 'Student' | 'Athena';
  color: string;
  speaking: boolean;
  isSelf: boolean;
  handRaised: boolean;
  isAgent?: boolean;
  agentPresent?: boolean;
}

function MicOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 0 0 3-3v-1M9 5.5A3 3 0 0 1 15 6v3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 11a7 7 0 0 1-9.8 6.4M5 11a7 7 0 0 0 2.2 5.1M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M7 5.5a8 8 0 1 0 10 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ParticipantGrid({
  sessionId,
  participants,
  agentPresent,
  agentUid,
  speakingUid,
  selfUid,
  selfMicEnabled,
  raisedHands = [],
  agentMuted = false,
  onToggleAgentMute,
  agentBusy = false,
  onToggleAgentPresence,
  athenaAudioTrack,
}: {
  /** Kept for API compatibility with the previous Anam integration; unused now. */
  sessionId: string;
  participants: PublicParticipant[];
  agentPresent: boolean;
  agentUid?: string;
  speakingUid?: string | null;
  selfUid: string;
  selfMicEnabled: boolean;
  /** participantIds with a raised hand, from useClassroom's `raisedHands`. */
  raisedHands?: string[];
  /** Whether Athena is currently muted. Only meaningful when she's present. */
  agentMuted?: boolean;
  /**
   * Toggle Athena's mute state. Only rendered (as an icon on her tile) when
   * this is provided — student view omits it, since only the teacher can
   * mute/unmute Athena.
   */
  onToggleAgentMute?: () => void;
  /** Disables the presence toggle while a start/stop request is in flight. */
  agentBusy?: boolean;
  /**
   * Toggle Athena's presence in the room (bring in / send out), replacing
   * the separate "Bring Athena in" / "Send Athena out" header buttons.
   * Rendered as a single icon on her tile — always visible when supplied,
   * regardless of whether she's currently present, since this is what
   * brings her in too. Student view never passes this.
   */
  onToggleAgentPresence?: () => void;
  /**
   * Athena's live remote audio track (from ClassroomAudio's
   * onAthenaAudioTrack). Passed straight through to AthenaTalkingHead for
   * amplitude-driven lip-sync — Agora's resold TTS carries no viseme timing,
   * so this raw track is the only signal available for mouth movement.
   */
  athenaAudioTrack?: any;
}) {
  const teacher = participants.find((p) => p.role === 'teacher');
  const students = participants.filter((p) => p.role === 'student');

  const tiles: Tile[] = [];

  if (teacher) {
    tiles.push({
      key: teacher.participantId,
      participantId: teacher.participantId,
      name: teacher.displayName,
      role: 'Teacher',
      color: seatColorVar(teacher.participantId),
      speaking: speakingUid != null && speakingUid === teacher.uid,
      isSelf: teacher.uid === selfUid,
      handRaised: raisedHands.includes(teacher.participantId),
    });
  }

  tiles.push({
    key: '__athena__',
    participantId: null,
    name: 'Athena',
    role: 'Athena',
    color: 'var(--eco-athena)',
    speaking: agentPresent && speakingUid != null && speakingUid === agentUid,
    isSelf: false,
    handRaised: false,
    isAgent: true,
    agentPresent,
  });

  for (const student of students) {
    tiles.push({
      key: student.participantId,
      participantId: student.participantId,
      name: student.displayName,
      role: 'Student',
      color: seatColorVar(student.participantId),
      speaking: speakingUid != null && speakingUid === student.uid,
      isSelf: student.uid === selfUid,
      handRaised: raisedHands.includes(student.participantId),
    });
  }

  // Meet-style reflow: near-square grid that grows/shrinks with headcount
  // rather than a fixed column count, so 3 tiles fill the stage as fully as
  // 9 tiles do.
  const columns = useMemo(() => {
    const n = tiles.length;
    if (n <= 1) return 1;
    if (n <= 4) return 2;
    if (n <= 9) return 3;
    return 4;
  }, [tiles.length]);

  const rows = Math.max(1, Math.ceil(tiles.length / columns));

  return (
    <div
      className="grid flex-1 gap-3"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((tile) => {
        // Athena, once she's present, gets a full-bleed 3D-avatar tile —
        // same "video-call tile" treatment the Anam integration used, just
        // filled with TalkingHead's Three.js canvas instead of a video
        // element. Every other tile keeps the small circle-avatar layout.
        const isLiveVideoTile = tile.isAgent && Boolean(tile.agentPresent);

        return (
          <div
            key={tile.key}
              className={
              isLiveVideoTile
                ? 'eco-panel relative flex flex-col overflow-hidden p-0'
                : 'eco-panel relative flex flex-col items-center justify-center gap-3 p-4 transition-shadow'
            }
            style={
              !isLiveVideoTile && !tile.isAgent && tile.speaking
                ? { boxShadow: `0 0 0 3px ${tile.color}` }
                : undefined
            }
          >
            {tile.handRaised && (
              <span
                className="eco-pulse absolute left-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'var(--eco-amber)',
                  background: 'var(--eco-amber-dim)',
                  color: 'var(--eco-amber)',
                }}
                aria-label={`${tile.name} raised their hand`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-2a1.5 1.5 0 0 1 3 0"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}

            {tile.isAgent ? (
              isLiveVideoTile ? (
                // Full-bleed: the 3D avatar fills the entire card. The name
                // label sits as an overlay pill at the bottom, matching the
                // old Anam video-call-style layout.
                <>
                  <div className="absolute inset-0 h-full w-full">
                    <AthenaTalkingHead
                      audioTrack={athenaAudioTrack}
                      speaking={tile.speaking}
                    />
                  </div>
                  <div
                    className="absolute bottom-3 left-3 z-10 rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm"
                    style={{
                      background: 'color-mix(in srgb, var(--eco-ink) 55%, transparent)',
                      color: 'var(--eco-cream)',
                    }}
                  >
                    Athena · AI teacher
                  </div>
                </>
              ) : (
                // Fallback: Athena not yet brought into the room.
                <span
                  className="relative flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold"
                  style={{ background: 'var(--eco-ink-sunken)', color: 'var(--eco-athena)' }}
                >
                  A
                </span>
              )
            ) : (
              <span
                className={`relative flex h-16 w-16 items-center justify-center rounded-full ${
                  tile.speaking ? 'eco-avatar-speaking' : ''
                }`}
                style={{ background: tile.color, color: tile.color }}
              >
                <span className="text-lg font-semibold" style={{ color: 'var(--eco-ink)' }}>
                  {initialsOf(tile.name)}
                </span>
              </span>
            )}

            {!isLiveVideoTile && (
              <div className="flex flex-col items-center gap-0.5 text-center">
                <span className="max-w-[8rem] truncate text-sm text-[var(--eco-cream)]">
                  {tile.name}
                  {tile.isSelf ? ' (you)' : ''}
                </span>
                <span className="text-xs text-[var(--eco-cream-faint)]">
                  {tile.isAgent
                    ? tile.agentPresent
                      ? 'AI teacher'
                      : 'Not started'
                    : tile.role}
                </span>
              </div>
            )}

            {tile.isSelf && (
              <span
                className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[0.65rem]"
                style={
                  selfMicEnabled
                    ? {
                        borderColor: 'var(--eco-glow)',
                        background: 'var(--eco-glow-dim)',
                        color: 'var(--eco-glow-bright)',
                      }
                    : {
                        borderColor: 'var(--eco-rule)',
                        color: 'var(--eco-cream-faint)',
                      }
                }
                aria-label={selfMicEnabled ? 'Your mic is on' : 'Your mic is off'}
                title={selfMicEnabled ? 'Mic on' : 'Mic off'}
              >
                {selfMicEnabled ? '●' : '○'}
              </span>
            )}

            {/* Bottom row on Athena's tile: presence toggle (bring in /
                send out) always shown when a handler is supplied, plus the
                mic mute toggle once she's actually present. Replaces the
                old separate "Bring Athena in" / "Send Athena out" / "Mute
                AI" / "Unmute AI" header buttons entirely. */}
            {tile.isAgent && (onToggleAgentPresence || (tile.agentPresent && onToggleAgentMute)) && (
              <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
                {onToggleAgentPresence && (
                  <button
                    type="button"
                    onClick={onToggleAgentPresence}
                    disabled={agentBusy}
                    className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    style={
                      tile.agentPresent
                        ? { borderColor: 'var(--eco-red)', background: 'var(--eco-red-dim)', color: 'var(--eco-red)' }
                        : { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
                    }
                    aria-label={tile.agentPresent ? 'Send Athena out' : 'Bring Athena in'}
                    title={tile.agentPresent ? 'Send Athena out' : 'Bring Athena in'}
                  >
                    <PowerIcon />
                  </button>
                )}

                {tile.agentPresent && onToggleAgentMute && (
                  <button
                    type="button"
                    onClick={onToggleAgentMute}
                    className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
                    style={
                      agentMuted
                        ? { borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)', color: 'var(--eco-cream-faint)' }
                        : { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
                    }
                    aria-label={agentMuted ? 'Unmute Athena' : 'Mute Athena'}
                    title={agentMuted ? 'Unmute Athena' : 'Mute Athena'}
                  >
                    {agentMuted ? <MicOffIcon /> : <MicOnIcon />}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}