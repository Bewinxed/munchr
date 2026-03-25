import { simpleParser } from 'mailparser';
import type { NormalizeConfig, TextBlock, TextBlockSource } from '../core/types.js';

/**
 * Normalize an .eml email buffer to a text block.
 */
export async function normalizeEmail(
  input: Buffer | string,
  source: TextBlockSource,
  config?: Pick<NormalizeConfig, 'includeHeaders'>,
): Promise<TextBlock> {
  const parsed = await simpleParser(input);
  const includeHeaders = config?.includeHeaders ?? true;

  const parts: string[] = [];

  if (includeHeaders) {
    if (parsed.from?.text) parts.push(`From: ${parsed.from.text}`);
    if (parsed.to) {
      const to = Array.isArray(parsed.to)
        ? parsed.to.map((t) => t.text).join(', ')
        : parsed.to.text;
      parts.push(`To: ${to}`);
    }
    if (parsed.subject) parts.push(`Subject: ${parsed.subject}`);
    if (parsed.date) parts.push(`Date: ${parsed.date.toISOString()}`);
    parts.push('');
  }

  parts.push(parsed.text || '');

  return {
    text: parts.join('\n'),
    source: { ...source, format: 'email' },
    isVisual: false,
  };
}
