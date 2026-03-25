import type { Chunk, ChunkConfig, TextBlock } from '../core/types.js';
import { autoChunk } from '../chunking/auto.js';
import { sentenceChunk } from '../chunking/sentence.js';
import { rowChunk } from '../chunking/row.js';
import { structuralChunk } from '../chunking/structural.js';
import { slidingChunk } from '../chunking/sliding.js';

/**
 * Chunk step: splits TextBlock[] into Chunk[].
 * Pure synchronous function.
 */
export function chunkStep(blocks: TextBlock[], config: ChunkConfig): Chunk[] {
  const maxChars = config.maxChars ?? 8000;
  const contextWindow = config.contextWindow ?? 500;
  const overlap = config.overlap ?? 200;
  const strategy = config.strategy ?? 'auto';

  // Custom function strategy
  if (typeof strategy === 'function') {
    return strategy(blocks);
  }

  switch (strategy) {
    case 'auto':
      return autoChunk(blocks, config);

    case 'sentence':
      return sentenceChunk(blocks, maxChars, contextWindow);

    case 'row':
      return rowChunk(blocks, maxChars, contextWindow);

    case 'structural':
      return structuralChunk(blocks, maxChars, contextWindow);

    case 'sliding':
      return slidingChunk(blocks, maxChars, overlap);

    case 'page': {
      const chunks: Chunk[] = blocks.map((block, i) => ({
        text: block.text,
        index: i,
        charOffset: 0,
        source: block.source,
      }));
      for (const c of chunks) c.total = chunks.length;
      return chunks;
    }

    case 'none': {
      const chunks: Chunk[] = blocks.map((block, i) => ({
        text: block.text,
        index: i,
        charOffset: 0,
        source: block.source,
      }));
      for (const c of chunks) c.total = chunks.length;
      return chunks;
    }

    default:
      return autoChunk(blocks, config);
  }
}
