/**
 * Client-side parsers for the three Athena Digital Library book creation paths:
 * 1. Upload PDF (Canvas rasterization + text extraction via PDF.js without blob worker traps)
 * 2. Upload PPTX (XML text runs and embedded images via JSZip)
 * 3. Paste Text (Prose parser with section chunking, heading detection, and color cycling)
 */

import type { LibraryBook, LibraryPage, SectionColor } from '@echosphere/shared-types';
import JSZip from 'jszip';

const SECTION_COLORS: SectionColor[] = ['gold', 'teal', 'coral', 'violet'];

/**
 * 1. Parse plain prose text into structured flipbook pages.
 *
 * Rules:
 * - Blank lines separate blocks.
 * - Short lines (<= 72 chars) with no closing punctuation become headings and start a new page.
 * - Lines starting with '-', '*', '•', or '1.', '2.' become bullet/drill items.
 * - Long text sections (> 720 chars) are cleanly split across multiple pages.
 * - Cycles section accent colors (gold, teal, coral, violet).
 */
export function parseProseText(title: string, subtitle: string, rawProse: string, addedBy = 'Teacher'): LibraryBook {
  const bookId = 'book-' + Math.random().toString(36).substring(2, 9);
  const pages: LibraryPage[] = [];

  // Front Cover
  pages.push({
    pageNumber: 1,
    isCover: true,
    crest: '✦',
    title: title.trim() || 'Classroom Notes',
    subtitle: subtitle.trim() || 'Athena Digital Library',
    rawText: `${title} ${subtitle}`,
  });

  const lines = rawProse.split(/\r?\n/);
  let colorIdx = 0;
  let currentHeading = title.trim() || 'Introduction';
  let currentSection = '1.1 Overview';
  let currentBody: string[] = [];
  let currentDrill: string[] = [];
  let currentWork = '';
  let sectionCounter = 1;

  function flushPage() {
    if (currentBody.length === 0 && currentDrill.length === 0 && !currentWork) {
      return;
    }
    const color = SECTION_COLORS[colorIdx % SECTION_COLORS.length];
    const textPieces = [currentHeading, ...currentBody, ...currentDrill, currentWork].filter(Boolean);

    pages.push({
      pageNumber: pages.length + 1,
      sectionId: `sec-${sectionCounter}`,
      sectionTitle: currentSection,
      sectionColor: color,
      heading: currentHeading,
      body: currentBody.length ? [...currentBody] : undefined,
      drill: currentDrill.length ? [...currentDrill] : undefined,
      work: currentWork ? currentWork : undefined,
      rawText: textPieces.join(' '),
    });

    currentBody = [];
    currentDrill = [];
    currentWork = '';
  }

  let paragraphBuffer = '';

  function flushParagraph() {
    if (!paragraphBuffer.trim()) return;
    const p = paragraphBuffer.trim();

    // Split if single paragraph is excessively long (> 720 chars)
    if (p.length > 720) {
      const sentences = p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [p];
      let chunk = '';
      for (const sent of sentences) {
        if ((chunk + sent).length > 720 && chunk.length > 0) {
          currentBody.push(chunk.trim());
          flushPage();
          chunk = sent;
        } else {
          chunk += sent;
        }
      }
      if (chunk.trim()) {
        currentBody.push(chunk.trim());
      }
    } else {
      currentBody.push(p);
      const totalLen = currentBody.reduce((acc, b) => acc + b.length, 0);
      if (totalLen >= 720) {
        flushPage();
      }
    }
    paragraphBuffer = '';
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Blank line
    if (!line) {
      flushParagraph();
      continue;
    }

    // Heading detection: short line (<= 72 chars), no terminal punctuation, not a bullet
    const isBullet = /^([-*•]|\d+\.)\s+/.test(line);
    const hasTerminalPunctuation = /[.?!,;:]$/.test(line);
    const isHeading = !isBullet && line.length <= 72 && !hasTerminalPunctuation && (paragraphBuffer === '');

    if (isHeading) {
      flushParagraph();
      flushPage();
      sectionCounter++;
      colorIdx++;
      currentHeading = line;
      currentSection = `${sectionCounter}.0 ${line}`;
      continue;
    }

    // Bullet detection
    if (isBullet) {
      flushParagraph();
      const bulletText = line.replace(/^([-*•]|\d+\.)\s+/, '').trim();
      currentDrill.push(bulletText);
      if (currentDrill.length >= 6) {
        flushPage();
      }
      continue;
    }

    // Check for math or worked example blocks (contains = or -> or formulas)
    if (line.includes('=') && line.length < 120 && paragraphBuffer === '') {
      flushParagraph();
      currentWork = currentWork ? currentWork + '\n' + line : line;
      continue;
    }

    // Standard prose line accumulation
    paragraphBuffer = paragraphBuffer ? `${paragraphBuffer} ${line}` : line;
  }

  flushParagraph();
  flushPage();

  // If no pages were generated from text, add at least one placeholder page
  if (pages.length === 1) {
    pages.push({
      pageNumber: 2,
      sectionId: 'sec-1',
      sectionTitle: '1.0 Notes',
      sectionColor: 'gold',
      heading: title.trim() || 'Classroom Content',
      body: [rawProse.trim() || 'No content provided.'],
      rawText: rawProse.trim() || title,
    });
  }

  // End / Back Cover
  pages.push({
    pageNumber: pages.length + 1,
    isCover: true,
    isEndCover: true,
    crest: '✓',
    title: 'End of Document',
    subtitle: 'ATHENA CAN CITE ANY PAGE',
    rawText: 'End of Document Athena citation',
  });

  return {
    id: bookId,
    title: title.trim() || 'Pasted Notes',
    subtitle: subtitle.trim() || 'Textbook & Class Reference',
    subject: 'Class Notes',
    kind: 'text',
    addedBy,
    createdAt: new Date().toISOString(),
    pages,
  };
}

