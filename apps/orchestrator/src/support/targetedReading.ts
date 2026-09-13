/**
 * Targeted Reading Recommendation Engine (Teacher-Approved).
 *
 * Discovers reading materials and remediation guides tailored to
 * student learning gaps, with a 1-click teacher approval workflow.
 */

import { randomUUID } from 'node:crypto';
import type { TargetedReadingItem, LearningGap } from '@echosphere/shared-types';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { publish } from '../state/eventBus.js';
import { tryComplete } from '../llm/complete.js';

export function getTargetedReadings(session: ClassroomSession): TargetedReadingItem[] {
  if (!session.targetedReadings) {
    session.targetedReadings = seedDefaultReadings(session.title);
  }
  return session.targetedReadings;
}

function seedDefaultReadings(title: string): TargetedReadingItem[] {
  return [
    {
      id: `reading-${randomUUID().slice(0, 8)}`,
      topic: 'Visualizing Common Denominators',
      title: 'The Pizza Slice Model: Why Denominators Must Match',
      summary: 'An intuitive visual guide to why adding 1/2 and 1/3 requires converting to sixths before summing.',
      contentMarkdown: `### The Pizza Slice Model

Imagine you have two pizzas of equal size:
- One is sliced into **2 equal halves**. You take 1 slice ($1/2$).
- The second is sliced into **3 equal thirds**. You take 1 slice ($1/3$).

If you put both slices on one plate, can you simply say you have 2 slices?
Yes, but they are **different sizes**! To express the total portion of a whole pizza, you must slice both pizzas into pieces of the **exact same size**.

Finding the **Least Common Multiple (LCM)** of 2 and 3 gives **6**:
- $1/2 = 3/6$
- $1/3 = 2/6$
- Total $= 3/6 + 2/6 = 5/6$

**Key Rule:** Never add denominators directly. Only add numerators once the units match!`,
      estimatedReadTime: '2 mins',
      relevanceReason: 'Addresses the most common misconception where students sum denominators (e.g. 1/2 + 1/3 = 2/5).',
      targetStudentIds: [],
      status: 'approved',
      approvedBy: 'Teacher',
      approvedAt: Date.now(),
    },
    {
      id: `reading-${randomUUID().slice(0, 8)}`,
      topic: 'Simplifying & Reducing Fractions',
      title: 'Greatest Common Divisor (GCD) in 3 Fast Steps',
      summary: 'Quick algorithmic reference to simplifying final fraction answers to simplest form.',
      contentMarkdown: `### 3 Steps to Simplest Form

When you arrive at an answer like $6/8$:
1. **Find common factors:** Both 6 and 8 are divisible by 2.
2. **Divide top and bottom:** $6 ÷ 2 = 3$, and $8 ÷ 2 = 4$.
3. **Verify:** 3 and 4 share no common factors other than 1. The simplest form is **$3/4$**.`,
      estimatedReadTime: '3 mins',
      relevanceReason: 'Helpful for students struggling with final step verification.',
      targetStudentIds: [],
      status: 'approved',
      approvedBy: 'Teacher',
      approvedAt: Date.now(),
    },
  ];
}

/**
 * Generates a targeted reading recommendation when a new learning gap is detected.
 */
export async function suggestReadingForGap(
  session: ClassroomSession,
  gap: LearningGap,
): Promise<TargetedReadingItem> {
  const readings = getTargetedReadings(session);

  let title = `Deep Dive: Mastering ${gap.topic}`;
  let summary = `Targeted review covering the core misconception: ${gap.description}`;
  let content = `### Understanding ${gap.topic}\n\n${gap.description}\n\n**Key Takeaway:** Take your time with the intermediate conversion steps.`;

  try {
    const prompt = `Write a short, engaging 200-word reading tutorial for middle school students on the topic "${gap.topic}".
Address this misconception specifically: "${gap.description}".
Return JSON format:
{
  "title": "...",
  "summary": "...",
  "contentMarkdown": "..."
}`;
    const raw = await tryComplete([{ role: 'user', content: prompt }], {
      temperature: 0.3,
      maxTokens: 450,
    });
    if (raw) {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (parsed.title) title = parsed.title;
      if (parsed.summary) summary = parsed.summary;
      if (parsed.contentMarkdown) content = parsed.contentMarkdown;
    }
  } catch {
    // Keep template
  }

  const item: TargetedReadingItem = {
    id: `reading-${randomUUID().slice(0, 8)}`,
    topic: gap.topic,
    title,
    summary,
    contentMarkdown: content,
    estimatedReadTime: '3 mins',
    relevanceReason: `Generated to remediate learning gap in ${gap.topic}`,
    targetStudentIds: gap.affectedStudentIds,
    status: 'pending-approval',
  };

  readings.unshift(item);
  publish(session.sessionId, {
    kind: 'echosphere:targeted-reading-updated',
    items: readings,
  });

  return item;
}

export function approveReading(
  session: ClassroomSession,
  readingId: string,
  teacherName: string,
): TargetedReadingItem | undefined {
  const readings = getTargetedReadings(session);
  const item = readings.find((r) => r.id === readingId);
  if (!item) return undefined;

  item.status = 'approved';
  item.approvedBy = teacherName;
  item.approvedAt = Date.now();

  publish(session.sessionId, {
    kind: 'echosphere:targeted-reading-updated',
    items: readings,
  });

  return item;
}

export function rejectReading(
  session: ClassroomSession,
  readingId: string,
): boolean {
  const readings = getTargetedReadings(session);
  const item = readings.find((r) => r.id === readingId);
  if (!item) return false;

  item.status = 'rejected';
  publish(session.sessionId, {
    kind: 'echosphere:targeted-reading-updated',
    items: readings,
  });

  return true;
}
