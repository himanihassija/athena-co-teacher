'use client';

import { useEffect, useMemo } from 'react';
import {
  useLocalScreenTrack,
  usePublish,
  useRemoteUsers,
  useRemoteVideoTracks,
  RemoteVideoTrack,
  LocalVideoTrack,
} from 'agora-rtc-react';

export interface ScreenShareStageProps {
  /** Whether THIS client is the one currently sharing. */
  isSharing: boolean;
  /** Fires when the browser's own "Stop sharing" UI ends the capture. */
  onSharingEnded: () => void;
  activeScreenShare: { participantId: string; displayName: string } | null;
  selfUid: string;
}

export function ScreenShareStage({
  isSharing,
  onSharingEnded,
  activeScreenShare,
  selfUid,
}: ScreenShareStageProps) {
  // `withAudio: 'auto'` means the hook hands back either a lone video track or
  // a [video, audio] pair depending on what the browser's picker granted, so it
  // has to be narrowed before use rather than treated as one track.
  const { screenTrack, error } = useLocalScreenTrack(isSharing, {}, 'auto');
  const screenVideoTrack = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;
  const screenAudioTrack = Array.isArray(screenTrack) ? screenTrack[1] : null;

  // Memoised deliberately. usePublish diffs the list it is given, so a fresh
  // array literal every render reads as a new set of tracks and it tries to
  // publish again — and a second video track on one client is refused with
  // CAN_NOT_PUBLISH_MULTIPLE_VIDEO_TRACKS. Both halves are published when the
  // sharer also granted system audio; dropping the audio one would quietly make
  // `withAudio: 'auto'` behave like 'disable'.
  const tracksToPublish = useMemo(
    () =>
      screenVideoTrack
        ? [screenVideoTrack, ...(screenAudioTrack ? [screenAudioTrack] : [])]
        : [],
    [screenVideoTrack, screenAudioTrack],
  );

  // `readyToPublish` gates on this client actually being the sharer. Everyone in
  // the room renders this component while a share is live — only one of them
  // should be publishing.
  usePublish(tracksToPublish, isSharing && tracksToPublish.length > 0);

  // The browser's native "Stop sharing" bar ends the capture without going
  // through our own button; without this listener the room would keep
  // believing the share is live until someone notices.
  useEffect(() => {
    if (!screenVideoTrack) return;
    const mediaTrack = screenVideoTrack.getMediaStreamTrack();
    mediaTrack.addEventListener('ended', onSharingEnded);
    return () => mediaTrack.removeEventListener('ended', onSharingEnded);
  }, [screenVideoTrack, onSharingEnded]);

  useEffect(() => {
    if (error) onSharingEnded();
  }, [error, onSharingEnded]);

  const remoteUsers = useRemoteUsers();
  const { videoTracks } = useRemoteVideoTracks(remoteUsers);

  if (!activeScreenShare) return null;

  const remoteSharerTrack = videoTracks.find(
    (track) => String(track.getUserId()) !== selfUid,
  );

  return (
    <div className="eco-panel relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 border-b px-4 py-2"
        style={{ borderColor: 'var(--eco-rule)' }}
      >
        <span className="eco-lamp eco-lamp-glow eco-pulse" style={{ width: 8, height: 8 }} />
        <span className="text-sm font-medium text-[var(--eco-cream)]">
          {activeScreenShare.displayName} is sharing their screen
        </span>
      </div>
      <div className="relative min-h-0 flex-1 bg-black">
        {isSharing && screenVideoTrack ? (
          <LocalVideoTrack track={screenVideoTrack} play className="h-full w-full object-contain" />
        ) : remoteSharerTrack ? (
          <RemoteVideoTrack
            track={remoteSharerTrack}
            play
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--eco-cream-faint)]">
            Connecting to the shared screen…
          </div>
        )}
      </div>
    </div>
  );
}