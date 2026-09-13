/**
 * Live Miro-style Shared Workspace & Sticky Notes.
 *
 * Provides synchronized sticky notes, held-back doubts, live cards,
 * and workspace canvas state across teachers and students.
 */

export type StickyNoteColor = 'yellow' | 'coral' | 'cyan' | 'purple' | 'green' | 'amber';
export type StickyNoteCategory = 'held-back-doubt' | 'student-question' | 'core-concept' | 'teacher-insight' | 'key-takeaway';
export type StickyNoteStatus = 'pending' | 'addressed' | 'resolved' | 'archived';

export interface MiroStickyNote {
  id: string;
  topic: string;
  content: string;
  suggestedAnswer?: string;
  category: StickyNoteCategory;
  color: StickyNoteColor;
  status: StickyNoteStatus;
  authorName: string;
  authorRole: 'athena' | 'teacher' | 'student';
  authorParticipantId?: string;
  timestamp: number;
  votes: number;
  votedBy: string[]; // participantIds
  isHeldBackDoubt: boolean;
  heldBackReason?: string;
  restraintScore?: number;
  tags?: string[];
  resolvedAt?: number;
}

export interface MiroWorkspaceState {
  enabled: boolean;
  boardTitle: string;
  notes: MiroStickyNote[];
  activeFilter?: StickyNoteCategory | 'all';
  columnOrder: StickyNoteStatus[];
  updatedAt: number;
}

export type MiroCommand =
  | { action: 'add-note'; note: Omit<MiroStickyNote, 'id' | 'timestamp' | 'votes' | 'votedBy' | 'status'> }
  | { action: 'update-note'; id: string; patch: Partial<MiroStickyNote> }
  | { action: 'vote-note'; id: string; participantId: string }
  | { action: 'resolve-note'; id: string; status: StickyNoteStatus }
  | { action: 'delete-note'; id: string }
  | { action: 'ask-athena-explain-note'; id: string };
