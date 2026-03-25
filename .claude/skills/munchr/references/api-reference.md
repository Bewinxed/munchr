# munchr Type Reference

Quick lookup for type signatures. For behavioral guidance, see the main SKILL.md.

## Entry Points

```typescript
normalize(config?: NormalizeConfig): Normalized        // → .chunk(), .extract()
extract<T>(config: ExtractConfig<T>): Extracted<T>     // → .merge(), .run(), .stream()
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

interface ExtractConfig<T> {
  model: LanguageModel;
  schema: StandardSchemaV1<unknown, T>;
  prompt: string;
  visionModel?: LanguageModel;
  examples?: Array<{ input: string; output: unknown }>;
  passes?: number;                          // Default: 1
  concurrency?: number;                     // Default: 3
  onChunkError?: 'skip' | 'throw' | ((error: Error, chunk: Chunk) => void);  // Default: 'skip'
  systemPrompt?: string;
  generationOptions?: Record<string, unknown>;
}

interface MergeConfig<T> {
  strategy?: 'concat' | 'first' | 'dedupe' | ((extractions: Extraction<T>[]) => T);  // Default: 'concat'
  dedupeKey?: (item: any) => string;
  dedupeWinner?: 'first' | 'last';         // Default: 'first'
}
```

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

## Standalone Steps

```typescript
import { normalizeStep, chunkStep, extractStep, mergeStep } from 'munchr/steps';

normalizeStep(input, options?, config)     // async generator → TextBlock
chunkStep(blocks, config)                  // sync → Chunk[]
extractStep(chunks, config)                // async generator → PipelineEvent<T>
mergeStep(extractions, config)             // sync → T
```
