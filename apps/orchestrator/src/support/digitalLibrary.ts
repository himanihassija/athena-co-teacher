/**
 * Digital Library Catalog and Search Service for Athena.
 *
 * Provides curated NCERT curriculum chapters and dynamic teacher-uploaded books
 * with per-page text indexing and search capabilities for Athena's tool calls and citation pipeline.
 */

import type {
  LibraryBook,
  LibraryPage,
  LibraryPublicState,
  LibrarySearchResult,
  Role,
} from '@echosphere/shared-types';

export const NCERT_CLASS7_CH2_BOOK: LibraryBook = {
  id: 'ncert-7-ch2',
  title: 'Adding unlike fractions',
  subtitle: 'NCERT · CLASS 7 · CHAPTER 2',
  subject: 'NCERT Mathematics',
  kind: 'curriculum',
  addedBy: 'NCERT Curriculum',
  chapterNumber: 2,
  pages: [
    {
      pageNumber: 1,
      isCover: true,
      crest: '∑',
      title: 'Mathematics',
      subtitle: 'CLASS 7 · CHAPTER 2',
      rawText: 'Mathematics Class 7 Chapter 2 Fractions and Decimals. Adding unlike fractions.',
    },
    {
      pageNumber: 2,
      sectionColor: 'gold',
      sectionId: '2.1',
      sectionTitle: '2.1 Introduction',
      heading: 'Unlike fractions',
      body: [
        'Two fractions are unlike when their denominators differ. They cannot be added directly, because the parts they count are not the same size.',
        'Before adding, both fractions must be rewritten so they share one denominator.',
      ],
      rawText:
        '2.1 Introduction Unlike fractions. Two fractions are unlike when their denominators differ. They cannot be added directly, because the parts they count are not the same size. Before adding, both fractions must be rewritten so they share one denominator.',
    },
    {
      pageNumber: 3,
      sectionColor: 'teal',
      sectionId: '2.2',
      sectionTitle: '2.2 Method',
      heading: 'Finding a common denominator',
      body: [
        'Take the lowest common multiple of the two denominators, rewrite each fraction with it, then add the numerators.',
      ],
      work: '1/4 + 1/6\nLCM(4, 6) = 12\n3/12 + 2/12 = 5/12',
      rawText:
        '2.2 Method Finding a common denominator. Take the lowest common multiple of the two denominators, rewrite each fraction with it, then add the numerators. Example: 1/4 + 1/6, LCM of 4 and 6 is 12, 3/12 + 2/12 = 5/12.',
    },
    {
      pageNumber: 4,
      sectionColor: 'teal',
      sectionId: '2.3',
      sectionTitle: '2.3 Worked example',
      heading: 'Step by step',
      body: [
        'Multiply the numerator by the same factor used on the denominator. This is the step students most often miss.',
      ],
      work: '2/3 + 1/5\nLCM(3, 5) = 15\n2/3 = 10/15\n1/5 =  3/15\nSum   = 13/15',
      rawText:
        '2.3 Worked example Step by step. Multiply the numerator by the same factor used on the denominator. This is the step students most often miss. 2/3 + 1/5, LCM of 3 and 5 is 15. 2/3 becomes 10/15, 1/5 becomes 3/15. Sum = 13/15.',
    },
    {
      pageNumber: 5,
      sectionColor: 'coral',
      sectionId: '2.4',
      sectionTitle: '2.4 Common error',
      heading: 'Adding the denominators',
      body: [
        'A frequent mistake is to add the denominators as well as the numerators.',
      ],
      work: 'WRONG   1/4 + 1/6 = 2/10\nRIGHT   1/4 + 1/6 = 5/12',
      rawText:
        '2.4 Common error Adding the denominators. A frequent mistake is to add the denominators as well as the numerators. WRONG: 1/4 + 1/6 = 2/10. RIGHT: 1/4 + 1/6 = 5/12.',
    },
    {
      pageNumber: 6,
      sectionColor: 'violet',
      sectionId: '2.5',
      sectionTitle: '2.5 Worked example',
      heading: 'Subtracting unlike fractions',
      body: [
        'The same common denominator applies — only the operation on the numerators changes.',
      ],
      work: '3/4 − 1/6\nLCM(4, 6) = 12\n9/12 − 2/12 = 7/12',
      rawText:
        '2.5 Worked example Subtracting unlike fractions. The same common denominator applies — only the operation on the numerators changes. Example: 3/4 minus 1/6. LCM of 4 and 6 is 12. 9/12 minus 2/12 = 7/12.',
    },
    {
      pageNumber: 7,
      sectionColor: 'violet',
      sectionId: '2.6',
      sectionTitle: '2.6 Practice',
      heading: 'Try these',
      drill: [
        '1.   1/2 + 1/3',
        '2.   2/5 + 1/4',
        '3.   5/6 − 1/3',
        '4.   3/8 + 1/6',
      ],
      rawText:
        '2.6 Practice Try these problems: 1. 1/2 + 1/3. 2. 2/5 + 1/4. 3. 5/6 minus 1/3. 4. 3/8 + 1/6.',
    },
    {
      pageNumber: 8,
      isCover: true,
      isEndCover: true,
      crest: '✓',
      title: 'End of chapter',
      subtitle: 'ATHENA CAN CITE ANY PAGE',
      rawText: 'End of chapter. Athena can cite any page in the curriculum.',
    },
  ],
};

