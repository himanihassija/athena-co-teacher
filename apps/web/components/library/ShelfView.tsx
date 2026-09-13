'use client';

import React, { useState } from 'react';
import type { LibraryBook, Role } from '@echosphere/shared-types';
import { parseProseText, parsePptxFile, parsePdfFile } from './BookParsers';
import { BookOpen, FileText, Presentation, Plus, Trash2, X, Loader2, Sparkles } from 'lucide-react';

interface ShelfViewProps {
  books: LibraryBook[];
  activeBookId: string;
  userRole: Role;
  onSelectBook: (bookId: string) => void;
  onAddBook: (book: LibraryBook) => Promise<void>;
  onRemoveBook: (bookId: string) => Promise<void>;
}

export function ShelfView({
  books,
  activeBookId,
  userRole,
  onSelectBook,
  onAddBook,
  onRemoveBook,
}: ShelfViewProps) {
  const isTeacher = userRole === 'teacher';
  const [modalType, setModalType] = useState<'pdf' | 'pptx' | 'text' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Paste text state
  const [textTitle, setTextTitle] = useState('');
  const [textSubtitle, setTextSubtitle] = useState('');
  const [textContent, setTextContent] = useState('');

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleCreateTextBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textTitle.trim() || !textContent.trim()) {
      setErrorMsg('Please provide a title and text content.');
      return;
    }
    try {
      setIsProcessing(true);
      setErrorMsg(null);
      const book = parseProseText(textTitle, textSubtitle, textContent, 'Teacher');
      await onAddBook(book);
      setModalType(null);
      setTextTitle('');
      setTextSubtitle('');
      setTextContent('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to parse text document.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg('Please select a file to upload.');
      return;
    }
    try {
      setIsProcessing(true);
      setErrorMsg(null);
      let book: LibraryBook;
      if (modalType === 'pdf') {
        book = await parsePdfFile(selectedFile, 'Teacher');
      } else if (modalType === 'pptx') {
        book = await parsePptxFile(selectedFile, 'Teacher');
      } else {
        throw new Error('Unsupported upload kind');
      }
      await onAddBook(book);
      setModalType(null);
      setSelectedFile(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload and parse file.');
    } finally {
      setIsProcessing(false);
    }
  };

  const getSpineGradient = (book: LibraryBook, idx: number) => {
    if (book.id === 'ncert-7-ch2') {
      return 'linear-gradient(135deg, #FFB020 0%, #D97706 50%, #92400E 100%)';
    }
    if (book.id === 'ncert-7-ch4') {
      return 'linear-gradient(135deg, #2DD4BF 0%, #0D9488 50%, #115E59 100%)';
    }
    const gradients = [
      'linear-gradient(135deg, #A78BFA 0%, #7C3AED 50%, #4C1D95 100%)',
      'linear-gradient(135deg, #38BDF8 0%, #0284C7 50%, #0369A1 100%)',
      'linear-gradient(135deg, #FF6B6B 0%, #DC2626 50%, #991B1B 100%)',
      'linear-gradient(135deg, #F472B6 0%, #DB2777 50%, #831843 100%)',
    ];
    return gradients[idx % gradients.length];
  };

  return (
    <div className="library-shelf-wrapper">
      <div className="shelf-header">
        <div>
          <h2 className="shelf-title">Classroom Digital Library</h2>
          <p className="shelf-subtitle">
            Curated curriculum textbooks, teacher presentations, and class notes synchronized live.
          </p>
        </div>
      </div>

      <div className="shelf-grid">
        {/* Books currently on shelf */}
        {books.map((b, idx) => {
          const isActive = b.id === activeBookId;
          const isCore = b.id === 'ncert-7-ch2' || b.id === 'ncert-7-ch4';
          return (
            <div
              key={b.id}
              className={`shelf-book-card ${isActive ? 'active' : ''}`}
              onClick={() => onSelectBook(b.id)}
            >
              <div
                className="book-spine-cover"
                style={{ background: getSpineGradient(b, idx) }}
              >
                <div className="spine-tag">{b.subject || 'Textbook'}</div>
                <div className="spine-title">{b.title}</div>
                <div className="spine-footer">
                  <span>{b.pages?.length || 0} pages</span>
                  <span>{b.addedBy || 'Curriculum'}</span>
                </div>
              </div>

              <div className="book-card-info">
                <div className="book-info-title">{b.title}</div>
                <div className="book-info-sub">{b.subtitle || 'Chapter content'}</div>
                <div className="book-info-meta">
                  <span className="book-kind-badge">{b.kind || 'curriculum'}</span>
                  {isActive && <span className="open-now-badge">Open on Stage</span>}
                </div>
              </div>

              {isTeacher && !isCore && (
                <button
                  className="delete-book-btn"
                  title="Remove book from class shelf"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Remove "${b.title}" from this classroom shelf?`)) {
                      onRemoveBook(b.id);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          );
        })}

        {/* Teacher Add Cards */}
        {isTeacher && (
          <>
            <div
              className="shelf-add-card"
              onClick={() => {
                setModalType('text');
                setErrorMsg(null);
              }}
            >
              <div className="add-icon-box gold">
                <FileText size={26} />
              </div>
              <div className="add-card-title">Paste Text / Notes</div>
              <div className="add-card-desc">
                Instant prose parser with section chunking, heading detection, and color cycling.
              </div>
              <div className="add-btn-pill">
                <Plus size={14} /> Paste Notes
              </div>
            </div>

            <div
              className="shelf-add-card"
              onClick={() => {
                setModalType('pdf');
                setErrorMsg(null);
                setSelectedFile(null);
              }}
            >
              <div className="add-icon-box teal">
                <BookOpen size={26} />
              </div>
              <div className="add-card-title">Upload PDF</div>
              <div className="add-card-desc">
                Rasterizes pages for flipbook display & extracts full-text indexing for Athena citations.
              </div>
              <div className="add-btn-pill">
                <Plus size={14} /> Upload PDF
              </div>
            </div>

            <div
              className="shelf-add-card"
              onClick={() => {
                setModalType('pptx');
                setErrorMsg(null);
                setSelectedFile(null);
              }}
            >
              <div className="add-icon-box violet">
                <Presentation size={26} />
              </div>
              <div className="add-card-title">Upload PPTX</div>
              <div className="add-card-desc">
                Extracts slide text runs and primary slide diagrams for live synced walkthroughs.
              </div>
              <div className="add-btn-pill">
                <Plus size={14} /> Upload PPTX
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal Dialogs for Adding Books */}
      {modalType && (
        <div className="library-modal-overlay" onClick={() => !isProcessing && setModalType(null)}>
          <div className="library-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <Sparkles size={20} className="modal-sparkle" />
                <h3>
                  {modalType === 'text' && 'Add Textbook via Plain Text Parser'}
                  {modalType === 'pdf' && 'Upload PDF Textbook'}
                  {modalType === 'pptx' && 'Upload PowerPoint Slide Deck'}
                </h3>
              </div>
              <button
                className="modal-close-btn"
                disabled={isProcessing}
                onClick={() => setModalType(null)}
              >
                <X size={18} />
              </button>
            </div>

            {errorMsg && <div className="modal-error-banner">{errorMsg}</div>}

            {modalType === 'text' && (
              <form onSubmit={handleCreateTextBook}>
                <div className="form-group">
                  <label>Document / Chapter Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Chapter 3: Data Handling"
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    disabled={isProcessing}
                  />
                </div>

                <div className="form-group">
                  <label>Subtitle or Subject Tag</label>
                  <input
                    type="text"
                    placeholder="e.g. NCERT Mathematics · Class 7"
                    value={textSubtitle}
                    onChange={(e) => setTextSubtitle(e.target.value)}
                    disabled={isProcessing}
                  />
                </div>

                <div className="form-group">
                  <label>Prose / Notes Body</label>
                  <div className="parser-tips">
                    Short lines (≤72 chars) without punctuation become headings. Lines starting with -, *, or 1. become bullet drills.
                  </div>
                  <textarea
                    rows={8}
                    required
                    placeholder="Paste lesson text, definitions, worked examples, and drills here..."
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    disabled={isProcessing}
                  />
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-cancel"
                    disabled={isProcessing}
                    onClick={() => setModalType(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isProcessing}>
                    {isProcessing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Parsing & Adding...
                      </>
                    ) : (
                      'Generate & Add Book'
                    )}
                  </button>
                </div>
              </form>
            )}

            {(modalType === 'pdf' || modalType === 'pptx') && (
              <form onSubmit={handleUploadFile}>
                <div className="form-group">
                  <label>Select {modalType.toUpperCase()} File</label>
                  <input
                    type="file"
                    required
                    accept={modalType === 'pdf' ? '.pdf' : '.pptx'}
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    disabled={isProcessing}
                  />
                </div>

                {modalType === 'pptx' && (
                  <div className="parser-disclaimer">
                    <b>Fidelity notice:</b> Slides are parsed for structured text runs and primary embedded images. Complex vector graphics or proprietary animations are rendered in clean textbook format.
                  </div>
                )}

                {modalType === 'pdf' && (
                  <div className="parser-disclaimer">
                    <b>Indexing notice:</b> Each page is rendered to high-resolution canvas with full text extracted for Athena AI voice citations.
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-cancel"
                    disabled={isProcessing}
                    onClick={() => setModalType(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isProcessing}>
                    {isProcessing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Processing {modalType.toUpperCase()}...
                      </>
                    ) : (
                      'Upload & Open on Shelf'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
