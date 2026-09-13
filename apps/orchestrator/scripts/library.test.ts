import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NCERT_CLASS7_CH2_BOOK,
  NCERT_CLASS7_CH4_BOOK,
  findPageInBook,
  getLibraryBook,
  getAllBooks,
  getSessionBooks,
  addBookToSession,
  removeBookFromSession,
  createInitialLibraryState,
} from '../src/support/digitalLibrary.js';
import { parseAgentTurn } from '../src/agent/control.js';
import type { LibraryBook } from '@echosphere/shared-types';

test('Digital Library catalog loads default NCERT curriculum books', () => {
  const book = getLibraryBook('ncert-7-ch2');
  assert.ok(book, 'NCERT chapter 2 book should be registered');
  assert.equal(book.pages.length, 8, 'Book should have 8 pages');
  assert.equal(book.pages[0]?.isCover, true, 'Page 1 should be cover');
  assert.equal(book.pages[7]?.isEndCover, true, 'Page 8 should be end cover');

  const books = getAllBooks();
  assert.ok(books.length >= 2, 'Should return at least 2 default books');
});

test('findPageInBook accurately locates topics and page numbers', () => {
  // Query for common denominator / LCM
  const matchLCM = findPageInBook('ncert-7-ch2', 'finding a common denominator LCM');
  assert.ok(matchLCM, 'Should match common denominator');
  assert.equal(matchLCM.page, 2, 'Should point to page 3 (index 2: 2.2 Method)');

  // Query for worked example step by step
  const matchWorked = findPageInBook('ncert-7-ch2', 'worked example step by step');
  assert.ok(matchWorked, 'Should match worked example');
  assert.equal(matchWorked.page, 3, 'Should point to page 4 (index 3: 2.3 Worked example)');

  // Query for common error adding denominators
  const matchError = findPageInBook('ncert-7-ch2', 'common error adding denominators');
  assert.ok(matchError, 'Should match common error');
  assert.equal(matchError.page, 4, 'Should point to page 5 (index 4: 2.4 Common error)');

  // Query for practice drill
  const matchDrill = findPageInBook('ncert-7-ch2', 'practice exercises try these');
  assert.ok(matchDrill, 'Should match practice');
  assert.equal(matchDrill.page, 6, 'Should point to page 7 (index 6: 2.6 Practice)');

  // Query for direct page citation "page 6"
  const matchPage6 = findPageInBook('ncert-7-ch2', 'page 6');
  assert.ok(matchPage6, 'Should match page 6');
  assert.equal(matchPage6.page, 5, 'Should point to index 5 (Page 6: Subtracting unlike fractions)');
});

test('parseAgentTurn correctly parses library tool citations', () => {
  const turnText =
    "That's the worked example on page 6. {\"library\":{\"action\":\"open\",\"bookId\":\"ncert-7-ch2\",\"page\":5}}";
  const parsed = parseAgentTurn(turnText);

  assert.equal(parsed.spoken, "That's the worked example on page 6.");
  assert.ok(parsed.control, 'Control object should be parsed');
  assert.deepEqual(parsed.control.library, {
    action: 'open',
    bookId: 'ncert-7-ch2',
    page: 5,
    query: undefined,
  });
});

test('Session books store enforces role-based addition and deletion', () => {
  const sessionId = 'test-session-library-1';
  const customBook: LibraryBook = {
    id: 'custom-notes-1',
    title: 'Algebra Foundations',
    subtitle: 'Class Notes',
    subject: 'Mathematics',
    kind: 'text',
    addedBy: 'Mrs. Davis',
    pages: [
      {
        pageNumber: 1,
        isCover: true,
        title: 'Algebra Foundations',
        rawText: 'Algebra Foundations',
      },
      {
        pageNumber: 2,
        heading: 'Variables and Constants',
        rawText: 'Variables represent unknown quantities.',
      },
    ],
  };

  // Student cannot add book
  const studentAdd = addBookToSession(sessionId, customBook, 'student');
  assert.equal(studentAdd.success, false, 'Student adding book should be rejected');

  // Teacher can add book
  const teacherAdd = addBookToSession(sessionId, customBook, 'teacher');
  assert.equal(teacherAdd.success, true, 'Teacher adding book should succeed');

  // Verify book appears on shelf
  const sessionShelf = getSessionBooks(sessionId);
  assert.ok(sessionShelf.some((b) => b.id === 'custom-notes-1'), 'Custom book should be on shelf');

  // Student cannot remove book
  const studentDel = removeBookFromSession(sessionId, 'custom-notes-1', 'student');
  assert.equal(studentDel.success, false, 'Student removing book should be rejected');

  // Teacher cannot remove core curriculum book
  const coreDel = removeBookFromSession(sessionId, 'ncert-7-ch2', 'teacher');
  assert.equal(coreDel.success, false, 'Core curriculum book cannot be removed');

  // Teacher can remove custom book
  const teacherDel = removeBookFromSession(sessionId, 'custom-notes-1', 'teacher');
  assert.equal(teacherDel.success, true, 'Teacher removing custom book should succeed');
});

test('Initial library state starts with default locked configuration', () => {
  const state = createInitialLibraryState('ncert-7-ch2');
  assert.equal(state.activeBookId, 'ncert-7-ch2');
  assert.equal(state.currentPage, 0);
  assert.equal(state.isLocked, true);
  assert.equal(state.isPresenting, false);
  assert.equal(state.lastSequence, 0);
});
