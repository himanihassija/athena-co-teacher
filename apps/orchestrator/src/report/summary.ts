/**
 * Post-class summary — PS31 §3.9.
 *
 * The plan called for a single batch LLM call over the session log. The
 * ConvoAI agent is a live voice pipeline rather than something you can hand a
 * transcript to after it has left the channel, so the numbers here —
 * misconceptions, per-student stats, concept mastery, follow-up suggestions —
 * are always derived deterministically from what the gap detector and quiz
 * engine logged as it happened. A model would only be paraphrasing them, and
 * unlike a generated narrative, these cannot be wrong.
 *
 * The narrative paragraph is the one place a model earns its keep — turning
 * those numbers into prose reads better than a template. `generateNarrative`
 * tries a real LLM call (see llm/complete.ts) and falls back to the
 * template unchanged when no provider key is configured, so this still works
 * with zero setup beyond the Agora credentials, same as the rest of the app.
 */

import type {
  LearningGap,
  ReportedMisconception,
  SessionReport,
  StudentReportEntry,
  ConceptMastery,
  StudentProfile,
} from '@echosphere/shared-types';
import { rankedGaps } from '../gaps/gapDetector.js';
import {
  students,
  teacherOf,
  type ClassroomSession,
} from '../state/sessionRegistry.js';
import { tryComplete } from '../llm/complete.js';

export async function generateReport(session: ClassroomSession): Promise<SessionReport> {
  // The report is about the students. Exclude the teacher — and a second
  // participant a teacher may have opened under the same name to watch the
  // student view, which would otherwise appear as a silent student row.
  const teacherName = teacherOf(session)?.displayName.trim().toLowerCase();
  const roster = students(session).filter(
    (s) => s.displayName.trim().toLowerCase() !== teacherName,
  );
  const gaps = rankedGaps(session);
  const topics = topicsCovered(session, gaps);

  const misconceptions: ReportedMisconception[] = gaps.map((gap) => ({
    topic: gap.topic,
    description: gap.description,
    studentNames: gap.affectedStudentIds.map(
      (id) => session.participants.get(id)?.displayName ?? id,
    ),
  }));

  const perStudent: StudentReportEntry[] = roster.map((student) => ({
    participantId: student.participantId,
    displayName: student.displayName,
    proficiency: student.proficiency,
    questionsAsked: student.stats.questionsAsked,
    quizzesAnswered: student.stats.quizzesAnswered,
    quizzesCorrect: student.stats.quizzesCorrect,
    strugglingTopics: [...new Set(student.stats.missedTopics)],
    note: noteFor(student.stats, session),
    conceptMastery: calculateConceptMastery(student, session, topics),
  }));

  return {
    sessionId: session.sessionId,
    generatedAt: Date.now(),
    startedAt: session.createdAt,
    endedAt: session.endedAt ?? Date.now(),
    topicsCovered: topics,
    commonMisconceptions: misconceptions,
    perStudent,
    suggestedFollowUp: followUp(gaps, perStudent),
    narrative: await generateNarrative(session, gaps, perStudent),
    interventionHistory: session.interventionHistory || [],
  };
}

function calculateConceptMastery(
  student: StudentProfile,
  session: ClassroomSession,
  topics: string[],
): ConceptMastery[] {
  return topics.flatMap((topic) => {
    // Find quizzes on this topic
    const topicQuizzes = [...session.quizzes.values()].filter(
      (q) => q.topic.toLowerCase() === topic.toLowerCase()
    );
    const quizIds = topicQuizzes.map((q) => q.quizId);

    // Find answers by this student to those quizzes
    const studentAnswers = session.answers.filter(
      (a) => a.participantId === student.participantId && quizIds.includes(a.quizId)
    );

    const totalAnswered = studentAnswers.length;
    const correctCount = studentAnswers.filter((a) => a.correct).length;

    // Check if student has gap evidence on this topic
    const hasGap = [...session.gaps.values()].some(
      (g) =>
        g.topic.toLowerCase() === topic.toLowerCase() &&
        g.affectedStudentIds.includes(student.participantId)
    );

    // No quiz answers and no gap evidence: there is nothing to score this
    // student on for this topic, so omit it rather than reporting a
    // fabricated "developing" percentage.
    if (totalAnswered === 0 && !hasGap) return [];

    let score = 70; // Default developing
    let status: 'mastered' | 'developing' | 'struggling' = 'developing';

    if (totalAnswered > 0) {
      const pct = correctCount / totalAnswered;
      if (pct >= 0.8) {
        score = 90;
        status = 'mastered';
      } else if (pct < 0.5) {
        score = 30;
        status = 'struggling';
      } else {
        score = 60;
        status = 'developing';
      }
    }

    if (hasGap) {
      score = Math.min(score, 30);
      status = 'struggling';
    } else if (totalAnswered > 0 && correctCount === totalAnswered && score >= 70) {
      score = 100;
      status = 'mastered';
    }

    return [{
      topic,
      score,
      status,
    }];
  });
}

/**
 * Topics the lesson actually touched: what the material was tagged with, plus
 * anything the agent or the detector named that was not in the material.
 */
function topicsCovered(
  session: ClassroomSession,
  gaps: LearningGap[],
): string[] {
  const fromLesson = session.lesson.topics();
  const fromQuizzes = [...session.quizzes.values()].map((q) => q.topic);
  const fromGaps = gaps.map((g) => g.topic);
  return [...new Set([...fromLesson, ...fromQuizzes, ...fromGaps])];
}

