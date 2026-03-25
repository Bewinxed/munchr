/**
 * Sliding window chunking.
 * Fixed-size character windows with configurable overlap.
 */

import type { Chunk, TextBlock } from '../core/types.js';

export function slidingChunk(blocks: TextBlock[], maxChars: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = [];

  for (const block of blocks) {
    const text = block.text;
    let offset = 0;

    while (offset < text.length) {
      const end = Math.min(offset + maxChars, text.length);
      const chunkText = text.slice(offset, end);
      const context = offset > 0 ? text.slice(Math.max(0, offset - overlap), offset) : undefined;

      chunks.push({
        text: chunkText,
        context,
        index: chunks.length,
        charOffset: offset,
        source: block.source,
      });

      if (end >= text.length) break;
      offset = end - overlap;
    }
  }

  for (const chunk of chunks) {
    chunk.total = chunks.length;
  }

  return chunks;
}