/**
 * 2. Parse uploaded PPTX file into structured flipbook pages.
 * Uses JSZip to extract slide text runs and first embedded picture.
 */
export async function parsePptxFile(file: File, addedBy = 'Teacher'): Promise<LibraryBook> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const bookId = 'book-' + Math.random().toString(36).substring(2, 9);
  const rawTitle = file.name.replace(/\.pptx$/i, '').replace(/[_-]/g, ' ');
  const pages: LibraryPage[] = [];

  // Front Cover
  pages.push({
    pageNumber: 1,
    isCover: true,
    crest: '📊',
    title: rawTitle,
    subtitle: 'Uploaded Presentation (PPTX)',
    rawText: rawTitle,
  });

  // Find all slide XMLs in ppt/slides/
  const slideKeys = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      return numA - numB;
    });

  let colorIdx = 0;

  for (let i = 0; i < slideKeys.length; i++) {
    const slidePath = slideKeys[i];
    const slideXml = await zip.file(slidePath)?.async('text');
    if (!slideXml) continue;

    // Parse slide XML with DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(slideXml, 'application/xml');

    // Extract text runs: <a:t>
    const textNodes = Array.from(doc.getElementsByTagName('a:t'));
    const textRuns = textNodes.map((n) => n.textContent?.trim()).filter(Boolean) as string[];

    const slideTitle = textRuns[0] || `Slide ${i + 1}`;
    const slideBody = textRuns.slice(1);

    // Try resolving first image via ppt/slides/_rels/slideN.xml.rels
    let imageSrc: string | undefined = undefined;
    const relsPath = slidePath.replace('ppt/slides/slide', 'ppt/slides/_rels/slide') + '.rels';
    const relsXml = await zip.file(relsPath)?.async('text');
    if (relsXml) {
      const relsDoc = parser.parseFromString(relsXml, 'application/xml');
      const relationships = Array.from(relsDoc.getElementsByTagName('Relationship'));
      const imageRel = relationships.find((r) =>
        r.getAttribute('Type')?.includes('relationships/image')
      );
      if (imageRel) {
        let target = imageRel.getAttribute('Target') || '';
        if (target.startsWith('../')) {
          target = 'ppt/' + target.replace(/^\.\.\//, '');
        } else if (!target.startsWith('ppt/')) {
          target = 'ppt/slides/' + target;
        }
        const imgFile = zip.file(target);
        if (imgFile) {
          const imgBlob = await imgFile.async('blob');
          imageSrc = URL.createObjectURL(imgBlob);
        }
      }
    }

    const color = SECTION_COLORS[colorIdx % SECTION_COLORS.length];
    colorIdx++;

    pages.push({
      pageNumber: pages.length + 1,
      sectionId: `slide-${i + 1}`,
      sectionTitle: `Slide ${i + 1}`,
      sectionColor: color,
      heading: slideTitle,
      body: slideBody.length ? slideBody : undefined,
      imageSrc,
      rawText: [slideTitle, ...slideBody].join(' '),
    });
  }

  // Back Cover
  pages.push({
    pageNumber: pages.length + 1,
    isCover: true,
    isEndCover: true,
    crest: '✓',
    title: 'End of Slides',
    subtitle: 'ATHENA CAN CITE ANY SLIDE',
    rawText: 'End of Slides Athena citation',
  });

  return {
    id: bookId,
    title: rawTitle,
    subtitle: 'Imported Presentation',
    subject: 'Slide Deck',
    kind: 'pptx',
    addedBy,
    createdAt: new Date().toISOString(),
    pages,
  };
}

