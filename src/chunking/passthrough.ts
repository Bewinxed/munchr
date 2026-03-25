import type { Chunk, TextBlock } from '../core/types.js';

/**
 * Convert an array of TextBlocks into Chunks with a 1:1 mapping.
 * Each block becomes one chunk; total is set on all chunks after mapping.
 */
export function blocksToChunks(blocks: TextBlock[]): Chunk[] {
  const chunks: Chunk[] = blocks.map((block, i) => ({
    text: block.text,
    index: i,
    charOffset: 0,
    source: block.source,
  }));
  for (const c of chunks) c.total = chunks.length;
  return chunks;
}
