/**
 * 3D model presentation state.
 *
 * Deliberately as thin as boardSession.ts's screen-share/whiteboard presence
 * tracking — a 3D model is just "who's showing what, right now," broadcast
 * to the room the same way. There's no collaborative canvas here (unlike the
 * whiteboard), so there's no scene/merge logic to carry: the file is just an
 * id the client resolves against its own local model registry
 * (apps/web/lib/models3d.ts) to know which .glb to load.
 */

import { publish } from '../state/eventBus.js';
import type { ClassroomSession } from '../state/sessionRegistry.js';

export function presentModel(
  session: ClassroomSession,
  participantId: string,
  displayName: string,
  modelId: string,
): void {
  session.activeModel = { participantId, displayName, modelId };
  publish(session.sessionId, {
    kind: 'echosphere:model-started',
    presenter: session.activeModel,
  });
}

export function stopModel(session: ClassroomSession, participantId: string): void {
  session.activeModel = null;
  publish(session.sessionId, {
    kind: 'echosphere:model-stopped',
    participantId,
  });
}