# munchr Type Reference

Quick lookup for type signatures. For behavioral guidance, see the main SKILL.md.

## Entry Points

```typescript
normalize(config?: NormalizeConfig): Normalized        // → .chunk(), .extract()
extract(config: ExtractMarkdownConfig): Extracted<string>  // markdown mode
extract<T>(config: ExtractSchemaConfig<T>): Extracted<T>   // schema mode
```

## Config Interfaces

```typescript
interface NormalizeConfig {
  type?: 'auto' | 'pdf' | 'image' | 'csv' | 'html' | 'xlsx' | 'docx' | 'email' | 'text' | 'markdown';
  ocr?: OcrBackend;
  sheets?: 'all' | 'first' | number[];    // XLSX only. Default: 'all'
  preserveTables?: boolean;                // HTML only. Default: true
  includeHeaders?: boolean;                // Email only. Default: true
}

interface ChunkConfig {
  strategy?: 'auto' | 'sentence' | 'structural' | 'row' | 'page' | 'sliding' | 'none'
    | ((blocks: TextBlock[]) => Chunk[]);   // Default: 'auto'
  maxChars?: number;                        // Default: 8000
  contextWindow?: number;                   // Default: 500
  overlap?: number;                         // 'sliding' only. Default: 200
}
```

### ExtractConfig (discriminated union)

```typescript
type OutputMode = 'schema' | 'markdown';

// Base fields shared by both modes
interface ExtractConfigBase {
  model: LanguageModel;
  prompt: string;
  visionModel?: LanguageModel;
  examples?: Array<{ input: string; output: unknown }>;
  passes?: number;                          // Default: 1
  concurrency?: number;                     // Default: 3
  onChunkError?: 'skip' | 'throw' | ((error: Error, chunk: Chunk) => void);  // Default: 'skip'
  systemPrompt?: string;
  generationOptions?: Record<string, unknown>;
}

// Schema mode: structured JSON output
interface ExtractSchemaConfig<T> extends ExtractConfigBase {
  output: 'schema';
  schema: StandardSchemaV1<unknown, T>;     // Valibot, Zod, ArkType, etc.
}

// Markdown mode: string output
interface ExtractMarkdownConfig extends ExtractConfigBase {
  output: 'markdown';
}

type ExtractConfig<T> = ExtractSchemaConfig<T> | ExtractMarkdownConfig;
```

### MergeConfig

```typescript
interface MergeConfig<T> {
  strategy?: 'concat' | 'first' | 'dedupe' | ((extractions: Extraction<T>[]) => T);  // Default: 'concat'
  dedupeKey?: (item: any) => string;
  dedupeWinner?: 'first' | 'last';         // Default: 'first'
}
```

Note: In markdown mode (`T = string`), the `'concat'` strategy joins strings with `\n\n---\n\n`.

## Data Types

```typescript
type InputData = Buffer | ReadableStream | Uint8Array | string;

interface TextBlock {
  text: string;
  source: { format: string; page?: number; sheet?: string; filename?: string };
  isVisual: boolean;
}

interface Chunk {
  text: string;
  context?: string;
  index: number;
  total?: number;
  charOffset: number;
  source: TextBlockSource;
}

interface Extraction<T> { data: T; chunk: Chunk; pass?: number }
```

## Pipeline Events

```typescript
type PipelineEvent<T> =
  | { phase: 'normalizing'; block: TextBlock }
  | { phase: 'chunking'; chunk: Chunk }
  | { phase: 'extracting'; extraction: Partial<T>; chunk: Chunk; done: boolean }
  | { phase: 'merging'; result: T }
  | { phase: 'error'; error: Error; chunk?: Chunk; source: string };
```

When `output: 'markdown'`, `T = string` and `extraction` is the accumulated markdown string so far.

## Errors

```typescript
MunchrError        → phase: 'normalize' | 'chunk' | 'extract' | 'merge'
NormalizeError     → format: string
ChunkError         → block: TextBlock
ExtractionError    → chunk: Chunk, cause: Error
```

## Backends

```typescript
// MinerU
import { mineruBackend } from 'munchr/backends';
mineruBackend({ url: string, tableEnable?: boolean, formulaEnable?: boolean })

// Custom
interface OcrBackend {
  parse(input: Buffer | ReadableStream, options?: OcrOptions): Promise<string>;
  name: string;
}
```