export const NCERT_CLASS7_CH4_BOOK: LibraryBook = {
  id: 'ncert-7-ch4',
  title: 'Simple equations',
  subtitle: 'NCERT · CLASS 7 · CHAPTER 4',
  subject: 'NCERT Mathematics',
  kind: 'curriculum',
  addedBy: 'NCERT Curriculum',
  chapterNumber: 4,
  pages: [
    {
      pageNumber: 1,
      isCover: true,
      crest: 'x=',
      title: 'Simple Equations',
      subtitle: 'CLASS 7 · CHAPTER 4',
      rawText: 'Mathematics Class 7 Chapter 4 Simple Equations. Setting up and solving linear equations.',
    },
    {
      pageNumber: 2,
      sectionColor: 'gold',
      sectionId: '4.1',
      sectionTitle: '4.1 Introduction',
      heading: 'What is an equation?',
      body: [
        'An equation is a condition on a variable. It says that two expressions have equal value.',
        'At least one of the two expressions must contain the variable.',
      ],
      rawText:
        '4.1 Introduction What is an equation? An equation is a condition on a variable. It says that two expressions have equal value. At least one of the two expressions must contain the variable.',
    },
    {
      pageNumber: 3,
      sectionColor: 'teal',
      sectionId: '4.2',
      sectionTitle: '4.2 Solving equations',
      heading: 'Balancing the scale',
      body: [
        'Whatever mathematical operation you perform on the Left Hand Side (LHS), you must also perform on the Right Hand Side (RHS).',
      ],
      work: '3x + 7 = 25\nSubtract 7 from both sides:\n3x = 18\nDivide both sides by 3:\nx = 6',
      rawText:
        '4.2 Solving equations Balancing the scale. 3x + 7 = 25. Subtract 7 from both sides: 3x = 18. Divide both sides by 3: x = 6.',
    },
    {
      pageNumber: 4,
      sectionColor: 'coral',
      sectionId: '4.3',
      sectionTitle: '4.3 Common error',
      heading: 'Transposing with the wrong sign',
      body: [
        'When moving a term across the equal sign, its operation must invert (+ becomes -, * becomes /).',
      ],
      work: 'WRONG   x - 5 = 10 -> x = 10 - 5 = 5\nRIGHT   x - 5 = 10 -> x = 10 + 5 = 15',
      rawText:
        '4.3 Common error Transposing with wrong sign. When moving a term across the equal sign, its operation must invert. WRONG: x - 5 = 10 gives 5. RIGHT: x - 5 = 10 gives 15.',
    },
    {
      pageNumber: 5,
      isCover: true,
      isEndCover: true,
      crest: '✓',
      title: 'End of chapter',
      subtitle: 'ATHENA CAN CITE ANY PAGE',
      rawText: 'End of chapter 4. Simple equations.',
    },
  ],
};

const GLOBAL_BOOKS: Map<string, LibraryBook> = new Map([
  [NCERT_CLASS7_CH2_BOOK.id, NCERT_CLASS7_CH2_BOOK],
  [NCERT_CLASS7_CH4_BOOK.id, NCERT_CLASS7_CH4_BOOK],
]);

// Per-session custom books store
const SESSION_BOOKS: Map<string, Map<string, LibraryBook>> = new Map();

export function getSessionBooks(sessionId: string): LibraryBook[] {
  const sessionMap = SESSION_BOOKS.get(sessionId);
  const custom = sessionMap ? Array.from(sessionMap.values()) : [];
  return [...Array.from(GLOBAL_BOOKS.values()), ...custom];
}

export function getLibraryBook(bookId: string, sessionId?: string): LibraryBook | undefined {
  if (sessionId) {
    const sessionMap = SESSION_BOOKS.get(sessionId);
    if (sessionMap?.has(bookId)) {
      return sessionMap.get(bookId);
    }
  }
  return GLOBAL_BOOKS.get(bookId);
}

export function addBookToSession(
  sessionId: string,
  book: LibraryBook,
  userRole: Role
): { success: boolean; error?: string } {
  if (userRole !== 'teacher') {
    return { success: false, error: 'Forbidden: Only teachers can add books to the classroom shelf.' };
  }
  if (!SESSION_BOOKS.has(sessionId)) {
    SESSION_BOOKS.set(sessionId, new Map());
  }
  SESSION_BOOKS.get(sessionId)!.set(book.id, book);
  return { success: true };
}

