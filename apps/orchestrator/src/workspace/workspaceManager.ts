/**
 * Miro-style Shared Workspace & Sticky Notes Manager.
 *
 * Automatically converts held-back agent doubts and student questions
 * into synchronized interactive sticky notes on the shared workspace.
 */

import { randomUUID } from 'node:crypto';
import type {
  MiroStickyNote,
  MiroWorkspaceState,
  MiroCommand,
  StickyNoteColor,
  StickyNoteCategory,
  StickyNoteStatus,
} from '@echosphere/shared-types';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { publish } from '../state/eventBus.js';

const DEFAULT_COLUMN_ORDER: StickyNoteStatus[] = ['pending', 'addressed', 'resolved', 'archived'];

export function initialWorkspaceState(title: string): MiroWorkspaceState {
  return {
    enabled: true,
    boardTitle: `${title} — Shared Workspace`,
    notes: [],
    columnOrder: DEFAULT_COLUMN_ORDER,
    updatedAt: Date.now(),
  };
}

export function getWorkspaceState(session: ClassroomSession): MiroWorkspaceState {
  if (!session.workspace) {
    session.workspace = initialWorkspaceState(session.title);
  }
  return session.workspace;
}

const COLOR_MAP: Record<StickyNoteCategory, StickyNoteColor> = {
  'held-back-doubt': 'amber',
  'student-question': 'cyan',
  'core-concept': 'purple',
  'teacher-insight': 'green',
  'key-takeaway': 'yellow',
};

/**
 * Creates a sticky note on the workspace when the AI co-teacher holds back a doubt
 * or when a participant adds a note.
 */
export function addStickyNote(
  session: ClassroomSession,
  params: {
    topic: string;
    content: string;
    suggestedAnswer?: string;
    category?: StickyNoteCategory;
    color?: StickyNoteColor;
    authorName?: string;
    authorRole?: 'athena' | 'teacher' | 'student';
    authorParticipantId?: string;
    isHeldBackDoubt?: boolean;
    heldBackReason?: string;
    restraintScore?: number;
    tags?: string[];
  },
): MiroStickyNote {
  const ws = getWorkspaceState(session);
  const category = params.category ?? (params.isHeldBackDoubt ? 'held-back-doubt' : 'student-question');
  const color = params.color ?? COLOR_MAP[category] ?? 'yellow';

  const note: MiroStickyNote = {
    id: `sticky-${randomUUID().slice(0, 8)}`,
    topic: params.topic || 'Classroom Query',
    content: params.content,
    suggestedAnswer: params.suggestedAnswer,
    category,
    color,
    status: 'pending',
    authorName: params.authorName ?? (params.isHeldBackDoubt ? 'Athena (Held-Back Doubt)' : 'Student'),
    authorRole: params.authorRole ?? (params.isHeldBackDoubt ? 'athena' : 'student'),
    authorParticipantId: params.authorParticipantId,
    timestamp: Date.now(),
    votes: 0,
    votedBy: [],
    isHeldBackDoubt: Boolean(params.isHeldBackDoubt),
    heldBackReason: params.heldBackReason,
    restraintScore: params.restraintScore,
    tags: params.tags ?? [params.topic].filter(Boolean),
  };

  ws.notes.unshift(note);
  ws.updatedAt = Date.now();

  publish(session.sessionId, {
    kind: 'echosphere:sticky-note-added',
    note,
  });

  publish(session.sessionId, {
    kind: 'echosphere:workspace-changed',
    workspace: ws,
  });

  return note;
}

/**
 * Automatically invoked when Athena restrains an intervention or holds back a doubt.
 */
export function recordHeldBackDoubt(
  session: ClassroomSession,
  text: string,
  reason: string,
  score: number,
  topic = 'Held-Back Doubt',
  suggestedAnswer?: string,
): MiroStickyNote {
  return addStickyNote(session, {
    topic,
    content: text,
    suggestedAnswer,
    category: 'held-back-doubt',
    isHeldBackDoubt: true,
    heldBackReason: reason,
    restraintScore: score,
    authorName: 'Athena (Held-Back Doubt)',
    authorRole: 'athena',
  });
}

export function updateStickyNote(
  session: ClassroomSession,
  id: string,
  patch: Partial<MiroStickyNote>,
): MiroStickyNote | undefined {
  const ws = getWorkspaceState(session);
  const note = ws.notes.find((n) => n.id === id);
  if (!note) return undefined;

  Object.assign(note, patch);
  ws.updatedAt = Date.now();

  publish(session.sessionId, {
    kind: 'echosphere:sticky-note-updated',
    note,
  });

  publish(session.sessionId, {
    kind: 'echosphere:workspace-changed',
    workspace: ws,
  });

  return note;
}

export function voteStickyNote(
  session: ClassroomSession,
  id: string,
  participantId: string,
): MiroStickyNote | undefined {
  const ws = getWorkspaceState(session);
  const note = ws.notes.find((n) => n.id === id);
  if (!note) return undefined;

  if (note.votedBy.includes(participantId)) {
    // Unvote
    note.votedBy = note.votedBy.filter((p) => p !== participantId);
    note.votes = Math.max(0, note.votes - 1);
  } else {
    // Upvote
    note.votedBy.push(participantId);
    note.votes += 1;
  }

  ws.updatedAt = Date.now();

  publish(session.sessionId, {
    kind: 'echosphere:sticky-note-updated',
    note,
  });

  return note;
}

export function resolveStickyNote(
  session: ClassroomSession,
  id: string,
  status: StickyNoteStatus,
): MiroStickyNote | undefined {
  const ws = getWorkspaceState(session);
  const note = ws.notes.find((n) => n.id === id);
  if (!note) return undefined;

  note.status = status;
  if (status === 'resolved' || status === 'addressed') {
    note.resolvedAt = Date.now();
  }
  ws.updatedAt = Date.now();

  publish(session.sessionId, {
    kind: 'echosphere:sticky-note-updated',
    note,
  });

  publish(session.sessionId, {
    kind: 'echosphere:workspace-changed',
    workspace: ws,
  });

  return note;
}

export function deleteStickyNote(
  session: ClassroomSession,
  id: string,
): boolean {
  const ws = getWorkspaceState(session);
  const prevLen = ws.notes.length;
  ws.notes = ws.notes.filter((n) => n.id !== id);
  if (ws.notes.length !== prevLen) {
    ws.updatedAt = Date.now();
    publish(session.sessionId, {
      kind: 'echosphere:workspace-changed',
      workspace: ws,
    });
    return true;
  }
  return false;
}