function noteFor(
  stats: { quizzesAnswered: number; quizzesCorrect: number; missedTopics: string[]; questionsAsked: number },
  session: ClassroomSession,
): string {
  const missed = [...new Set(stats.missedTopics)];
  const parts: string[] = [];

  if (stats.quizzesAnswered === 0) {
    parts.push('Answered no quizzes.');
  } else {
    const pct = Math.round((stats.quizzesCorrect / stats.quizzesAnswered) * 100);
    parts.push(`${stats.quizzesCorrect} of ${stats.quizzesAnswered} correct (${pct}%).`);
  }

  if (missed.length > 0) parts.push(`Struggled with ${missed.join(', ')}.`);

  if (stats.questionsAsked === 0 && session.transcript.length > 0) {
    // Worth flagging: a silent student is easy to miss in an audio-only room.
    parts.push('Did not ask Athena anything all lesson.');
  }

  return parts.join(' ');
}

function followUp(
  gaps: LearningGap[],
  perStudent: StudentReportEntry[],
): string[] {
  const out = gaps
    .slice(0, 4)
    .map(
      (gap) =>
        `Revisit "${gap.topic}" — ${gap.affectedStudentIds.length} student${
          gap.affectedStudentIds.length === 1 ? '' : 's'
        } showed confusion, most recently at ${new Date(gap.lastSeenAt).toLocaleTimeString()}.`,
    );

  const silent = perStudent.filter(
    (s) => s.questionsAsked === 0 && s.quizzesAnswered === 0,
  );
  if (silent.length > 0) {
    out.push(
      `Check in with ${silent.map((s) => s.displayName).join(', ')} — no questions and no quiz answers recorded.`,
    );
  }

  const struggling = perStudent.filter(
    (s) => s.quizzesAnswered >= 2 && s.quizzesCorrect / s.quizzesAnswered < 0.5,
  );
  if (struggling.length > 0) {
    out.push(
      `Consider re-tagging ${struggling
        .map((s) => s.displayName)
        .join(', ')} as beginner for the next lesson.`,
    );
  }

  return out;
}

/**
 * Tries a real LLM paraphrase of the same structured stats `templateNarrative`
 * already turns into prose; falls back to that template verbatim if no
 * provider key is configured or the call fails. Never throws.
 */
async function generateNarrative(
  session: ClassroomSession,
  gaps: LearningGap[],
  perStudent: StudentReportEntry[],
): Promise<string> {
  const fallback = templateNarrative(session, gaps, perStudent);

  const generated = await tryComplete([
    {
      role: 'system',
      content:
        'You write short, factual post-class summaries for a teacher. Two to four ' +
        'sentences, plain prose, no bullet points or headings. State only what the ' +
        'data supports — do not invent details beyond what is given.',
    },
    {
      role: 'user',
      content: [
        `Lesson: "${session.title}"`,
        `Students: ${perStudent.length}`,
        `Quiz results: ${perStudent.reduce((s, p) => s + p.quizzesCorrect, 0)} correct of ${perStudent.reduce((s, p) => s + p.quizzesAnswered, 0)} answered`,
        `Learning gaps detected: ${gaps.map((g) => `"${g.topic}" (${g.affectedStudentIds.length} students)`).join('; ') || 'none'}`,
        `Struggling students: ${perStudent.filter((p) => p.strugglingTopics.length > 0).map((p) => p.displayName).join(', ') || 'none noted'}`,
        '',
        'Write the summary paragraph.',
      ].join('\n'),
    },
  ]);

  return generated ?? fallback;
}

function templateNarrative(
  session: ClassroomSession,
  gaps: LearningGap[],
  perStudent: StudentReportEntry[],
): string {
  const minutes = Math.max(
    1,
    Math.round(((session.endedAt ?? Date.now()) - session.createdAt) / 60_000),
  );
  const totalAnswers = perStudent.reduce((sum, s) => sum + s.quizzesAnswered, 0);
  const totalCorrect = perStudent.reduce((sum, s) => sum + s.quizzesCorrect, 0);
  const agentTurns = session.transcript.filter((s) => s.speaker === 'agent').length;

  const sentences: string[] = [
    `"${session.title}" ran ${minutes} minute${minutes === 1 ? '' : 's'} with ${perStudent.length} student${perStudent.length === 1 ? '' : 's'}, ${session.transcript.length} recorded utterances, and ${agentTurns} contribution${agentTurns === 1 ? '' : 's'} from Athena.`,
  ];

  if (totalAnswers > 0) {
    const pct = Math.round((totalCorrect / totalAnswers) * 100);
    sentences.push(
      `The class answered ${totalAnswers} quiz question${totalAnswers === 1 ? '' : 's'} at ${pct}% accuracy.`,
    );
  } else {
    sentences.push('No quiz questions were answered.');
  }

  if (gaps.length === 0) {
    sentences.push('No repeated misconceptions were detected.');
  } else {
    const worst = gaps[0] as LearningGap;
    const shared = gaps.filter((g) => g.affectedStudentIds.length >= 2);
    sentences.push(
      `${gaps.length} learning gap${gaps.length === 1 ? '' : 's'} surfaced, ${shared.length} of them shared by more than one student. The most widespread was "${worst.topic}", affecting ${worst.affectedStudentIds.length}.`,
    );
  }

  return sentences.join(' ');
}
