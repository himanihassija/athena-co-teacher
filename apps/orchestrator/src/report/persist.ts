/**
 * Flushes a finished session to Postgres — PS31 §4.
 *
 * `sessionRegistry.ts` is explicit that the in-memory `ClassroomSession` is
 * the source of truth for the live session, and only needs to reach a
 * database once it's over. This is that one write. It is a no-op — not an
 * error — when `DATABASE_URL` isn't configured (see `db/client.ts`), so a
 * session still ends cleanly with zero database setup, same as every other
 * optional integration in this project.
 *
 * Idempotent by design (every row keys off an id already stable in memory —
 * `sessionId`, `quizId`, `gapId`, transcript `segmentId` — with
 * `onConflictDoNothing`/`onConflictDoUpdate`), because both places a session
 * can end (`END_SESSION` and `DELETE /api/sessions/:id`) call this, and nothing
 * stops a teacher from also fetching `GET /report` in between, which
 * generates — and this persists — another `SessionReport` for the same
 * session. That means up to two LLM narrative calls for one session in the
 * common "end lesson & generate report" UI flow; deliberately not
 * de-duplicated across the two call sites, since a post-class summary is
 * infrequent enough that the simplicity is worth more than the saved call.
 */

import { getDb } from '../db/client.js';
import {
  learningGaps,
  participants,
  quizAnswers,
  quizQuestions,
  reports,
  sessions,
  teacherProfiles,
  transcriptSegments,
} from './../db/schema.js';
import { generateReport } from './summary.js';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import type { StudentProfile } from '@echosphere/shared-types';

let warnedNoDatabase = false;

export async function persistSessionEnd(session: ClassroomSession): Promise<void> {
  const db = getDb();
  if (!db) {
    if (!warnedNoDatabase) {
      warnedNoDatabase = true;
      console.warn('[persist] DATABASE_URL not set — session results will not be saved.');
    }
    return;
  }

  const report = await generateReport(session);

  await db.transaction(async (tx) => {
    // The owner row has to exist before the session references it. Upserted
    // here rather than at sign-in because the orchestrator has no sign-in
    // event — Supabase handles that — so the first time this service learns a
    // teacher exists is when they act, and a lesson ending is the only moment
    // that reaches the database at all.
    if (session.owner) {
      const seenAt = new Date();
      await tx
        .insert(teacherProfiles)
        .values({
          userId: session.owner.userId,
          email: session.owner.email,
          displayName: session.owner.displayName,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        })
        .onConflictDoUpdate({
          target: teacherProfiles.userId,
          // firstSeenAt is deliberately not in the update set — it records the
          // first sighting and must survive every later one.
          set: {
            email: session.owner.email,
            displayName: session.owner.displayName,
            lastSeenAt: seenAt,
          },
        });
    }

    await tx
      .insert(sessions)
      .values({
        sessionId: session.sessionId,
        channel: session.channel,
        title: session.title,
        createdAt: new Date(session.createdAt),
        endedAt: session.endedAt ? new Date(session.endedAt) : new Date(),
        ownerId: session.owner?.userId ?? null,
      })
      .onConflictDoUpdate({
        target: sessions.sessionId,
        set: {
          endedAt: session.endedAt ? new Date(session.endedAt) : new Date(),
          ownerId: session.owner?.userId ?? null,
        },
      });

    const allParticipants = [...session.participants.values()];
    if (allParticipants.length > 0) {
      await tx
        .insert(participants)
        .values(
          allParticipants.map((p) => ({
            id: `${session.sessionId}:${p.participantId}`,
            sessionId: session.sessionId,
            participantId: p.participantId,
            uid: p.uid,
            displayName: p.displayName,
            role: p.role,
            proficiency: p.role === 'student' ? (p as StudentProfile).proficiency : null,
            joinedAt: new Date(p.joinedAt),
            leftAt: p.leftAt ? new Date(p.leftAt) : null,
          })),
        )
        .onConflictDoNothing();
    }

    if (session.transcript.length > 0) {
      await tx
        .insert(transcriptSegments)
        .values(
          session.transcript.map((s) => ({
            id: `${session.sessionId}:${s.segmentId}`,
            sessionId: session.sessionId,
            participantId: s.participantId,
            uid: s.uid,
            speaker: s.speaker,
            text: s.text,
            at: new Date(s.at),
            language: s.language ?? null,
            turnId: s.turnId ?? null,
            attributionConfidence: s.attributionConfidence ?? null,
          })),
        )
        .onConflictDoNothing();
    }

    const quizzes = [...session.quizzes.values()];
    if (quizzes.length > 0) {
      await tx
        .insert(quizQuestions)
        .values(
          quizzes.map((q) => ({
            quizId: q.quizId,
            sessionId: session.sessionId,
            topic: q.topic,
            question: q.question,
            options: q.options ?? null,
            correctAnswer: q.correctAnswer,
            difficulty: q.difficulty,
            targetStudentIds: q.targetStudentIds,
            createdAt: new Date(q.createdAt),
            origin: q.origin,
          })),
        )
        .onConflictDoNothing();
    }

    if (session.answers.length > 0) {
      await tx
        .insert(quizAnswers)
        .values(
          session.answers.map((a) => ({
            id: `${session.sessionId}:${a.quizId}:${a.participantId}:${a.at}`,
            sessionId: session.sessionId,
            quizId: a.quizId,
            participantId: a.participantId,
            answer: a.answer,
            correct: a.correct,
            via: a.via,
            at: new Date(a.at),
          })),
        )
        .onConflictDoNothing();
    }

    const gaps = [...session.gaps.values()];
    if (gaps.length > 0) {
      await tx
        .insert(learningGaps)
        .values(
          gaps.map((g) => ({
            gapId: g.gapId,
            sessionId: session.sessionId,
            topic: g.topic,
            description: g.description,
            affectedStudentIds: g.affectedStudentIds,
            evidence: g.evidence,
            firstSeenAt: new Date(g.firstSeenAt),
            lastSeenAt: new Date(g.lastSeenAt),
            addressedAt: g.addressedAt ? new Date(g.addressedAt) : null,
          })),
        )
        .onConflictDoNothing();
    }

    await tx
      .insert(reports)
      .values({
        sessionId: session.sessionId,
        generatedAt: new Date(report.generatedAt),
        narrative: report.narrative,
        report,
      })
      .onConflictDoUpdate({
        target: reports.sessionId,
        set: { generatedAt: new Date(report.generatedAt), narrative: report.narrative, report },
      });
  });
}
