/**
 * Persistence schema — PS31 §4 (Postgres for session logs, profiles, quiz
 * results, transcripts).
 *
 * `sessionRegistry.ts`'s own header comment already states the design this
 * implements: the in-memory `ClassroomSession` stays the single source of
 * truth for the whole live session (the floor state machine needs one
 * long-lived writer), and is flushed here once, at session end — see
 * `report/persist.ts`. Nothing in the hot turn-taking path touches this
 * schema; it exists purely for after-the-fact durability and querying.
 *
 * `SessionReport` (the generated post-class report) is stored as a single
 * JSONB blob in `reports` rather than fully normalized — it's write-once,
 * read-whole, and its shape already has a canonical source of truth (the
 * `SessionReport` TS type in packages/shared-types). Everything upstream of
 * the report — participants, transcript, quizzes, gaps — is normalized,
 * since those are the tables a teacher-analytics query would actually join
 * across later.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Teachers who have signed in, mirrored from Supabase Auth.
 *
 * Supabase owns the credentials — they live in its own `auth.users` table, in a
 * schema Drizzle deliberately does not manage, and no password ever reaches
 * this database. This table exists so the orchestrator can join a session to a
 * human without querying across schemas, and so "list my lessons" stays a
 * single ordinary query.
 *
 * The primary key IS the Supabase user id (the `sub` claim on the JWT), so a
 * row is upserted on first authenticated request rather than created by a
 * signup flow of our own.
 */
export const teacherProfiles = pgTable('teacher_profiles', {
  /** Supabase auth user id — the JWT `sub` claim. */
  userId: text('user_id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
});

export const sessions = pgTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey(),
    channel: text('channel').notNull(),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /**
     * The signed-in teacher who created the lesson, or null.
     *
     * Nullable on purpose. Sessions created before auth existed have no owner,
     * and AUTH_REQUIRED=false still permits anonymous creation — so a NOT NULL
     * column here would reject exactly the traffic the deployed app serves
     * today. `onDelete: 'set null'` keeps a lesson and its report intact if the
     * teacher's account is later removed; the class happened either way.
     */
    ownerId: text('owner_id').references(() => teacherProfiles.userId, {
      onDelete: 'set null',
    }),
  },
  (table) => [index('sessions_owner_idx').on(table.ownerId)],
);

export const participants = pgTable(
  'participants',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    uid: text('uid').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['teacher', 'student'] }).notNull(),
    /** Null for teachers — only students carry a proficiency tag. */
    proficiency: text('proficiency'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [index('participants_session_idx').on(table.sessionId)],
);

export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    participantId: text('participant_id'),
    uid: text('uid').notNull(),
    speaker: text('speaker', { enum: ['teacher', 'student', 'agent'] }).notNull(),
    text: text('text').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    language: text('language'),
    turnId: integer('turn_id'),
    attributionConfidence: real('attribution_confidence'),
  },
  (table) => [index('transcript_session_idx').on(table.sessionId)],
);

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    quizId: text('quiz_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    question: text('question').notNull(),
    options: jsonb('options').$type<string[] | null>(),
    correctAnswer: text('correct_answer').notNull(),
    difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }).notNull(),
    targetStudentIds: jsonb('target_student_ids').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    origin: text('origin', { enum: ['teacher', 'gap-detector'] }).notNull(),
  },
  (table) => [index('quiz_questions_session_idx').on(table.sessionId)],
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizQuestions.quizId, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    answer: text('answer').notNull(),
    correct: boolean('correct').notNull(),
    via: text('via', { enum: ['ui', 'voice'] }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (table) => [index('quiz_answers_session_idx').on(table.sessionId)],
);

export const learningGaps = pgTable(
  'learning_gaps',
  {
    gapId: text('gap_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    description: text('description').notNull(),
    affectedStudentIds: jsonb('affected_student_ids').$type<string[]>().notNull(),
    evidence: jsonb('evidence').$type<
      Array<{ kind: string; participantId: string; text: string; at: number }>
    >().notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    addressedAt: timestamp('addressed_at', { withTimezone: true }),
  },
  (table) => [index('learning_gaps_session_idx').on(table.sessionId)],
);

export const reports = pgTable('reports', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.sessionId, { onDelete: 'cascade' }),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
  narrative: text('narrative').notNull(),
  /** The full generated SessionReport (packages/shared-types) — see file header. */
  report: jsonb('report').notNull(),
});

export const teacherProfilesRelations = relations(teacherProfiles, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ many, one }) => ({
  owner: one(teacherProfiles, {
    fields: [sessions.ownerId],
    references: [teacherProfiles.userId],
  }),
  participants: many(participants),
  transcriptSegments: many(transcriptSegments),
  quizQuestions: many(quizQuestions),
  quizAnswers: many(quizAnswers),
  learningGaps: many(learningGaps),
  report: one(reports, { fields: [sessions.sessionId], references: [reports.sessionId] }),
}));
