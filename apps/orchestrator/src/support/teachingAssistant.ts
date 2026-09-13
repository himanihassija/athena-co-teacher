/**
 * Socratic AI Teaching Assistant for Weaker / Struggling Students.
 *
 * Provides targeted, scaffolded support:
 * 1. Step-by-Step Problem Solving & Conceptual Breakdown
 * 2. Progressive Socratic Hints (does not spoil answers)
 * 3. Intuitive Real-World Analogies (e.g. Pizza slices, balance scales)
 * 4. Micro-Practice Diagnostic Exercises with immediate validation
 */

import type {
  TeachingAssistantRequest,
  TeachingAssistantResponse,
  TeachingAssistantMode,
} from '@echosphere/shared-types';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { rollingTranscript } from '../state/sessionRegistry.js';
import { rankedGaps } from '../gaps/gapDetector.js';
import { tryComplete } from '../llm/complete.js';

export async function handleTeachingAssistantRequest(
  session: ClassroomSession,
  req: TeachingAssistantRequest,
): Promise<TeachingAssistantResponse> {
  const mode: TeachingAssistantMode = req.mode ?? 'step_by_step';
  const query = req.question.trim();
  const hintLevel = req.hintLevel ?? 1;

  // Gather grounding sources
  const sources: Array<{ kind: string; snippet: string }> = [];
  const lessonHits = session.lesson.retrieveSync(query || req.struggleTopic || 'fractions', 2);
  for (const hit of lessonHits) {
    sources.push({ kind: 'lesson', snippet: hit.chunk.text.slice(0, 200) });
  }

  const recentTranscript = rollingTranscript(session, 15);
  for (const seg of recentTranscript.slice(-3)) {
    const speaker = seg.speaker === 'agent' ? 'Athena' : seg.speaker === 'teacher' ? 'Teacher' : 'Student';
    sources.push({ kind: 'transcript', snippet: `${speaker}: ${seg.text.slice(0, 160)}` });
  }

  const gaps = rankedGaps(session);
  const relevantGap = gaps.find((g) =>
    query.toLowerCase().includes(g.topic.toLowerCase()) || (req.struggleTopic && g.topic.toLowerCase().includes(req.struggleTopic.toLowerCase()))
  );

  const contextBlock = sources.map((s) => `[${s.kind}] ${s.snippet}`).join('\n');

  const systemPrompt = `You are Athena's Dedicated AI Teaching Assistant for a student named ${req.studentName} who needs extra support in "${session.title}".
You are patient, warm, encouraging, and pedagogically sound.

Requested Mode: ${mode}
Hint Level (if hint mode): ${hintLevel} (1=gentle reminder, 2=guiding thought, 3=step-by-step breakdown)
Detected learning difficulty: ${relevantGap ? `${relevantGap.topic}: ${relevantGap.description}` : req.struggleTopic || 'General math fundamentals'}

Pedagogical Rules:
- Never just give away final arithmetic answers outright. Lead the student to think.
- Use simple words, short sentences, and concrete everyday analogies (pizza slices, chocolate bars, sharing coins).
- Break problems down into clear numbered steps (Step 1, Step 2, Step 3).
- End with a friendly check-in question.

Lesson context:
${contextBlock || 'Foundational mathematics: Adding & subtracting unlike fractions via Lowest Common Denominator (LCD).'}`;

  const userPrompt = `Student question: "${query || req.struggleTopic || 'Can you help me understand this concept step-by-step?'}"
Mode: ${mode}

Please format your response strictly as JSON with this structure:
{
  "reply": "Your warm, encouraging explanation or hint for the student",
  "analogyOrExample": "A clear, visual real-world analogy (e.g. pizza or chocolate bar)",
  "stepByStepSteps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
  "suggestedFollowUpQuestion": "A friendly question to test if they understood",
  "interactivePractice": {
    "question": "A simple 1-step practice question",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": "Option A",
    "explanation": "Why this option is correct"
  }
}`;

  let replyText = '';
  let analogy = '';
  let steps: string[] = [];
  let followUp = '';
  let practice: TeachingAssistantResponse['interactivePractice'];

  try {
    const raw = await tryComplete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.3, maxTokens: 600 },
    );

    if (raw) {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      replyText = parsed.reply ?? '';
      analogy = parsed.analogyOrExample ?? '';
      steps = Array.isArray(parsed.stepByStepSteps) ? parsed.stepByStepSteps : [];
      followUp = parsed.suggestedFollowUpQuestion ?? '';
      if (parsed.interactivePractice && parsed.interactivePractice.question) {
        practice = parsed.interactivePractice;
      }
    }
  } catch {
    // Fall back to structured pedagogical template
  }

  if (!replyText) {
    const fallback = generateFallbackTeachingAssistant(mode, query, req.struggleTopic, hintLevel);
    replyText = fallback.reply;
    analogy = fallback.analogyOrExample;
    steps = fallback.stepByStepSteps;
    followUp = fallback.suggestedFollowUpQuestion;
    practice = fallback.interactivePractice;
  }

  return {
    reply: replyText,
    mode,
    analogyOrExample: analogy,
    stepByStepSteps: steps,
    suggestedFollowUpQuestion: followUp,
    interactivePractice: practice,
    sources,
  };
}

