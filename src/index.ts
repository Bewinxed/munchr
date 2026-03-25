/**
 * munchr — Any document + schema in, streamed structured JSON or markdown out.
 *
 * Every function serves double duty:
 * - normalize(config) → builder with .run() (standalone) AND .chunk()/.extract() (chain)
 * - chunk(blocks, config) → Chunk[] (standalone, sync)
 * - extract(config) → builder with .run()/.stream() (standalone) AND .merge() (chain)
 *   - output: 'schema' → structured JSON via streamObject()
 *   - output: 'markdown' → markdown string via streamText()
 * - merge(extractions, config) → T (standalone, sync)
 */

import type {
  Chunk,
  ChunkConfig,
  Extraction,
  ExtractConfig,
  ExtractMarkdownConfig,
  ExtractSchemaConfig,
  MergeConfig,
  NormalizeConfig,
  TextBlock,
} from './core/types.js';
import { Normalized, Extracted } from './chain.js';
import { chunkStep } from './steps/chunk.js';
import { mergeStep } from './steps/merge.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize any document into TextBlocks.
 *
 * Standalone: `await normalize({ ocr }).run(pdfBuffer)` → TextBlock[]
 * Chain: `normalize({ ocr }).chunk(...).extract(...).run(pdfBuffer)` → T
 */
export function normalize(config?: NormalizeConfig): Normalized {
  return new Normalized(config ?? {});
}

/**
 * Chunk TextBlocks into sized pieces for LLM extraction.
 * Sync function — works standalone.
 *
 * `chunk(blocks, { strategy: 'row', maxChars: 8000 })` → Chunk[]
 */
export function chunk(blocks: TextBlock[], config?: ChunkConfig): Chunk[] {
  return chunkStep(blocks, config ?? {});
}

/**
 * Extract structured data or markdown from chunks or images.
 *
 * Schema mode: `await extract({ output: 'schema', model, schema, prompt }).run(input)` → T
 * Markdown mode: `await extract({ output: 'markdown', model, prompt }).run(input)` → string
 * VLM mode: `await extract({ output: 'schema', visionModel, schema, prompt }).run(imageBuffer)` → T
 */
export function extract(config: ExtractMarkdownConfig): Extracted<string>;
export function extract<T>(config: ExtractSchemaConfig<T>): Extracted<T>;
export function extract<T>(config: ExtractConfig<T>): Extracted<T> {
  return new Extracted<T>(undefined, undefined, config);
}

/**
 * Merge extractions from multiple chunks into a single result.
 * Sync function — works standalone.
 *
 * `merge(extractions, { strategy: 'dedupe', dedupeKey: ... })` → T
 */
export function merge<T>(extractions: Extraction<T>[], config?: MergeConfig<T>): T {
  return mergeStep(extractions, config ?? {});
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

// Core types
export type {
  InputData,
  InputOptions,
  FormatType,
  TextBlock,
  TextBlockSource,
  Chunk,
  Extraction,
  PipelineEvent,
  OcrBackend,
  OcrOptions,
  NormalizeConfig,
  ChunkConfig,
  ChunkStrategy,
  ExtractConfig,
  ExtractSchemaConfig,
  ExtractMarkdownConfig,
  OutputMode,
  MergeConfig,
} from './core/types.js';

// Errors
export { MunchrError, NormalizeError, ChunkError, ExtractionError } from './core/errors.js';

// Chain classes
export { Normalized, Chunked, Extracted, Merged } from './chain.js';
