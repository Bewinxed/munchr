/**
 * Prompt builder — ported from LangExtract's QAPromptGenerator and ContextAwarePromptBuilder.
 *
 * Assembles extraction prompts per-chunk with:
 * - System prompt
 * - User's extraction instructions
 * - Few-shot examples (Q:/A: format)
 * - Context window from previous chunk (per-document tracking)
 * - Chunk text
 */

import type { Chunk, ExtractConfig } from '../core/types.js';

/**
 * Tracks per-document previous chunk text for context injection.
 * Ported from LangExtract's ContextAwarePromptBuilder._prev_chunk_by_doc_id.
 */
export class PromptBuilder {
  private prevChunkByDoc = new Map<string, string>();
  private contextWindowChars: number;

  constructor(contextWindowChars = 500) {
    this.contextWindowChars = contextWindowChars;
  }

  /**
   * Build the extraction prompt for a chunk.
   */
  build<T>(chunk: Chunk, config: ExtractConfig<T>): string {
    const parts: string[] = [];

    // 1. User's extraction instructions
    parts.push(config.prompt);

    // 2. Few-shot examples (Q:/A: format from LangExtract)
    if (config.examples && config.examples.length > 0) {
      parts.push('');
      parts.push('Examples:');
      for (const example of config.examples) {
        parts.push(`Q: ${example.input}`);
        parts.push(`A: ${JSON.stringify(example.output)}`);
        parts.push('');
      }
    }

    // 3. Context window from previous chunk (per-document)
    const docKey = this.getDocKey(chunk);
    const prevText = this.prevChunkByDoc.get(docKey);
    if (prevText) {
      const contextSlice = prevText.slice(-this.contextWindowChars);
      parts.push('');
      parts.push(`[Previous context]: ${contextSlice}`);
    }

    // 4. Chunk text
    parts.push('');
    parts.push(`[Document]: ${chunk.text}`);

    // 5. Extraction instruction
    parts.push('');
    parts.push('Extract the data according to the schema.');

    // Update previous chunk for this document
    this.prevChunkByDoc.set(docKey, chunk.text);

    return parts.join('\n');
  }

  /**
   * Get the system prompt for extraction calls.
   */
  getSystemPrompt<T>(config: ExtractConfig<T>): string | undefined {
    return config.systemPrompt;
  }

  private getDocKey(chunk: Chunk): string {
    return `${chunk.source.format}:${chunk.source.filename ?? 'unknown'}:${chunk.source.sheet ?? ''}`;
  }

  /**
   * Reset context tracking (between documents or passes).
   */
  reset(): void {
    this.prevChunkByDoc.clear();
  }
}