function generateFallbackTeachingAssistant(
  mode: TeachingAssistantMode,
  query: string,
  topic?: string,
  hintLevel = 1,
) {
  if (mode === 'socratic_hint') {
    if (hintLevel === 1) {
      return {
        reply: `💡 **Hint Level 1 (The Golden Rule)**: Before we can add or subtract fractions like 1/3 and 1/4, think about the bottom numbers (denominators). Can we add pieces together if they aren't the same size?`,
        analogyOrExample: `🍕 Think of a pizza cut into 3 giant slices and another cut into 4 smaller slices. You can't just count slices until they are cut into equal pieces!`,
        stepByStepSteps: [
          'Look at the two denominators (e.g., 3 and 4)',
          'Find a number that both 3 and 4 can count up to (Lowest Common Multiple)',
        ],
        suggestedFollowUpQuestion: 'What is the smallest number that both 3 and 4 can divide into evenly?',
        interactivePractice: {
          question: 'What is the Least Common Denominator (LCD) for 1/3 and 1/4?',
          options: ['7', '12', '14', '6'],
          correctAnswer: '12',
          explanation: 'Multiples of 3 are 3, 6, 9, 12... and multiples of 4 are 4, 8, 12... The first common one is 12!',
        },
      };
    } else if (hintLevel === 2) {
      return {
        reply: `💡 **Hint Level 2 (Converting Numerators)**: Once you choose 12 as your common denominator, whatever you multiply the bottom by to reach 12, you MUST also multiply the top by!`,
        analogyOrExample: `⚖️ Keep the fraction balanced: 1/3 becomes (1 × 4)/(3 × 4) = 4/12.`,
        stepByStepSteps: [
          'Convert 1/3 -> 4/12 (multiplied top and bottom by 4)',
          'Convert 1/4 -> 3/12 (multiplied top and bottom by 3)',
        ],
        suggestedFollowUpQuestion: 'Now that they both have denominator 12, what is 4/12 + 3/12?',
        interactivePractice: {
          question: 'What is 4/12 + 3/12?',
          options: ['7/24', '7/12', '1/12', '12/7'],
          correctAnswer: '7/12',
          explanation: 'Only add the top numbers (4 + 3 = 7). The denominator stays 12!',
        },
      };
    } else {
      return {
        reply: `💡 **Hint Level 3 (Final Check)**: Add the numerators (4 + 3 = 7) and keep the common denominator (12). The answer is 7/12!`,
        analogyOrExample: `🎯 4 slices of a 12-slice pizza plus 3 slices of a 12-slice pizza equals 7 slices of that 12-slice pizza.`,
        stepByStepSteps: [
          'Step 1: Find LCD (12)',
          'Step 2: Rename fractions (4/12 and 3/12)',
          'Step 3: Add numerators (4 + 3 = 7)',
          'Step 4: Keep denominator 12 -> 7/12',
        ],
        suggestedFollowUpQuestion: 'Would you like to try another one on your own now?',
        interactivePractice: {
          question: 'What is 1/2 + 1/3?',
          options: ['2/5', '5/6', '3/6', '2/6'],
          correctAnswer: '5/6',
          explanation: 'Common denominator is 6. 3/6 + 2/6 = 5/6.',
        },
      };
    }
  }

  if (mode === 'concept_simplify') {
    return {
      reply: `Let's make this super simple! Fractions are just sharing things fairly. When denominators don't match, it's like trying to add dollars and euros without exchanging them first.`,
      analogyOrExample: `🍫 Imagine breaking a chocolate bar into 6 equal cubes. If you have 1/2 of the bar (3 cubes) and your friend gives you 1/3 of the bar (2 cubes), you now have 3 + 2 = 5 cubes out of 6!`,
      stepByStepSteps: [
        '1. See fractions as pieces of a whole chocolate bar',
        '2. Cut all pieces to the exact same mini-size (Common Denominator)',
        '3. Count how many mini-pieces you have in total (Add Numerators)',
      ],
      suggestedFollowUpQuestion: 'Does the chocolate bar analogy make more sense than the formula?',
      interactivePractice: {
        question: 'If you have 1/2 of a 6-piece chocolate bar, how many pieces is that?',
        options: ['2 pieces', '3 pieces', '4 pieces', '1 piece'],
        correctAnswer: '3 pieces',
        explanation: 'Half of 6 pieces is 3 pieces (3/6).',
      },
    };
  }

  // Default: step_by_step
  return {
    reply: `Let's break down "${query || topic || 'Adding Unlike Fractions'}" step-by-step so you feel 100% confident:`,
    analogyOrExample: `🍕 1/2 of a pizza + 1/4 of a pizza = 2/4 + 1/4 = 3/4 of a pizza.`,
    stepByStepSteps: [
      'Step 1: Find the Least Common Denominator (LCD) of both bottom numbers.',
      'Step 2: Multiply the top and bottom of each fraction to reach the LCD.',
      'Step 3: Add or subtract ONLY the numerators (top numbers).',
      'Step 4: Keep the denominator the same.',
      'Step 5: Check if the final fraction can be simplified.',
    ],
    suggestedFollowUpQuestion: 'What step would you like to practice together right now?',
    interactivePractice: {
      question: 'What is 1/4 + 2/4?',
      options: ['3/8', '3/4', '2/4', '3/16'],
      correctAnswer: '3/4',
      explanation: 'Because denominators match (4), add numerators 1 + 2 = 3. Answer is 3/4.',
    },
  };
}
