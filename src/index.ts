/**
 * munchr — Any document + schema in, streamed structured JSON out.
 */

import type { ExtractConfig, NormalizeConfig } from './core/types.js';
import { Normalized, Extracted } from './core/chain.js';

// ---------------------------------------------------------------------------
// Public API: entry points
// ---------------------------------------------------------------------------

/**
 * Start a pipeline with normalization.
 * Returns a builder with .chunk() and .extract() methods.
 */
export function normalize(config?: NormalizeConfig): Normalized {
  return new Normalized(config ?? {});
}

/**
 * Start a pipeline with extraction directly (VLM mode or pre-extracted text).
 * Returns a builder with .merge(), .run(), and .stream() methods.
 */
export function extract<T>(config: ExtractConfig<T>): Extracted<T> {
  return new Extracted<T>(undefined, undefined, config);
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
  MergeConfig,
} from './core/types.js';

// Errors
export { MunchrError, NormalizeError, ChunkError, ExtractionError } from './core/errors.js';

// Chain classes
export { Normalized, Chunked, Extracted, Merged } from './core/chain.js';
