import mammoth from 'mammoth';
import type { TextBlock, TextBlockSource } from '../core/types.js';

/**
 * Normalize a DOCX buffer to a text block.
 */
export async function normalizeDocx(input: Buffer, source: TextBlockSource): Promise<TextBlock> {
  const result = await mammoth.extractRawText({ buffer: input });

  return {
    text: result.value,
    source: { ...source, format: 'docx' },
    isVisual: false,
  };
}
