import mammoth from 'mammoth';
import type { TextBlock, TextBlockSource } from '../core/types.js';

// mammoth's type declarations omit convertToMarkdown, but it exists at runtime
const mammothWithMarkdown = mammoth as typeof mammoth & {
  convertToMarkdown: typeof mammoth.convertToHtml;
};

/**
 * Normalize a DOCX buffer to a text block using markdown conversion.
 * Preserves headings, bold, italic, lists, and document structure.
 */
export async function normalizeDocx(input: Buffer, source: TextBlockSource): Promise<TextBlock> {
  const result = await mammothWithMarkdown.convertToMarkdown({ buffer: input });

  return {
    text: result.value,
    source: { ...source, format: 'docx' },
    isVisual: false,
  };
}
