/**
 * Types for the Athena Digital Library — synced textbook with page-flip,
 * floor control, NCERT curriculum content, multi-book shelf, and Athena voice citations.
 */

export type SectionColor = 'gold' | 'teal' | 'coral' | 'violet';

export type BookKind = 'curriculum' | 'pdf' | 'pptx' | 'text';

export interface LibraryPage {
  pageNumber: number; // 1-indexed for display
  sectionId?: string;
  sectionTitle?: string;
  sectionColor?: SectionColor;
  heading?: string;
  body?: string[];
  work?: string;
  drill?: string[];
  imageSrc?: string; // Rasterized canvas data URL or extracted slide image
  isCover?: boolean;
  isEndCover?: boolean;
  crest?: string;
  title?: string;
  subtitle?: string;
  rawText: string;
}

export interface LibraryBook {
  id: string;
  title: string;
  subtitle: string;
  subject?: string;
  kind: BookKind;
  addedBy?: string; // 'Curriculum' | teacher participant name
  createdAt?: string;
  chapterNumber?: number;
  pages: LibraryPage[];
}

export interface StudentReadingPosition {
  participantId: string;
  displayName: string;
  page: number; // 0-indexed spread / page in flipbook
  bookId: string;
  updatedAt: number;
}

export interface LibraryPublicState {
  activeBookId: string;
  currentPage: number; // 0-indexed spread / page index
  isLocked: boolean;   // true = teacher controls paging; false = students can read ahead
  isPresenting: boolean; // true = textbook is active on the main stage
  presenterId: string | null;
  lastSequence: number;
  glowPage?: number | null;
  studentPositions?: Record<string, StudentReadingPosition>;
}

export interface LibraryOpenPayload {
  bookId: string;
  source: 'teacher' | 'agent' | 'student';
}

export interface LibraryPageTurnPayload {
  bookId: string;
  page: number; // 0-indexed page in flipbook
  seq: number;
  source: 'teacher' | 'agent' | 'student';
  glow?: boolean;
}

export interface LibraryLockPayload {
  locked: boolean;
}

export interface LibraryPresentPayload {
  presenting: boolean;
  presenterId: string | null;
}

export interface LibraryBookAddedPayload {
  bookId: string;
  book: LibraryBook;
  addedBy: string;
}

export interface LibraryBookRemovedPayload {
  bookId: string;
  removedBy: string;
}

export interface LibrarySearchResult {
  bookId: string;
  page: number;
  snippet: string;
  confidence: number;
  sectionTitle?: string;
}