/**
 * 3. Parse uploaded PDF file into structured flipbook pages.
 * Uses pdfjs-dist without blob worker URL (in-process fallback) to render canvas
 * and extract text content via getTextContent() for full-text search and AI citation.
 */
export async function parsePdfFile(file: File, addedBy = 'Teacher'): Promise<LibraryBook> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await import('pdfjs-dist');

  // Configure worker safely with jsdelivr ESM worker matching installed pdfjs-dist version
  if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;

  const bookId = 'book-' + Math.random().toString(36).substring(2, 9);
  const rawTitle = file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
  const pages: LibraryPage[] = [];

  // Front Cover
  pages.push({
    pageNumber: 1,
    isCover: true,
    crest: '📖',
    title: rawTitle,
    subtitle: `PDF Document (${pdf.numPages} Pages)`,
    rawText: rawTitle,
  });

  let colorIdx = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });

    // Render page canvas to data URL
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      // White background
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const renderContext: any = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      };
      await page.render(renderContext).promise;
    }

    const imageSrc = canvas.toDataURL('image/jpeg', 0.85);

    // Extract text content for Athena citations and search
    const textContent = await page.getTextContent();
    const textItems = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .filter(Boolean);
    const rawText = textItems.join(' ');
    const heading = textItems[0] ? textItems[0].slice(0, 60) : `Page ${pageNum}`;

    const color = SECTION_COLORS[colorIdx % SECTION_COLORS.length];
    colorIdx++;

    pages.push({
      pageNumber: pages.length + 1,
      sectionId: `pdf-page-${pageNum}`,
      sectionTitle: `Page ${pageNum}`,
      sectionColor: color,
      heading,
      imageSrc,
      rawText: rawText || `Page ${pageNum} content`,
    });
  }

  // Back Cover
  pages.push({
    pageNumber: pages.length + 1,
    isCover: true,
    isEndCover: true,
    crest: '✓',
    title: 'End of Document',
    subtitle: 'ATHENA CAN CITE ANY PAGE',
    rawText: 'End of Document Athena citation',
  });

  return {
    id: bookId,
    title: rawTitle,
    subtitle: 'Imported PDF Document',
    subject: 'Textbook / PDF',
    kind: 'pdf',
    addedBy,
    createdAt: new Date().toISOString(),
    pages,
  };
}