export function removeBookFromSession(
  sessionId: string,
  bookId: string,
  userRole: Role
): { success: boolean; error?: string } {
  if (userRole !== 'teacher') {
    return { success: false, error: 'Forbidden: Only teachers can remove books from the classroom shelf.' };
  }
  if (GLOBAL_BOOKS.has(bookId)) {
    return { success: false, error: 'Cannot remove core curriculum books.' };
  }
  const sessionMap = SESSION_BOOKS.get(sessionId);
  if (!sessionMap || !sessionMap.has(bookId)) {
    return { success: false, error: 'Book not found on classroom shelf.' };
  }
  sessionMap.delete(bookId);
  return { success: true };
}

export function getAllBooks(): LibraryBook[] {
  return Array.from(GLOBAL_BOOKS.values());
}

export function createInitialLibraryState(bookId = NCERT_CLASS7_CH2_BOOK.id): LibraryPublicState {
  return {
    activeBookId: bookId,
    currentPage: 0,
    isLocked: true,
    isPresenting: false,
    presenterId: null,
    lastSequence: 0,
    glowPage: null,
  };
}

/**
 * Searches across pages in a book for keywords or concept queries.
 * Returns the best matching page with confidence score and text snippet.
 */
export function findPageInBook(bookId: string, query: string, sessionId?: string): LibrarySearchResult | null {
  const book = getLibraryBook(bookId, sessionId);
  if (!book || !book.pages || book.pages.length === 0) {
    return null;
  }

  const cleanQuery = query.toLowerCase().trim();
  const queryTerms = cleanQuery.split(/\s+/).filter((t) => t.length > 2);

  let bestPage: LibraryPage | null = null;
  let bestScore = 0;
  let bestSnippet = '';

  for (const page of book.pages) {
    if (page.isCover) continue;

    const pageText = (page.rawText || '').toLowerCase();
    let score = 0;

    // Exact query match bonus
    if (cleanQuery.length > 3 && pageText.includes(cleanQuery)) {
      score += 50;
    }

    // Direct page number match (e.g., "page 6", "p. 6", "pg 6", or standalone number)
    const pageNumMatch = cleanQuery.match(/\b(?:page|pg|p\.?)?\s*(\d+)\b/i);
    if (pageNumMatch && pageNumMatch[1]) {
      const targetNum = parseInt(pageNumMatch[1], 10);
      if (page.pageNumber === targetNum) {
        score += 80;
      }
    }

    // Section title / heading match
    if (page.heading && cleanQuery.includes(page.heading.toLowerCase())) {
      score += 40;
    }
    if (page.sectionTitle && cleanQuery.includes(page.sectionTitle.toLowerCase())) {
      score += 30;
    }

    // Term frequency scoring
    for (const term of queryTerms) {
      if (pageText.includes(term)) {
        score += 10;
        // Count occurrences
        const matches = (pageText.match(new RegExp(`\\b${term}\\b`, 'g')) || []).length;
        score += matches * 5;
      }
    }

    // Math/Worked example keyword cues
    if (cleanQuery.includes('common error') || cleanQuery.includes('mistake') || cleanQuery.includes('wrong')) {
      if (page.sectionColor === 'coral' || pageText.includes('mistake') || pageText.includes('wrong')) {
        score += 35;
      }
    }
    if (cleanQuery.includes('example') || cleanQuery.includes('worked') || cleanQuery.includes('step')) {
      if (page.work || pageText.includes('example') || pageText.includes('step by step')) {
        score += 30;
      }
    }
    if (cleanQuery.includes('practice') || cleanQuery.includes('drill') || cleanQuery.includes('try')) {
      if (page.drill || pageText.includes('practice') || pageText.includes('try these')) {
        score += 30;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPage = page;

      // Extract a descriptive snippet around matching terms
      if (page.heading) {
        bestSnippet = page.heading;
        if (page.body && page.body[0]) {
          bestSnippet += `: ${page.body[0]}`;
        }
      } else {
        bestSnippet = page.rawText ? page.rawText.slice(0, 120) : 'Relevant page content';
      }
    }
  }

  if (!bestPage || bestScore === 0) {
    return null;
  }

  // Find 0-indexed page in book pages array
  const pageIndex = book.pages.indexOf(bestPage);
  const confidence = Math.min(0.99, Number((bestScore / 100).toFixed(2)));

  return {
    bookId,
    page: pageIndex,
    snippet: bestSnippet,
    confidence,
    sectionTitle: bestPage.sectionTitle || bestPage.heading,
  };
}
