import { convert } from 'html-to-text';
import type { TextBlock, TextBlockSource } from '../core/types.js';

/**
 * Normalize HTML to plain text, optionally preserving tables as markdown.
 */
export function normalizeHtml(
  html: string,
  source: TextBlockSource,
  preserveTables = true,
): TextBlock {
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      ...(preserveTables
        ? [
            {
              selector: 'table',
              format: 'dataTable' as const,
              options: { uppercaseHeaderCells: false },
            },
          ]
        : []),
    ],
  });

  return {
    text,
    source: { ...source, format: 'html' },
    isVisual: false,
  };
}
