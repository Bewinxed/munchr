/**
 * Table-row-aware chunking.
 * Splits markdown text at table row boundaries, never mid-row.
 * Prepends table headers to each chunk.
 */

import type { Chunk, TextBlock } from '../core/types.js';

function isTableRow(line: string): boolean {
  return line.trimStart().startsWith('|');
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

export function rowChunk(blocks: TextBlock[], maxChars: number, contextWindow: number): Chunk[] {
  const chunks: Chunk[] = [];
  let prevChunkTail = '';

  for (const block of blocks) {
    const lines = block.text.split('\n');
    let headerLines: string[] = [];
    let currentLines: string[] = [];
    let currentChars = 0;
    let charOffset = 0;
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLen = line.length + 1; // +1 for newline

      if (isTableRow(line)) {
        if (!inTable) {
          inTable = true;
          headerLines = [];
        }

        // Capture table header and separator rows
        if (headerLines.length === 0 || (headerLines.length === 1 && isSeparatorRow(line))) {
          headerLines.push(line);
          currentLines.push(line);
          currentChars += lineLen;
          continue;
        }

        // Check if adding this row would exceed maxChars
        if (currentChars + lineLen > maxChars && currentLines.length > 0) {
          // Flush current chunk
          chunks.push({
            text: currentLines.join('\n'),
            context: prevChunkTail || undefined,
            index: chunks.length,
            charOffset,
            source: block.source,
          });

          prevChunkTail = currentLines.join('\n').slice(-contextWindow);
          charOffset += currentChars;

          // Start new chunk with table headers prepended
          currentLines = [...headerLines];
          currentChars = headerLines.reduce((sum, h) => sum + h.length + 1, 0);
        }

        currentLines.push(line);
        currentChars += lineLen;
      } else {
        if (inTable) {
          inTable = false;
          headerLines = [];
        }

        // Non-table line — check size limit
        if (currentChars + lineLen > maxChars && currentLines.length > 0) {
          chunks.push({
            text: currentLines.join('\n'),
            context: prevChunkTail || undefined,
            index: chunks.length,
            charOffset,
            source: block.source,
          });

          prevChunkTail = currentLines.join('\n').slice(-contextWindow);
          charOffset += currentChars;
          currentLines = [];
          currentChars = 0;
        }

        currentLines.push(line);
        currentChars += lineLen;
      }
    }

    // Flush remaining
    if (currentLines.length > 0) {
      chunks.push({
        text: currentLines.join('\n'),
        context: prevChunkTail || undefined,
        index: chunks.length,
        charOffset,
        source: block.source,
      });
      prevChunkTail = currentLines.join('\n').slice(-contextWindow);
    }
  }

  for (const chunk of chunks) {
    chunk.total = chunks.length;
  }

  return chunks;
}
