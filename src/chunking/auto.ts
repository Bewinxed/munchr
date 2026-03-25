/**
 * Auto-strategy selection for chunking.
 * Examines text content to pick the best strategy.
 */

import type { Chunk, ChunkConfig, TextBlock } from '../core/types.js';
import { rowChunk } from './row.js';
import { sentenceChunk } from './sentence.js';
import { structuralChunk } from './structural.js';
import { blocksToChunks } from './passthrough.js';

const TABLE_LINE_RE = /^\|.+\|$/m;
const HEADING_RE = /^#{1,6}\s/m;

function detectStrategy(blocks: TextBlock[]): 'row' | 'structural' | 'page' | 'sentence' | 'none' {
  const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);

  // If everything fits in default maxChars, no splitting needed
  if (totalChars <= 8000) return 'none';

  // Check the combined text for patterns
  const sampleText = blocks
    .map((b) => b.text)
    .join('\n')
    .slice(0, 10000);

  // Markdown tables or CSV-like content
  if (TABLE_LINE_RE.test(sampleText)) return 'row';

  // Heading structure
  if (HEADING_RE.test(sampleText)) return 'structural';

  // Multi-page PDF with page-level blocks
  if (blocks.length > 1 && blocks.every((b) => b.source.page != null)) return 'page';

  // Default to sentence
  return 'sentence';
}

/**
 * Auto-chunk: selects the best strategy based on content analysis.
 */
export function autoChunk(blocks: TextBlock[], config: ChunkConfig): Chunk[] {
  const maxChars = config.maxChars ?? 8000;
  const contextWindow = config.contextWindow ?? 500;

  const strategy = detectStrategy(blocks);

  switch (strategy) {
    case 'none':
      return blocksToChunks(blocks);
    case 'row':
      return rowChunk(blocks, maxChars, contextWindow);
    case 'structural':
      return structuralChunk(blocks, maxChars, contextWindow);
    case 'page':
      return blocksToChunks(blocks);
    case 'sentence':
      return sentenceChunk(blocks, maxChars, contextWindow);
    default:
      return sentenceChunk(blocks, maxChars, contextWindow);
  }
}
