/**
 * Sentence-boundary chunking — ported from Google LangExtract.
 *
 * Three-tier strategy:
 * A) Oversized single token → own chunk
 * B) Token-by-token within a sentence, break at newline boundaries
 * C) Multi-sentence packing
 */

import type { Chunk, TextBlock } from '../core/types.js';
import type { Token } from './tokenizer.js';
import { tokenize } from './tokenizer.js';

// ---------------------------------------------------------------------------
// Abbreviation filtering
// ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set([
  'Mr.',
  'Mrs.',
  'Ms.',
  'Dr.',
  'Prof.',
  'St.',
  'Jr.',
  'Sr.',
  'Inc.',
  'Ltd.',
  'Corp.',
  'vs.',
  'etc.',
  'approx.',
  'dept.',
  'est.',
  'govt.',
  'apt.',
  'Ave.',
  'Blvd.',
]);

const SENTENCE_END_RE = /[.?!。！？\u0964]["'"'»)\]}]*$/;

// ---------------------------------------------------------------------------
// findSentenceRange — ported from LangExtract tokenizer.py
// ---------------------------------------------------------------------------

interface TokenInterval {
  start: number;
  end: number;
}

/**
 * Find the sentence containing the token at startIdx.
 * Returns the token index range [start, end) for the sentence.
 */
function findSentenceRange(tokens: Token[], startIdx: number): TokenInterval {
  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i];

    // Check end-of-sentence punctuation
    if (SENTENCE_END_RE.test(token.text)) {
      // Abbreviation filter: check if the preceding token + this token form an abbreviation
      if (i > 0) {
        const combined = tokens[i - 1].text + token.text;
        if (ABBREVIATIONS.has(combined)) continue;
      }
      if (ABBREVIATIONS.has(token.text)) continue;

      // Greedily consume trailing closing punctuation/quotes
      let end = i + 1;
      while (end < tokens.length) {
        const next = tokens[end];
        if (/^["'"'»)\]}]+$/.test(next.text)) {
          end++;
        } else {
          break;
        }
      }
      return { start: startIdx, end };
    }

    // Newline + uppercase: next token starts after newline and doesn't start lowercase
    if (
      i > startIdx &&
      token.firstTokenAfterNewline &&
      token.text.length > 0 &&
      !/^[a-z]/.test(token.text)
    ) {
      return { start: startIdx, end: i };
    }
  }

  // No boundary found — rest of text is one sentence
  return { start: startIdx, end: tokens.length };
}

// ---------------------------------------------------------------------------
// Three-tier chunking
// ---------------------------------------------------------------------------

function tokenSpanChars(tokens: Token[], from: number, to: number): number {
  if (from >= to || from >= tokens.length) return 0;
  return tokens[Math.min(to, tokens.length) - 1].end - tokens[from].start;
}

function tokensToText(text: string, tokens: Token[], from: number, to: number): string {
  if (from >= to || from >= tokens.length) return '';
  const start = tokens[from].start;
  const end = tokens[Math.min(to, tokens.length) - 1].end;
  return text.slice(start, end);
}

export function sentenceChunk(
  blocks: TextBlock[],
  maxChars: number,
  contextWindow: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let prevChunkTail = '';

  for (const block of blocks) {
    const text = block.text;
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;

    let tokenPos = 0;

    while (tokenPos < tokens.length) {
      const sentence = findSentenceRange(tokens, tokenPos);
      const sentenceChars = tokenSpanChars(tokens, sentence.start, sentence.end);

      let chunkStart = tokenPos;
      let chunkEnd: number;
      let brokenSentence = false;

      // Tier A: oversized single token
      if (sentence.start === sentence.end - 1 && sentenceChars > maxChars) {
        chunkEnd = sentence.end;
        tokenPos = sentence.end;
      }
      // Tier B: sentence exceeds maxChars — break at token boundaries
      else if (sentenceChars > maxChars) {
        let lastNewline = chunkStart;
        let accumulated = 0;

        for (let t = sentence.start; t < sentence.end; t++) {
          const tokenLen =
            t === sentence.start
              ? tokens[t].end - tokens[t].start
              : tokens[t].end - tokens[t - 1].end;
          accumulated += tokenLen;

          if (tokens[t].firstTokenAfterNewline) lastNewline = t;

          if (accumulated > maxChars) {
            // Prefer breaking at the most recent newline boundary
            chunkEnd = lastNewline > chunkStart ? lastNewline : t;
            brokenSentence = true;
            break;
          }
        }
        chunkEnd ??= sentence.end;
        tokenPos = chunkEnd;
      }
      // Tier C: multi-sentence packing
      else {
        chunkEnd = sentence.end;
        tokenPos = sentence.end;

        if (!brokenSentence) {
          // Try to pack more sentences
          while (tokenPos < tokens.length) {
            const nextSentence = findSentenceRange(tokens, tokenPos);
            const nextChars = tokenSpanChars(tokens, nextSentence.start, nextSentence.end);
            const totalChars = tokenSpanChars(tokens, chunkStart, nextSentence.end);

            if (totalChars > maxChars || nextChars > maxChars) break;

            chunkEnd = nextSentence.end;
            tokenPos = nextSentence.end;
          }
        }
      }

      const chunkText = tokensToText(text, tokens, chunkStart, chunkEnd);

      chunks.push({
        text: chunkText,
        context: prevChunkTail || undefined,
        index: chunks.length,
        charOffset: tokens[chunkStart].start,
        source: block.source,
      });

      // Update context window
      prevChunkTail = chunkText.slice(-contextWindow);
    }
  }

  // Set total on all chunks
  for (const chunk of chunks) {
    chunk.total = chunks.length;
  }

  return chunks;
}
