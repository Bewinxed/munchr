import type { LanguageModel } from 'ai';
import type { StandardSchemaV1 } from '@standard-schema/spec';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type InputData = Buffer | ReadableStream | Uint8Array | string;

export type FormatType =
  | 'auto'
  | 'pdf'
  | 'image'
  | 'csv'
  | 'html'
  | 'xlsx'
  | 'docx'
  | 'email'
  | 'text'
  | 'markdown';

export interface InputOptions {
  /** Format hint. 'auto' detects from content/magic bytes. */
  type?: FormatType;
  /** Original filename (helps format detection). */
  filename?: string;
  /** MIME type (helps format detection). */
  mimeType?: string;
}

// ---------------------------------------------------------------------------
// TextBlock — output of normalize()
// ---------------------------------------------------------------------------

export interface TextBlockSource {
  format: Exclude<FormatType, 'auto'>;
  page?: number;
  sheet?: string;
  filename?: string;
}

export interface TextBlock {
  /** The normalized text content (plain text or markdown). */
  text: string;
  /** Provenance metadata. */
  source: TextBlockSource;
  /** True if text was produced by OCR/VLM (lossy conversion from visual). */
  isVisual: boolean;
}

// ---------------------------------------------------------------------------
// Chunk — output of chunk()
// ---------------------------------------------------------------------------

export interface Chunk {
  /** The chunk text to send to the LLM. */
  text: string;
  /** Trailing text from previous chunk, prepended for coreference resolution. */
  context?: string;
  /** Chunk index in sequence. */
  index: number;
  /** Total chunks (known after chunking completes). */
  total?: number;
  /** Character offset of this chunk's start in the original TextBlock text. */
  charOffset: number;
  /** Which TextBlock this came from. */
  source: TextBlockSource;
}

// ---------------------------------------------------------------------------
// Extraction — output of extract()
// ---------------------------------------------------------------------------

export interface Extraction<T> {
  /** The extracted data matching the schema. */
  data: T;
  /** Which chunk this extraction came from. */
  chunk: Chunk;
  /** Which pass produced this extraction (for multi-pass). */
  pass?: number;
}

// ---------------------------------------------------------------------------
// Pipeline events (streaming)
// ---------------------------------------------------------------------------

export type PipelineEvent<T> =
  | { phase: 'normalizing'; block: TextBlock }
  | { phase: 'chunking'; chunk: Chunk }
  | { phase: 'extracting'; extraction: Partial<T>; chunk: Chunk; done: boolean }
  | { phase: 'merging'; result: T }
  | { phase: 'error'; error: Error; chunk?: Chunk; source: string };

// ---------------------------------------------------------------------------
// OCR Backend
// ---------------------------------------------------------------------------

export interface OcrOptions {
  /** Original filename (helps some backends). */
  filename?: string;
  /** MIME type. */
  mimeType?: string;
  /** Which pages to extract (for multi-page PDFs). */
  pages?: number[] | 'all';
}

export interface OcrBackend {
  /** Convert a visual document to text. */
  parse(input: Buffer | ReadableStream, options?: OcrOptions): Promise<string>;
  /** Human-readable name for logging. */
  name: string;
}

// ---------------------------------------------------------------------------
// Config interfaces
// ---------------------------------------------------------------------------

export type ChunkStrategy =
  | 'auto'
  | 'sentence'
  | 'structural'
  | 'row'
  | 'page'
  | 'sliding'
  | 'none';

export interface NormalizeConfig {
  /** Override auto-detection. */
  type?: FormatType;
  /** OCR backend for scanned PDFs and images. */
  ocr?: OcrBackend;
  /** For XLSX: which sheets to include. Default: 'all'. */
  sheets?: 'all' | 'first' | number[];
  /** For HTML: preserve table structure as markdown tables. Default: true. */
  preserveTables?: boolean;
  /** For email: include headers (From, To, Subject, Date). Default: true. */
  includeHeaders?: boolean;
}

export interface ChunkConfig {
  /** Chunking strategy. Default: 'auto'. */
  strategy?: ChunkStrategy | ((blocks: TextBlock[]) => Chunk[]);
  /** Max characters per chunk. Default: 8000. */
  maxChars?: number;
  /** Characters from previous chunk to prepend as context. Default: 500. */
  contextWindow?: number;
  /** For sliding strategy: overlap in characters. Default: 200. */
  overlap?: number;
}

export interface ExtractConfig<T = unknown> {
  /** AI SDK model for text-based extraction. */
  model: LanguageModel;
  /** The output schema. Any Standard Schema-compatible library (Valibot, Zod, ArkType, etc.). */
  schema: StandardSchemaV1<unknown, T>;
  /** Extraction instructions / prompt. */
  prompt: string;
  /** Vision-capable model for end-to-end VLM extraction. */
  visionModel?: LanguageModel;
  /** Few-shot examples to include in the prompt. */
  examples?: Array<{
    input: string;
    output: unknown;
  }>;
  /** Number of extraction passes. Default: 1. */
  passes?: number;
  /** Max chunks to process in parallel. Default: 3. */
  concurrency?: number;
  /** How to handle per-chunk extraction errors. Default: 'skip'. */
  onChunkError?: 'skip' | 'throw' | ((error: Error, chunk: Chunk) => void);
  /** System prompt prepended to all extraction calls. */
  systemPrompt?: string;
  /** AI SDK generation options (temperature, maxTokens, etc.). */
  generationOptions?: Record<string, unknown>;
}

export interface MergeConfig<T> {
  /** Merge strategy. Default: 'concat'. */
  strategy?: 'concat' | 'first' | 'dedupe' | ((extractions: Extraction<T>[]) => T);
  /** For 'dedupe': function to produce a dedup key for array items. */
  dedupeKey?: (item: any) => string;
  /** For 'dedupe': which extraction wins on collision. Default: 'first'. */
  dedupeWinner?: 'first' | 'last';
}

// ---------------------------------------------------------------------------
// Internal: step descriptor for the chain
// ---------------------------------------------------------------------------

export type StepType = 'normalize' | 'chunk' | 'extract' | 'merge';

export interface StepDescriptor {
  type: StepType;
  config: unknown;
}
