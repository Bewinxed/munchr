/**
 * Heading-based chunking.
 * Splits at markdown heading boundaries, with fallback to sentence splitting.
 */

import type { Chunk, TextBlock } from '../core/types.js';
import { sentenceChunk } from './sentence.js';

const HEADING_RE = /^#{1,6}\s/;

interface Section {
  text: string;
  startOffset: number;
}

function splitIntoSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let currentLines: string[] = [];
  let currentOffset = 0;
  let lineOffset = 0;

  for (const line of lines) {
    if (HEADING_RE.test(line) && currentLines.length > 0) {
      sections.push({
        text: currentLines.join('\n'),
        startOffset: currentOffset,
      });
      currentOffset = lineOffset;
      currentLines = [];
    }
    currentLines.push(line);
    lineOffset += line.length + 1;
  }

  if (currentLines.length > 0) {
    sections.push({
      text: currentLines.join('\n'),
      startOffset: currentOffset,
    });
  }

  return sections;
}

export function structuralChunk(
  blocks: TextBlock[],
  maxChars: number,
  contextWindow: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let prevChunkTail = '';

  for (const block of blocks) {
    const sections = splitIntoSections(block.text);
    let accumulated: Section[] = [];
    let accumulatedChars = 0;

    for (const section of sections) {
      // If a single section exceeds maxChars, fall back to sentence splitting
      if (section.text.length > maxChars) {
        // Flush any accumulated sections first
        if (accumulated.length > 0) {
          const text = accumulated.map((s) => s.text).join('\n');
          chunks.push({
            text,
            context: prevChunkTail || undefined,
            index: chunks.length,
            charOffset: accumulated[0].startOffset,
            source: block.source,
          });
          prevChunkTail = text.slice(-contextWindow);
          accumulated = [];
          accumulatedChars = 0;
        }

        // Use sentence chunking for this oversized section
        const subBlock: TextBlock = {
          text: section.text,
          source: block.source,
          isVisual: block.isVisual,
        };
        const subChunks = sentenceChunk([subBlock], maxChars, contextWindow);
        for (const sc of subChunks) {
          chunks.push({
            ...sc,
            context: prevChunkTail || undefined,
            index: chunks.length,
            charOffset: section.startOffset + sc.charOffset,
          });
          prevChunkTail = sc.text.slice(-contextWindow);
        }
        continue;
      }

      // Would adding this section overflow?
      if (accumulatedChars + section.text.length + 1 > maxChars && accumulated.length > 0) {
        const text = accumulated.map((s) => s.text).join('\n');
        chunks.push({
          text,
          context: prevChunkTail || undefined,
          index: chunks.length,
          charOffset: accumulated[0].startOffset,
          source: block.source,
        });
        prevChunkTail = text.slice(-contextWindow);
        accumulated = [];
        accumulatedChars = 0;
      }

      accumulated.push(section);
      accumulatedChars += section.text.length + 1;
    }

    // Flush remaining
    if (accumulated.length > 0) {
      const text = accumulated.map((s) => s.text).join('\n');
      chunks.push({
        text,
        context: prevChunkTail || undefined,
        index: chunks.length,
        charOffset: accumulated[0].startOffset,
        source: block.source,
      });
      prevChunkTail = text.slice(-contextWindow);
    }
  }

  for (const chunk of chunks) {
    chunk.total = chunks.length;
  }

  return chunks;
}
