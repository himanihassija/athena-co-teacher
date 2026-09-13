/**
 * "Nobody Left Behind" suite:
 * - The Absent-Student Packet
 * - Multilingual Agent Config
 * - 1:1 Tutor for Flagged Students
 * - Targeted Reading (Teacher-Approved)
 * - Catch-up Sessions from Real Availability
 */

import type { LearningGap, QuizQuestion } from './lesson.js';
import type { MiroStickyNote } from './workspace.js';

export type LanguageCode = 'en' | 'hi' | 'es' | 'fr' | 'de' | 'ta' | 'te';

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  nativeName: string;
}

export interface AbsentStudentPacket {
  sessionId: string;
  lessonTitle: string;
  generatedAt: number;
  durationMinutes: number;
  executiveSummary: string;
  keyTakeaways: string[];
  timelineHighlights: Array<{
    timestamp: number;
    speaker: string;
    text: string;
    significance: string;
  }>;
  stickyNotesSnapshot: MiroStickyNote[];
  flaggedConcepts: Array<{
    concept: string;
    explanation: string;
    commonMisconception: string;
  }>;
  diagnosticQuiz: Array<Omit<QuizQuestion, 'targetStudentIds'>>;
  targetedReadings: TargetedReadingItem[];
}

export interface TargetedReadingItem {
  id: string;
  topic: string;
  title: string;
  summary: string;
  contentMarkdown: string;
  estimatedReadTime: string; // e.g. "3 mins"
  relevanceReason: string;
  targetStudentIds: string[]; // empty means all / absent
  status: 'pending-approval' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: number;
  suggestedUrl?: string;
}

export interface OneOnOneTutorSession {
  studentId: string;
  studentName: string;
  sessionId: string;
  targetGaps: LearningGap[];
  status: 'idle' | 'active' | 'completed';
  conversation: Array<{
    role: 'student' | 'athena';
    text: string;
    timestamp: number;
    audioUrl?: string;
  }>;
  masteredConcepts: string[];
  remainingDoubts: string[];
}

export interface CatchupAvailabilitySlot {
  slotId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  teacherName: string;
  bookedByStudentId?: string;
  bookedByStudentName?: string;
  topic?: string;
  isBooked: boolean;
}

export interface CatchupBookingRequest {
  slotId: string;
  studentId: string;
  studentName: string;
  topic: string;
  notes?: string;
  language: LanguageCode;
}

export type DispatchChannel = 'email' | 'whatsapp' | 'both';

export interface AbsentDispatchPayload {
  sessionId: string;
  studentName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  channel: DispatchChannel;
  includeQuiz: boolean;
  includeTranscript: boolean;
  parentNote?: string;
}

export interface AbsentDispatchResult {
  ok: boolean;
  sessionId: string;
  dispatchedAt: number;
  channels: DispatchChannel[];
  recipientEmail?: string;
  recipientPhone?: string;
  whatsappDeepLink: string;
  whatsappMessageText: string;
  emailSubject: string;
  emailBodyHtml: string;
  deliveryReceiptId: string;
  /**
   * Real outcome of the email send, present only when the email channel was
   * requested. `ok` above reports that the packet was composed; these report
   * whether it actually left the building.
   */
  emailSent?: boolean;
  emailProvider?: 'resend' | 'smtp';
  emailError?: string;
}

export type TeachingAssistantMode = 'step_by_step' | 'socratic_hint' | 'concept_simplify' | 'practice_problem';

export interface TeachingAssistantRequest {
  sessionId: string;
  studentId: string;
  studentName: string;
  question: string;
  mode?: TeachingAssistantMode;
  struggleTopic?: string;
  hintLevel?: number; // 1 = light hint, 2 = guiding question, 3 = detailed breakdown
}

export interface TeachingAssistantResponse {
  reply: string;
  mode: TeachingAssistantMode;
  analogyOrExample?: string;
  stepByStepSteps?: string[];
  suggestedFollowUpQuestion?: string;
  interactivePractice?: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  };
  sources: Array<{ kind: string; snippet: string }>;
}

