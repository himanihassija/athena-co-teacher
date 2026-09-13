/**
 * Seed material for the PS31 demo classroom: adding unlike fractions.
 *
 * Loaded when a session is created with `seed: "unlike-fractions"`. Athena
 * then has the teacher's wording (LCD, not "common denominator") before
 * anyone speaks, so a simpler explanation and a gap cluster on "adding
 * denominators" are grounded in this lesson rather than general knowledge.
 */

export const UNLIKE_FRACTIONS_TITLE = 'Adding unlike fractions';

export const UNLIKE_FRACTIONS_SOURCE = 'Lesson notes — adding unlike fractions';

export const UNLIKE_FRACTIONS_TOPICS = [
  'fractions',
  'LCD',
  'unlike fractions',
];

export const UNLIKE_FRACTIONS_TEXT = `Today we add fractions that do not share a denominator. These are unlike fractions.

Rule: never add the numerators and the denominators separately. 1/2 + 1/3 is not 2/5. That is the most common mistake in this class.

Correct method: find the least common denominator, or LCD. Rewrite each fraction with that denominator, then add only the numerators. Keep the LCD as the denominator of the sum. Simplify if you can.

Example. 1/2 + 1/3. The LCD of 2 and 3 is 6. 1/2 becomes 3/6. 1/3 becomes 2/6. 3/6 + 2/6 = 5/6.

Another example. 2/5 + 1/10. The LCD of 5 and 10 is 10. 2/5 becomes 4/10. 4/10 + 1/10 = 5/10, which simplifies to 1/2.

If a student is stuck, ask: "What number do both denominators divide into?" That number is a common denominator. The smallest such number is the LCD.

Check for understanding: can they say why 1/4 + 1/4 = 2/4 is allowed (same denominator) but 1/4 + 1/2 is not 2/6?
`;

export function seedUnlikeFractionsLesson(lesson: {
  addDocument(source: string, text: string, topics?: string[]): unknown;
}): void {
  lesson.addDocument(
    UNLIKE_FRACTIONS_SOURCE,
    UNLIKE_FRACTIONS_TEXT,
    UNLIKE_FRACTIONS_TOPICS,
  );
}
