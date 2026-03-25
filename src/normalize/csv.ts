import Papa from 'papaparse';
import type { TextBlock, TextBlockSource } from '../core/types.js';

/**
 * Normalize CSV/TSV text into a TextBlock.
 * Uses papaparse for robust parsing (handles quoted fields, escaping, BOM).
 * Outputs as a markdown table for better LLM comprehension.
 */
export function normalizeCsv(text: string, source: TextBlockSource): TextBlock {
  const result = Papa.parse(text, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const rows = result.data as string[][];
  if (rows.length === 0) {
    return { text: '', source: { ...source, format: 'csv' }, isVisual: false };
  }

  // Format as markdown table
  const header = rows[0];
  const lines: string[] = [];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + header.map(() => '---').join(' | ') + ' |');

  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + rows[i].join(' | ') + ' |');
  }

  return {
    text: lines.join('\n'),
    source: { ...source, format: 'csv' },
    isVisual: false,
  };
}
