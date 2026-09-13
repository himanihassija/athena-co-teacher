/**
 * Control-path fan-out — PS31 §2 (the non-audio channel).
 *
 * The plan assumed RTM would carry these events. It cannot: Agora's RTM is a
 * client-side-only SDK with no server variant, and the Agora skill's guidance
 * for backend-to-channel messaging is to use the ConvoAI REST API or build your
 * own signalling layer. This is that layer — Server-Sent Events from the
 * orchestrator to every browser in the room.
 *
 * RTM is still in the picture, just not here: the agent's own transcripts and
 * state changes reach the browser over RTM directly from Agora's engine, which
 * the web client already subscribes to.
 *
 * SSE rather than WebSockets because the control path is one-directional
 * (server -> client); commands travel back over ordinary HTTP POSTs, which keeps
 * teacher authorisation on the same well-understood request path.
 */

import type { ClassroomEvent } from '@echosphere/shared-types';

export interface Subscriber {
  subscriberId: string;
  participantId: string;
  role: 'teacher' | 'student';
  send(event: ClassroomEvent): void;
  close(): void;
}

const rooms = new Map<string, Set<Subscriber>>();

export function subscribe(sessionId: string, subscriber: Subscriber): () => void {
  let room = rooms.get(sessionId);
  if (!room) {
    room = new Set();
    rooms.set(sessionId, room);
  }
  room.add(subscriber);

  return () => {
    room?.delete(subscriber);
    if (room && room.size === 0) rooms.delete(sessionId);
  };
}

/** Broadcast to everyone in the room. */
export function publish(sessionId: string, event: ClassroomEvent): void {
  const room = rooms.get(sessionId);
  if (!room) return;
  for (const subscriber of room) {
    deliver(subscriber, event);
  }
}

/**
 * Teacher-only events. Gap alerts and answer keys must not reach student
 * browsers, so the role check happens at the fan-out point rather than being
 * left to each caller to remember.
 */
export function publishToTeachers(sessionId: string, event: ClassroomEvent): void {
  const room = rooms.get(sessionId);
  if (!room) return;
  for (const subscriber of room) {
    if (subscriber.role === 'teacher') deliver(subscriber, event);
  }
}

export function publishTo(
  sessionId: string,
  participantId: string,
  event: ClassroomEvent,
): void {
  const room = rooms.get(sessionId);
  if (!room) return;
  for (const subscriber of room) {
    if (subscriber.participantId === participantId) deliver(subscriber, event);
  }
}

function deliver(subscriber: Subscriber, event: ClassroomEvent): void {
  try {
    subscriber.send(event);
  } catch {
    // A dead connection must not stop the rest of the room from receiving the
    // event; the SSE route's own close handler removes it from the set.
  }
}

export function subscriberCount(sessionId: string): number {
  return rooms.get(sessionId)?.size ?? 0;
}

export function closeRoom(sessionId: string): void {
  const room = rooms.get(sessionId);
  if (!room) return;
  for (const subscriber of room) {
    try {
      subscriber.close();
    } catch {
      // Already closed.
    }
  }
  rooms.delete(sessionId);
}
