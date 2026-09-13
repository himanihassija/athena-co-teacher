'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { LibraryBook, LibraryPage } from '@echosphere/shared-types';
import { playPageFlipSound, playCornerFoldSound } from './sound';

export interface FlipBookProps {
  book: LibraryBook;
  currentPage: number; // 0-indexed page index (0 = front cover, 1 = page 1, 2 = page 2...)
  glowPage?: number | null;
  onPageFlip?: (pageIndex: number) => void;
  canFlip?: boolean;
}

export function FlipBook({
  book,
  currentPage,
  glowPage,
  onPageFlip,
  canFlip = true,
}: FlipBookProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shiftRef = useRef<HTMLDivElement | null>(null);
  const flipInstanceRef = useRef<any>(null);
  const isInternalTurn = useRef(false);
  const [bookInstanceKey, setBookInstanceKey] = useState(0);

  // Optical centering measurement: centers whatever page/spread is actually visible on screen
  const applyShift = useCallback(() => {
    if (!shiftRef.current || !hostRef.current) return;
    const items = [...hostRef.current.querySelectorAll<HTMLElement>('.stf__item')].filter((el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    });

    const prev = shiftRef.current.style.transition;
    shiftRef.current.style.transition = 'none';
    shiftRef.current.style.transform = 'translateX(0px)';
    void shiftRef.current.offsetWidth; // flush layout before measuring

    let dx = 0;
    if (items.length && shiftRef.current.parentElement) {
      let l = Infinity;
      let r = -Infinity;
      items.forEach((el) => {
        const b = el.getBoundingClientRect();
        l = Math.min(l, b.left);
        r = Math.max(r, b.right);
      });
      const box = shiftRef.current.parentElement.getBoundingClientRect();
      dx = box.left + box.width / 2 - (l + r) / 2;
    }

    void shiftRef.current.offsetWidth;
    shiftRef.current.style.transition = prev || '';
    shiftRef.current.style.transform = `translateX(${dx}px)`;
  }, []);

  // Multi-frame settling retry for optical centering
  const scheduleCenteringRetries = useCallback(() => {
    applyShift();
    requestAnimationFrame(() => {
      applyShift();
      requestAnimationFrame(applyShift);
    });
    setTimeout(applyShift, 80);
    setTimeout(applyShift, 220);
    setTimeout(applyShift, 600);
  }, [applyShift]);

  // When book or canFlip permission changes, update key to replace host <div> completely
  useEffect(() => {
    setBookInstanceKey((k) => k + 1);
  }, [book.id, canFlip]);

  // Initialize PageFlip instance on the freshly mounted host
  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;

    // Dynamically import page-flip to prevent SSR window reference errors
    import('page-flip')
      .then(({ PageFlip }) => {
        if (cancelled || !hostRef.current) return;

        // Destroy any previous instance
        if (flipInstanceRef.current) {
          try {
            flipInstanceRef.current.destroy();
          } catch {
            // Ignored
          }
        }

        const flip = new PageFlip(hostRef.current, {
          width: 352,
          height: 496,
          size: 'stretch',
          minWidth: 210,
          maxWidth: 362,
          minHeight: 300,
          maxHeight: 502,
          maxShadowOpacity: 0.5,
          showCover: true,
          usePortrait: true,
          mobileScrollSupport: false,
          useMouseEvents: canFlip,
          drawShadow: true,
          autoSize: true,
          startPage: currentPage,
        });

        const pages = hostRef.current.querySelectorAll<HTMLElement>('.page');
        if (pages.length > 0) {
          flip.loadFromHTML(pages);
          flipInstanceRef.current = flip;

          flip.on('changeState', (e: any) => {
            if (e.data === 'flipping' || e.data === 'user_fold') {
              if (shiftRef.current) shiftRef.current.style.transform = 'translateX(0px)';
              if (e.data === 'user_fold') {
                playCornerFoldSound();
              }
            }
          });

          flip.on('changeOrientation', () => setTimeout(applyShift, 40));

          flip.on('flip', (e: any) => {
            playPageFlipSound();
            setTimeout(applyShift, 20);
            if (!isInternalTurn.current && onPageFlip) {
              onPageFlip(e.data);
            }
            isInternalTurn.current = false;
          });

          scheduleCenteringRetries();
        }
      })
      .catch((err) => console.error('Failed to load PageFlip:', err));

    const onResize = () => setTimeout(applyShift, 150);
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      if (flipInstanceRef.current) {
        try {
          flipInstanceRef.current.destroy();
          flipInstanceRef.current = null;
        } catch {
          // Ignored
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookInstanceKey, book.id]);

  // Synchronize remote page changes
  useEffect(() => {
    const flip = flipInstanceRef.current;
    if (!flip) return;

    const currentSpread = flip.getCurrentPageIndex();
    if (currentSpread !== currentPage) {
      isInternalTurn.current = true;
      try {
        flip.flip(currentPage);
      } catch {
        try {
          flip.turnToPage(currentPage);
        } catch {
          // Ignored
        }
      }
      playPageFlipSound();
      scheduleCenteringRetries();
    }
  }, [currentPage, scheduleCenteringRetries]);

  return (
    // eco-library-root activates the book-page palette (--gold/--teal/--coral/
    // --violet/--paper) scoped in globals.css. Without it those custom
    // properties are unset here, so most rules below silently drop (no
    // fallback) and one -- --paper on .page -- falls through to the global
    // --paper token instead, which is a near-black *text* color in light
    // mode: it was painting book pages almost unreadable.
    <div className="bookwrap eco-library-root">
      <div id="bookshift" ref={shiftRef}>
        <div id="book" key={`${book.id}-${bookInstanceKey}`} ref={hostRef}>
          {book.pages.map((p, idx) => {
            const isGlow = glowPage === idx;
            if (p.isCover) {
              return (
                <div
                  key={idx}
                  className={`page hard ${isGlow ? 'glow' : ''}`}
                  data-density="hard"
                  data-idx={idx}
                >
                  <div className={`cover ${p.isEndCover ? 'end' : ''}`}>
                    <div className="crest">{p.crest ?? '∑'}</div>
                    <div className="band" />
                    <h2>{p.title}</h2>
                    <p>{p.subtitle}</p>
                  </div>
                </div>
              );
            }

            // Image-based page (e.g. PDF canvas or PPTX slide)
            if (p.imageSrc) {
              return (
                <div
                  key={idx}
                  className={`page page-image-mode ${isGlow ? 'glow' : ''}`}
                  data-a={p.sectionColor || 'gold'}
                  data-idx={idx}
                >
                  <div className="tab" />
                  <img src={p.imageSrc} alt={`Page ${p.pageNumber}`} className="pdf-canvas-img" />
                  <div className="pnum">{p.pageNumber}</div>
                </div>
              );
            }

            // Structured text / math / drill page
            return (
              <div
                key={idx}
                className={`page ${isGlow ? 'glow' : ''}`}
                data-a={p.sectionColor || 'gold'}
                data-idx={idx}
              >
                <div className="tab" />
                {p.sectionTitle && <div className="eyebrow">{p.sectionTitle}</div>}
                {p.heading && <h3>{p.heading}</h3>}
                {p.body?.map((b, bIdx) => (
                  <p key={bIdx} dangerouslySetInnerHTML={{ __html: b }} />
                ))}
                {p.work && <div className="work">{p.work}</div>}
                {p.drill && (
                  <ul className="drill">
                    {p.drill.map((d, dIdx) => (
                      <li key={dIdx}>{d}</li>
                    ))}
                  </ul>
                )}
                <div className="pnum">{p.pageNumber}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
