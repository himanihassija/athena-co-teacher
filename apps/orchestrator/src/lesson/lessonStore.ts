/**
 * Lesson material store — PS31 §3.4 (contextual answers based on the lesson).
 *
 * Chunks teacher-uploaded material and ranks chunks by relevance so the most
 * useful parts can be placed in the agent's system prompt.
 *
 * Retrieval is a real (if simple) in-memory vector index — character-trigram
 * hashed, TF-weighted, L2-normalized embeddings compared by cosine similarity
 * — not a call to an embeddings API. There is no OpenAI key in this project —
 * the model is Agora's resold gpt-4o-mini — so there is nothing to call for a
 * vector, and the plan explicitly allows an in-memory store at this scale.
 * Hashing character trigrams rather than whole tokens is deliberate: it is
 * honest about what this catches (morphological variants and typos —
 * "denominators" still overlaps "denominator" even though the exact tokens
 * differ) without overclaiming the semantic-synonym matching a real
 * embedding model would give ("sum" vs "total" still won't match here).
 */

import { randomUUID } from 'node:crypto';
import type { LessonChunk, RetrievedChunk } from '@echosphere/shared-types';

/** Target chunk size in characters. Roughly a paragraph — small enough that a
 *  retrieved chunk is quotable in a spoken answer without truncation. */
const CHUNK_TARGET_CHARS = 700;
const CHUNK_OVERLAP_CHARS = 120;

export interface LessonStore {
  sessionId: string;
  chunks: LessonChunk[];
  addDocument(source: string, text: string, topics?: string[]): LessonChunk[];
  /** Ranked chunks for a query. Synchronous — there is no network call. */
  retrieveSync(query: string, k?: number): RetrievedChunk[];
  topics(): string[];
  isEmpty(): boolean;
}

export function createLessonStore(sessionId: string): LessonStore {
  const chunks: LessonChunk[] = [];

  return {
    sessionId,
    chunks,

    addDocument(source, text, topics = []) {
      const pieces = chunkText(text);
      const created: LessonChunk[] = pieces.map((piece, i) => ({
        chunkId: randomUUID(),
        sessionId,
        source,
        text: piece,
        ordinal: i,
        topics: topics.length > 0 ? topics : inferTopics(piece),
        embedding: hashEmbed(piece),
      }));

      chunks.push(...created);
      return created;
    },

    retrieveSync(query, k = 4) {
      if (chunks.length === 0) return [];
      const queryVector = hashEmbed(query);
      const scored = chunks
        .map((chunk) => ({
          chunk,
          score: cosineSimilarity(queryVector, chunk.embedding ?? hashEmbed(chunk.text)),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      // A query with no overlap at all (an empty classroom, or a lesson that has
      // not been discussed yet) should still contribute material rather than
      // nothing, so fall back to document order.
      return scored.length > 0
        ? scored
        : chunks.slice(0, k).map((chunk) => ({ chunk, score: 0 }));
    },

    topics() {
      return [...new Set(chunks.flatMap((c) => c.topics))].sort();
    },

    isEmpty() {
      return chunks.length === 0;
    },
  };
}

/**
 * Splits on paragraph boundaries and re-packs into ~CHUNK_TARGET_CHARS windows
 * with overlap, so a sentence spanning a boundary still appears whole in one
 * chunk. Paragraph-first (rather than fixed-width) keeps slide bullets intact.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  const out: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.length + paragraph.length + 1 > CHUNK_TARGET_CHARS) {
      out.push(current);
      const tail = current.slice(-CHUNK_OVERLAP_CHARS);
      current = `${tail} ${paragraph}`.trim();
    } else {
      current = current.length > 0 ? `${current} ${paragraph}` : paragraph;
    }
  }
  if (current.trim().length > 0) out.push(current.trim());

  // A single oversized paragraph still needs splitting.
  return out.flatMap((c) =>
    c.length <= CHUNK_TARGET_CHARS * 2 ? [c] : hardSplit(c, CHUNK_TARGET_CHARS),
  );
}

function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'that', 'this', 'it', 'as', 'at', 'by',
  'from', 'we', 'you', 'i', 'do', 'does', 'did', 'so', 'if', 'then', 'than',
  'what', 'how', 'why', 'when', 'can', 'could', 'would', 'should', 'about',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Dimensionality of the hashed embedding. Fixed and small — this is a
 *  bag-of-trigrams sketch, not a learned representation, so there is no
 *  benefit to a larger vector at lesson-chunk scale. */
const EMBEDDING_DIMENSIONS = 256;

/** Character trigrams of one token, padded so short tokens still contribute. */
function trigrams(token: string): string[] {
  const padded = `  ${token} `;
  if (padded.length < 3) return [padded];
  const grams: string[] = [];
  for (let i = 0; i <= padded.length - 3; i += 1) {
    grams.push(padded.slice(i, i + 3));
  }
  return grams;
}

/** FNV-1a — small, dependency-free, good enough distribution for hashing into a fixed bucket count. */
function hashToBucket(s: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % buckets;
}

/**
 * A term-frequency-weighted, L2-normalized embedding built from character
 * trigrams of `tokenise()`'s output, hashed into a fixed-size vector (the
 * "hashing trick" — no vocabulary to build or store, so a chunk's vector
 * never needs recomputing when later chunks introduce new words).
 */
export function hashEmbed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of tokenise(text)) {
    for (const gram of trigrams(token)) {
      const bucket = hashToBucket(gram, EMBEDDING_DIMENSIONS);
      vector[bucket] = (vector[bucket] ?? 0) + 1;
    }
  }

  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  // Both vectors are already L2-normalized (hashEmbed's own output), so the
  // dot product alone is the cosine similarity — no need to divide by the
  // magnitudes again.
  return dot;
}

/**
 * Cheap topic tagging: the most frequent content words in a chunk. The gap
 * detector clusters on these, so they only need to be stable, not clever.
 */
function inferTopics(text: string, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenise(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}
