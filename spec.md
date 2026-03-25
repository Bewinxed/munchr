# munchr — Spec

**Any document + schema in, streamed structured JSON out.**

A composable, TypeScript-native document extraction library built on the Vercel AI SDK. Feed it any file format — PDFs, images, CSVs, HTML, XLSX, emails, plain text — along with a Valibot/Zod schema and a prompt, and get back progressively-streamed structured data.

> npm name `munchr` is confirmed available (checked 2026-03-25).

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [The Pipeline API — Fluent Thenable Chain](#4-the-pipeline-api--fluent-thenable-chain)
5. [Step 1: normalize()](#5-step-1-normalize)
6. [Step 2: chunk()](#6-step-2-chunk)
7. [Step 3: extract()](#7-step-3-extract)
8. [Step 4: merge()](#8-step-4-merge)
9. [Streaming Model](#9-streaming-model)
10. [OCR & VLM Backends](#10-ocr--vlm-backends)
11. [Chunking Strategies](#11-chunking-strategies)
12. [Error Handling](#12-error-handling)
13. [Package Structure](#13-package-structure)
14. [Dependencies](#14-dependencies)
15. [Reference Implementations](#15-reference-implementations)
16. [Non-Goals](#16-non-goals)
17. [Example Pipelines](#17-example-pipelines)

---

## 1. Problem Statement

There is no TypeScript library that:

- Accepts **any document format** (not just PDF/images)
- Lets you define a **schema per request** (not pre-registered)
- **Streams partial structured JSON** as it extracts (not batch)
- Supports both **pipeline OCR** (MinerU/Mistral OCR → text → LLM) and **end-to-end VLM** (image → structured JSON directly)
- Is a **library**, not a platform or service

Closest existing tools and their gaps:

- **Google LangExtract** (Python) — text-only, no streaming, no multi-format input
- **OCRBase** (TypeScript) — PDF/image only, pre-registered schemas, WebSocket progress not partial JSON streaming
- **Docling** (Python) — multi-format but outputs markdown, no structured extraction or streaming
- **LlamaParse** (Python, cloud) — 130+ formats but proprietary, no streaming, no inline schemas
- **Sparrow** (Python, GPL) — JSON schema extraction but no streaming, Python-only

munchr fills this gap.

---

## 2. Design Principles

1. **Fluent thenable chains.** Each step returns a builder with the valid next steps as methods. The chain is `await`-able (thenable protocol) and `for await`-able (async iterable protocol). No `pipe()` wrapper — just method chaining.

2. **AsyncGenerator all the way down.** Every step internally consumes and produces async iterables. Streaming is not an afterthought — it's the primitive. Backpressure is free.

3. **Schema is the contract.** The user's Valibot/Zod/JSON Schema types the pipeline's output end-to-end. TypeScript infers the output type from the schema.

4. **AI SDK native.** Extraction uses `streamObject()` / `generateObject()` from the Vercel AI SDK. Any AI SDK-compatible provider works out of the box — OpenAI, Anthropic, Google, OpenRouter, or self-hosted via vLLM's OpenAI-compatible API.

5. **No opinions on infrastructure.** No built-in queues, storage, or database. This is a function: bytes in, structured data out.

6. **Fail per-chunk, not per-document.** One bad chunk in a 50-page statement must not kill the entire extraction. Errors are reported, not thrown (configurable).

---

## 3. Architecture Overview

```
                    +-- PDF (scanned) ---> [OCR backend] --> markdown --+
                    |-- PDF (text) ------> [pdf-parse] --> text -------+
                    |-- Image -----------> [VLM end-to-end] ---------->|---> streamed JSON
Input --> detect -> |-- CSV -------------> text (trivial) -------------+          ^
                    |-- HTML ------------> text (strip tags) ----------+          |
                    |-- XLSX ------------> text (sheets -> CSV) -------+    [AI SDK
                    |-- DOCX ------------> text (extract) -------------+     streamObject()
                    |-- Email (.eml) ----> text (body + headers) ------+     + schema]
                    |-- Plain text ------> pass through ---------------+
                    +-- Markdown --------> pass through ---------------+
                                  |                              |
                            normalize()                     chunk() --> extract() --> merge()
```

Two execution paths:

- **Pipeline mode**: `normalize().chunk().extract().merge()` — OCR happens in normalize. LLM extraction happens in extract. Streaming kicks in at the extract step.
- **End-to-end VLM mode**: `extract({ visionModel })` — The image/PDF goes directly to a vision-capable LLM with the schema. The entire thing streams. normalize and chunk are skipped.

The library auto-selects the path based on input type and provided backends, but the user can force either.

---

## 4. The Pipeline API — Fluent Thenable Chain

### Core Concept

Every step returns a builder object that:

1. Has **methods for the next valid steps** in the pipeline (typed state machine).
2. Implements **`.then()`** — making it `await`-able (JS thenable protocol).
3. Implements **`[Symbol.asyncIterator]`** — making it `for await`-able for streaming.

Nothing executes until you `await` or iterate. The chain is lazy — it builds a pipeline description, then runs it on demand.

### The chain

```typescript
import { normalize, extract } from 'munchr';

// Fluent chain — each step returns the next valid steps as methods
const result = await normalize({ ocr })
  .chunk({ strategy: 'row', maxChars: 8000 })
  .extract({ model, schema, prompt })
  .merge({ strategy: 'concat' });

// Also streamable — for await triggers execution with events
for await (const event of normalize({ ocr }).extract({ model, schema, prompt })) {
  // event: PipelineEvent<T>
}

// extract() alone is a valid entry point (for VLM mode or pre-extracted text)
const result = await extract({ visionModel, schema, prompt }).run(imageBuffer);
```

### Step chaining rules (type-level state machine)

```
normalize(config?)        → Normalized    — has .chunk(), .extract()
  .chunk(config?)         → Chunked       — has .extract()
    .extract(config)      → Extracted<T>  — has .merge(), .then(), [Symbol.asyncIterator]
      .merge(config?)     → Merged<T>     — has .then(), [Symbol.asyncIterator]

extract(config)           → Extracted<T>  — entry point for VLM or text-only mode
```

Steps that don't make sense are not available:

- Can't `.merge()` before `.extract()` — no data to merge.
- Can't `.chunk()` after `.extract()` — extraction already happened.
- Can't `.normalize()` after `.chunk()` — text is already normalized.
- `.chunk()` and `.merge()` are optional — the pipeline works without them.

### Input binding

Input is bound via `.run()` or by passing to the async iterator:

```typescript
const pipeline = normalize({ ocr })
  .chunk({ strategy: 'auto' })
  .extract({ model, schema, prompt });

// Option A: .run() for awaited result
const result = await pipeline.run(pdfBuffer);
const result = await pipeline.run(pdfBuffer, { type: 'pdf', filename: 'invoice.pdf' });

// Option B: for await with .stream() for events
for await (const event of pipeline.stream(pdfBuffer)) { ... }

// Option C: direct await (uses .then() thenable protocol)
// Requires input to have been bound earlier or passed to a factory
```

### Input options

```typescript
interface InputOptions {
  /** Format hint. 'auto' detects from content/magic bytes. */
  type?:
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

  /** Original filename (helps format detection). */
  filename?: string;

  /** MIME type (helps format detection). */
  mimeType?: string;
}

// Input data can be:
type InputData = Buffer | ReadableStream | Uint8Array | string;
```

### Type safety

The pipeline's output type is inferred from the schema passed to `extract()`:

```typescript
const schema = v.object({ vendor: v.string(), total: v.number() });

// result is typed as { vendor: string; total: number }
const result = await normalize().extract({ model, schema, prompt: '...' }).run(pdfBuffer);
```

### Reusable pipelines

Chains are immutable descriptions — they can be stored and reused:

```typescript
// Define once
const receiptPipeline = normalize({ ocr: mineruBackend({ url: 'http://localhost:8888' }) })
  .extract({
    model: openai('gpt-4o-mini'),
    schema: ReceiptSchema,
    prompt: 'Extract receipt details.',
  });

// Reuse many times
const receipt1 = await receiptPipeline.run(pdf1);
const receipt2 = await receiptPipeline.run(pdf2);

// Stream one
for await (const event of receiptPipeline.stream(pdf3)) { ... }
```

### How the thenable works internally

```typescript
// Simplified internal implementation sketch

class Extracted<T> {
  private steps: StepDescriptor[];

  // Makes it awaitable: `await pipeline` or `await pipeline.run(input)`
  then<TResult>(
    resolve?: (value: T) => TResult | PromiseLike<TResult>,
    reject?: (reason: any) => TResult | PromiseLike<TResult>,
  ): Promise<TResult> {
    return this.run(this.boundInput).then(resolve, reject);
  }

  // Makes it for-await-able: `for await (const event of pipeline.stream(input))`
  stream(input: InputData, options?: InputOptions): AsyncIterable<PipelineEvent<T>> {
    return this.execute(input, options);
  }

  // Explicit run
  async run(input: InputData, options?: InputOptions): Promise<T> {
    let result: T;
    for await (const event of this.execute(input, options)) {
      if (event.phase === 'done') result = event.data;
    }
    return result!;
  }

  // Chain to next step
  merge(config?: MergeConfig<T>): Merged<T> {
    return new Merged([...this.steps, { type: 'merge', config }]);
  }

  // Internal: run the full pipeline as an async generator
  private async *execute(input, options): AsyncGenerator<PipelineEvent<T>> {
    let stream: AsyncIterable<any> = toAsyncIterable(input, options);
    for (const step of this.steps) {
      stream = step.transform(stream);
    }
    yield* stream;
  }
}
```

The key insight: each builder class (`Normalized`, `Chunked`, `Extracted<T>`, `Merged<T>`) stores the step descriptors and only has methods for valid next steps. TypeScript's type system enforces the ordering at compile time.

---

## 5. Step 1: `normalize()`

Converts any supported input format into `TextBlock[]` — a uniform text representation that downstream steps consume.

### Config

```typescript
interface NormalizeConfig {
  /** Override auto-detection. */
  type?: PipelineInput['type'];

  /** OCR backend for scanned PDFs and images. If omitted, visual inputs will error. */
  ocr?: OcrBackend;

  /** For XLSX: which sheets to include. Default: 'all'. */
  sheets?: 'all' | 'first' | number[];

  /** For HTML: preserve table structure as markdown tables. Default: true. */
  preserveTables?: boolean;

  /** For email: include headers (From, To, Subject, Date). Default: true. */
  includeHeaders?: boolean;
}
```

### Output type

```typescript
interface TextBlock {
  /** The normalized text content (plain text or markdown). */
  text: string;

  /** Provenance metadata. */
  source: {
    format: 'pdf' | 'image' | 'csv' | 'html' | 'xlsx' | 'docx' | 'email' | 'text' | 'markdown';
    page?: number; // For multi-page PDFs
    sheet?: string; // For XLSX
    filename?: string;
  };

  /** True if text was produced by OCR/VLM (lossy conversion from visual). */
  isVisual: boolean;
}
```

### Format handlers

Each format has a dedicated normalizer. These are **thin wrappers** around existing libraries — munchr does not reimplement parsers.

| Format           | How it normalizes                              | Library                                 |
| ---------------- | ---------------------------------------------- | --------------------------------------- |
| Plain text       | Pass through                                   | None                                    |
| Markdown         | Pass through                                   | None                                    |
| CSV              | Format as-is or as markdown table              | Built-in (no dep needed for simple CSV) |
| HTML             | Strip tags, preserve tables as markdown        | `html-to-text`                          |
| XLSX             | Read cells, output as CSV/table text per sheet | `exceljs` (peer dep)                    |
| DOCX             | Extract text with basic structure              | `mammoth` (peer dep)                    |
| Email (.eml)     | Parse headers + text body                      | `mailparser` (peer dep)                 |
| PDF (text-based) | Extract embedded text                          | `pdf-parse` or `unpdf`                  |
| PDF (scanned)    | Delegate to OCR backend                        | Configured `OcrBackend`                 |
| Image            | Delegate to OCR backend                        | Configured `OcrBackend`                 |

XLSX, DOCX, and email parsers are **peer dependencies** — only required if you use those formats. The core package has no hard dependency on them.

### Format detection

Auto-detection order:

1. Explicit `type` option (highest priority)
2. `mimeType` if provided
3. `filename` extension
4. Magic bytes / content sniffing (PDF `%PDF-`, PNG header, etc.)

For PDFs, detect whether it's text-based or scanned:

- Try extracting text. If result is empty or mostly whitespace → scanned → route to OCR.
- If text is extracted successfully → text-based → use extracted text directly.

---

## 6. Step 2: `chunk()`

Splits `TextBlock[]` into `Chunk[]` for LLM extraction. Handles the case where a document's text exceeds the LLM's effective context window.

### Config

```typescript
interface ChunkConfig {
  /** Chunking strategy. Default: 'auto'. */
  strategy:
    | 'auto'
    | 'sentence'
    | 'structural'
    | 'row'
    | 'page'
    | 'sliding'
    | 'none'
    | ((blocks: TextBlock[]) => Chunk[]);

  /** Max characters per chunk. Default: 8000. */
  maxChars?: number;

  /** Characters from previous chunk to prepend as context. Default: 500. */
  contextWindow?: number;

  /** For sliding strategy: overlap in characters. Default: 200. */
  overlap?: number;
}
```

### Output type

```typescript
interface Chunk {
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
  source: TextBlock['source'];
}
```

### `'auto'` strategy logic

- If input contains markdown tables or CSV → `'row'`
- If input has clear heading structure (# lines) → `'structural'`
- If input is multi-page PDF and each page is independent → `'page'`
- If input is prose text → `'sentence'`
- If entire text fits within `maxChars` → `'none'` (pass through)

### Chunking strategy details

See [Section 11: Chunking Strategies](#11-chunking-strategies) for implementation details on each strategy.

---

## 7. Step 3: `extract()`

The core step. Takes `Chunk[]` (or `TextBlock[]` if no chunking), sends each to an LLM with the schema and prompt, and streams back partial structured results.

### Config

```typescript
interface ExtractConfig<TSchema> {
  /** AI SDK model for text-based extraction. */
  model: LanguageModel;

  /** The output schema. Valibot, Zod, or JSON Schema. */
  schema: TSchema;

  /** Extraction instructions / prompt. */
  prompt: string;

  /** Optional: vision-capable model for end-to-end VLM extraction.
   *  When set and input is visual, bypasses normalize+chunk and sends
   *  the image directly to this model with the schema. */
  visionModel?: LanguageModel;

  /** Few-shot examples to include in the prompt. */
  examples?: Array<{
    input: string;
    output: InferOutput<TSchema>;
  }>;

  /** Number of extraction passes. >1 enables multi-pass with first-pass-wins merging.
   *  See Reference: LangExtract multi-pass strategy. Default: 1. */
  passes?: number;

  /** Max chunks to process in parallel. Default: 3. */
  concurrency?: number;

  /** How to handle per-chunk extraction errors. Default: 'skip'. */
  onChunkError?: 'skip' | 'throw' | ((error: Error, chunk: Chunk) => void);

  /** System prompt prepended to all extraction calls. */
  systemPrompt?: string;

  /** AI SDK generation options (temperature, maxTokens, etc.). */
  generationOptions?: Partial<GenerateObjectOptions>;
}
```

### Output type

```typescript
interface Extraction<T> {
  /** The extracted data matching the schema. */
  data: T;

  /** Which chunk this extraction came from. */
  chunk: Chunk;

  /** Which pass produced this extraction (for multi-pass). */
  pass?: number;
}
```

### Prompt construction

For each chunk, the extraction prompt is assembled as:

```
[systemPrompt if provided]

[prompt — user's extraction instructions]

[examples if provided, formatted as:]
  Example input: "..."
  Example output: { ... }

[context window from previous chunk, if present:]
  Previous context: "..."

[chunk text:]
  Document: "..."

Extract the data according to the schema.
```

> **Reference implementation**: See how LangExtract builds prompts in `langextract/prompting.py` — specifically `QAPromptGenerator` and `ContextAwarePromptBuilder`. Port the context injection pattern.
> Repository: https://github.com/google/langextract
> Key files: `langextract/prompting.py`, `langextract/annotation.py` (the `_build_prompts` method).

### Extraction modes

**Text extraction** (default):

- Uses AI SDK `streamObject({ model, schema, prompt })`.
- Returns `partialObjectStream` — yields progressively-complete partial objects.

**End-to-end VLM extraction** (when `visionModel` is set and input is visual):

- Sends the raw image/PDF page as a vision message to the VLM.
- Uses AI SDK `streamObject()` with image content parts.
- Entire extraction streams in a single pass — no separate OCR step.

**Self-hosted VLM via vLLM/SGLang/Ollama**:

- These expose OpenAI-compatible APIs with streaming + structured output (JSON schema constrained decoding).
- Use the AI SDK OpenAI provider pointed at the local endpoint.
- Example: `openai({ baseURL: 'http://localhost:8000/v1' })` for vLLM serving GLM-OCR or PaddleOCR-VL.
- This enables true end-to-end streaming: image → streamed structured JSON through a 0.9B model on a consumer GPU.

### Multi-pass extraction

When `passes > 1`:

1. Run extraction on all chunks sequentially for each pass.
2. After all passes, merge using **first-pass-wins** for overlapping character intervals.
3. Non-overlapping extractions from later passes are kept (increases recall).

> **Reference implementation**: See LangExtract's `_merge_non_overlapping_extractions()` in `langextract/annotation.py`.
> Repository: https://github.com/google/langextract
> Key file: `langextract/annotation.py` — search for `extraction_passes` and the merge logic.

---

## 8. Step 4: `merge()`

Combines `Extraction[]` from multiple chunks into a single output object `T`. This step is needed when a document is chunked and each chunk produces a partial result.

### Config

```typescript
interface MergeConfig<T> {
  /** Merge strategy. Default: 'concat'. */
  strategy: 'concat' | 'first' | 'dedupe' | ((extractions: Extraction<T>[]) => T);

  /** For 'dedupe': function to produce a dedup key for array items. */
  dedupeKey?: (item: any) => string;

  /** For 'dedupe': which extraction wins on collision. Default: 'first'. */
  dedupeWinner?: 'first' | 'last';
}
```

### Strategy details

**`'concat'`** (default):

- Array fields: concatenate in chunk order.
- Scalar fields (string, number): use the first non-null/non-undefined value.
- Nested objects: recursively apply the same logic.

**`'first'`**:

- Return the first chunk's extraction. Ignore the rest.
- Use for single-page documents or when chunking is `'none'`.

**`'dedupe'`**:

- Same as `'concat'`, then deduplicate array items by `dedupeKey`.
- Essential for sliding window chunking where overlapping chunks may extract the same item twice.
- Also useful for multi-pass extraction.

**Custom function**:

- Full control. Receives all extractions, returns the final `T`.

---

## 9. Streaming Model

### Event types

Every step emits typed events through the pipeline's async iterable:

```typescript
type PipelineEvent<T> =
  | { phase: 'normalizing'; block: TextBlock }
  | { phase: 'chunking'; chunk: Chunk }
  | { phase: 'extracting'; extraction: Partial<T>; chunk: Chunk; done: boolean }
  | { phase: 'merging'; result: T }
  | { phase: 'error'; error: Error; chunk?: Chunk; phase: string };
```

### How streaming works at the extract step

```typescript
// Internal pseudocode for extract()
async function* extractStep(chunks: AsyncIterable<Chunk>, config) {
  for await (const chunk of chunks) {
    const { partialObjectStream, object } = streamObject({
      model: config.model,
      schema: config.schema,
      prompt: buildPrompt(config, chunk),
    });

    for await (const partial of partialObjectStream) {
      yield { phase: 'extracting', extraction: partial, chunk, done: false };
    }

    const final = await object;
    yield { phase: 'extracting', extraction: final, chunk, done: true };
  }
}
```

The consumer sees fields materialize progressively:

```typescript
const pipeline = normalize({ ocr }).extract({ model, schema, prompt });

for await (const event of pipeline.stream(pdfBuffer)) {
  if (event.phase === 'extracting' && !event.done) {
    // event.extraction might be: { vendor: "Acme" }
    // then: { vendor: "Acme", total: 42.50 }
    // then: { vendor: "Acme", total: 42.50, lineItems: [{ description: "Widget" }] }
    updateUI(event.extraction);
  }
}
```

### Streaming for end-to-end VLM mode

When using `visionModel` with an image input, the entire pipeline is a single streaming call. There's no normalize or chunk step — the `extract` step receives the raw image and streams directly.

---

## 10. OCR & VLM Backends

### Backend interface

```typescript
interface OcrBackend {
  /** Convert a visual document to text. */
  parse(input: Buffer | ReadableStream, options?: OcrOptions): Promise<string>;

  /** Human-readable name for logging. */
  name: string;
}

interface OcrOptions {
  /** Original filename (helps some backends). */
  filename?: string;
  /** MIME type. */
  mimeType?: string;
  /** Which pages to extract (for multi-page PDFs). */
  pages?: number[] | 'all';
}
```

### Built-in backends

#### `mineruBackend(config)`

Calls MinerU's HTTP API (Docker service). Returns markdown.

```typescript
import { mineruBackend } from 'munchr/backends';

const ocr = mineruBackend({
  url: 'http://localhost:8888',
  // Options passed to MinerU's /file_parse endpoint:
  tableEnable: true,
  formulaEnable: true,
});
```

> **Reference implementation**: See how baitna calls MinerU in `src/lib/server/pdf-parser.ts`.
> File: `/home/user/baitna/src/lib/server/pdf-parser.ts`
> Look at the `parseWithMineru()` function — multipart POST to `/file_parse`, response shape `{ results: { [filename]: { md_content } } }`.

#### `mistralOcrBackend(config)`

Calls Mistral OCR 3 API. Returns markdown with HTML tables.

```typescript
import { mistralOcrBackend } from 'munchr/backends';

const ocr = mistralOcrBackend({
  apiKey: process.env.MISTRAL_API_KEY,
});
```

Note: Mistral OCR is batch-only (no streaming). The `normalize` step blocks until the response is complete, then the `extract` step streams.

#### Using VLMs as OCR (no separate backend needed)

For end-to-end VLM extraction, you don't need an `OcrBackend` — set `visionModel` on the `extract()` step instead. The LLM sees the image and extracts structured data directly.

For **self-hosted VLMs** (GLM-OCR 0.9B, PaddleOCR-VL 1.5, Qwen3-VL, DeepSeek-OCR-2) served via vLLM/SGLang/Ollama:

```typescript
import { openai } from '@ai-sdk/openai';

// vLLM serving GLM-OCR locally
const localVlm = openai('glm-ocr', {
  baseURL: 'http://localhost:8000/v1',
});

// Use as visionModel — gets streaming + structured output for free
const pipeline = extract({
  visionModel: localVlm,
  schema: InvoiceSchema,
  prompt: 'Extract invoice details',
});
```

This works because vLLM/SGLang expose OpenAI-compatible APIs with:

- Streaming token output
- Structured output constraints (JSON schema via guided decoding)
- Vision input (images)

### Backend landscape (March 2026)

For the planning agent's context — these are the major OCR/VLM options the library should interoperate with:

**Self-hosted end-to-end VLMs (streamable via vLLM):**

- GLM-OCR (0.9B, OmniDocBench 94.62 #1, 1.86 pages/sec)
- PaddleOCR-VL 1.5 (0.9B, OmniDocBench 94.5, 111 languages, cross-page tables)
- DeepSeek-OCR-2 (3B, 20x token compression, 200k pages/day on A100)
- LightOnOCR-2 (1B, 5.71 pages/sec on H100)
- Qwen3-VL (large, top-tier reasoning, 32 OCR languages)

**Cloud APIs:**

- Gemini 3.1 Pro/Flash (1M context, native PDF, streaming, structured output)
- Claude 4.6 Opus/Sonnet (1M context, 600 PDF pages, streaming, structured output)
- GPT-5 (streaming, structured output)
- Mistral OCR 3 (dedicated OCR API, $1-2/1000 pages, NO streaming)

**Pipeline OCR (text output, no streaming):**

- MinerU (Docker, hybrid pipeline+VLM, 109 languages)

munchr doesn't need to wrap all of these — it just needs the `OcrBackend` interface for pipeline mode, and the AI SDK provider system for VLM mode. One OpenAI-compatible adapter covers the entire self-hosted VLM landscape.

---

## 11. Chunking Strategies

### `'sentence'` — Sentence boundary splitting

Port from LangExtract's chunking logic. This is the most important strategy for prose documents.

> **Reference implementation**: `langextract/chunking.py` — `ChunkIterator` and `SentenceIterator`.
> Repository: https://github.com/google/langextract
> Key files:
>
> - `langextract/chunking.py` — three-tier chunking (single token, long sentence breaking, multi-sentence grouping)
> - `langextract/core/tokenizer.py` — `RegexTokenizer` and `UnicodeTokenizer`, `find_sentence_range()` with abbreviation filtering

**Logic to port:**

1. **Sentence boundary detection**: Split on `.?!` and newlines, but filter abbreviations ("Mr.", "Dr.", "Inc.", "vs.", etc.). Consume trailing closing punctuation/quotes.
2. **Three-tier chunking**:
   - If a single token exceeds `maxChars` → it becomes its own chunk (shouldn't happen in practice).
   - If a sentence exceeds `maxChars` → break at last newline, then at token boundaries.
   - Otherwise → accumulate complete sentences until the next one would exceed `maxChars`.
3. **Context window**: Prepend `contextWindow` chars from the end of the previous chunk. This gives the LLM context for resolving pronouns, "the above", etc.

**Tokenization**: Use a regex tokenizer for ASCII/Latin (`\b` word boundaries), with a Unicode-aware fallback for CJK/Thai/Arabic text (grapheme cluster splitting via `Intl.Segmenter` — native in Node.js, no library needed).

### `'row'` — Table-row-aware splitting

Port from baitna's existing statement chunking logic.

> **Reference implementation**: baitna's statement plugin.
> File: `/home/user/baitna/src/lib/server/document-pipeline/plugins/statement.plugin.ts`
> Look at the chunking logic that splits markdown into 8KB chunks at table row boundaries (never mid-row).

**Logic:**

1. Split text into lines.
2. Identify table rows (lines starting with `|` in markdown, or consistent delimiter patterns).
3. Accumulate rows until `maxChars` is reached.
4. Never split in the middle of a row.
5. Prepend a header context (table headers, column names) to each chunk so the LLM knows column semantics.

### `'structural'` — Heading-based splitting

Split at markdown heading boundaries (`#`, `##`, `###`).

**Logic:**

1. Find all heading lines.
2. Each section (heading → next heading) is a candidate chunk.
3. If a section exceeds `maxChars`, fall back to sentence splitting within it.
4. If a section is much smaller than `maxChars`, merge with next section.

### `'page'` — Page-based splitting

One chunk per `TextBlock` (when TextBlocks represent individual pages from a multi-page PDF).

### `'sliding'` — Overlapping window

Fixed-size windows with configurable overlap. Requires `'dedupe'` merge strategy to handle duplicate extractions.

### `'none'` — Pass through

No splitting. The entire text is one chunk. Use when the document fits in context.

---

## 12. Error Handling

### Error types

```typescript
class MunchrError extends Error {
  phase: 'normalize' | 'chunk' | 'extract' | 'merge';
}

class NormalizeError extends MunchrError {
  /** The format that failed to parse. */
  format: string;
}

class ChunkError extends MunchrError {
  /** The TextBlock that failed to chunk. */
  block: TextBlock;
}

class ExtractionError extends MunchrError {
  /** The chunk that failed extraction. */
  chunk: Chunk;
  /** The underlying LLM/API error. */
  cause: Error;
}
```

### Per-chunk resilience

When `onChunkError: 'skip'` (the default):

- If one chunk's extraction fails (LLM error, malformed output, timeout), the chunk is skipped.
- An error event is emitted: `{ phase: 'error', error, chunk }`.
- Remaining chunks continue processing.
- The final merged result contains data from successful chunks only.

This is critical for long documents. A 50-page bank statement should not fail because page 37 had a weird table the LLM couldn't parse.

> **Reference**: LangExtract also implements per-chunk error suppression — see their resolver's error handling in `langextract/resolver.py`.

### Validation

- After each chunk's extraction, validate the result against the schema.
- If validation fails and `onChunkError: 'skip'`, discard that chunk's extraction.
- The schema acts as both the extraction target AND the validation gate.

---

## 13. Package Structure

```
munchr/
  src/
    index.ts                  # Public API exports

    core/
      chain.ts                # Fluent builder classes (Normalized, Chunked, Extracted, Merged)
      types.ts                # TextBlock, Chunk, Extraction, PipelineEvent, InputData, InputOptions
      errors.ts               # MunchrError hierarchy

    steps/
      normalize.ts            # normalize() step factory
      chunk.ts                # chunk() step factory
      extract.ts              # extract() step factory
      merge.ts                # merge() step factory

    normalize/
      detect.ts               # Format auto-detection (magic bytes, extension, mime)
      csv.ts                  # CSV -> text
      html.ts                 # HTML -> text (uses html-to-text)
      xlsx.ts                 # XLSX -> text (uses exceljs, peer dep)
      docx.ts                 # DOCX -> text (uses mammoth, peer dep)
      email.ts                # .eml -> text (uses mailparser, peer dep)
      pdf.ts                  # PDF text extraction + scanned detection

    chunking/
      sentence.ts             # Sentence boundary chunking (ported from LangExtract)
      tokenizer.ts            # RegexTokenizer + Intl.Segmenter unicode tokenizer
      row.ts                  # Table-row-aware chunking (ported from baitna)
      structural.ts           # Heading-based chunking
      sliding.ts              # Overlapping window chunking
      auto.ts                 # Auto-strategy selection

    backends/
      mineru.ts               # MinerU HTTP backend
      mistral-ocr.ts          # Mistral OCR 3 API backend
      types.ts                # OcrBackend interface

    prompt/
      builder.ts              # Prompt assembly (instructions + examples + context + chunk)

  package.json
  tsconfig.json
  README.md
```

---

## 14. Dependencies

### Hard dependencies (always installed)

| Package              | Purpose                                              | Why not optional             |
| -------------------- | ---------------------------------------------------- | ---------------------------- |
| `ai` (Vercel AI SDK) | `streamObject()`, `generateObject()`, provider types | Core of extraction step      |
| `html-to-text`       | HTML normalization                                   | Lightweight, commonly needed |

### Peer dependencies (install only if you use that format)

| Package            | Purpose              | When needed                           |
| ------------------ | -------------------- | ------------------------------------- |
| `exceljs`          | XLSX parsing         | Only if normalizing .xlsx files       |
| `mammoth`          | DOCX parsing         | Only if normalizing .docx files       |
| `mailparser`       | Email (.eml) parsing | Only if normalizing email files       |
| `valibot` or `zod` | Schema definition    | User picks one (AI SDK supports both) |

### Dev dependencies

| Package             | Purpose              |
| ------------------- | -------------------- |
| `typescript`        | Build                |
| `vitest`            | Testing              |
| `tsup` or `unbuild` | Bundling (ESM + CJS) |

### What munchr does NOT depend on

- No `bullmq` / `ioredis` — no job queues. Users add their own if needed.
- No `minio` / `sharp` — no storage or image processing.
- No `drizzle-orm` / `postgres` — no database.
- No framework dependencies (SvelteKit, Next.js, etc.).

---

## 15. Reference Implementations

These are codebases the planning/implementing agent should read for specific logic:

### Google LangExtract (Python)

**Repository**: https://github.com/google/langextract

What to reference:
| Logic | File(s) | What to port |
|-------|---------|-------------|
| Sentence chunking & tokenization | `langextract/chunking.py`, `langextract/core/tokenizer.py` | `ChunkIterator`, `SentenceIterator`, `find_sentence_range()`, abbreviation filtering, three-tier chunking strategy |
| Context window injection | `langextract/prompting.py` | `ContextAwarePromptBuilder` — how previous chunk text is prepended |
| Multi-pass extraction & merging | `langextract/annotation.py` | `_merge_non_overlapping_extractions()`, extraction_passes loop |
| Prompt construction | `langextract/prompting.py` | `QAPromptGenerator` — how examples, description, context, and question are composed |
| Per-chunk error handling | `langextract/resolver.py` | Error suppression per chunk, continue processing |
| Token-level alignment (grounding) | `langextract/resolver.py` | `_align_extractions()`, fuzzy matching with `SequenceMatcher`. **Post-MVP** — skip for v1, but the architecture should not preclude adding it later. |

**Key architectural insight from LangExtract**: Their `Annotator` class processes documents as generators, emitting results immediately rather than buffering. Port this pattern using AsyncGenerators.

### Baitna document pipeline (TypeScript)

**Repository**: This repo, `/home/user/baitna`

What to reference:
| Logic | File(s) | What to port |
|-------|---------|-------------|
| MinerU HTTP API calling | `src/lib/server/pdf-parser.ts` | `parseWithMineru()` — multipart POST, response parsing |
| Table-row-aware chunking | `src/lib/server/document-pipeline/plugins/statement.plugin.ts` | The 8KB chunk splitting logic that respects table row boundaries |
| AI SDK streamObject() usage | `src/lib/server/document-pipeline/plugins/receipt.plugin.ts` | How `streamObject()` and `partialObjectStream` are used for streaming extraction |
| Plugin base class patterns | `src/lib/server/document-pipeline/plugins/base.ts` | Utility functions: `parseDate()`, `normalizeCurrency()`, `normalizeAmount()`, `isImage()`, `isPdf()` |
| AI SDK provider setup | `src/lib/services/ai.ts` | OpenRouter provider configuration with logging middleware |

### Vercel AI SDK docs

**URL**: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data

What to reference:

- `streamObject()` API and `partialObjectStream` usage
- Schema support (Valibot via `@ai-sdk/valibot`, Zod native, JSON Schema)
- Provider configuration for OpenAI, Anthropic, Google

---

## 16. Non-Goals

Things munchr explicitly does NOT do:

1. **No storage.** Does not persist extracted data anywhere. Returns it; consumer stores it.
2. **No job queues.** No BullMQ, no async processing. If users want queues, they wrap the pipeline in their own queue worker.
3. **No UI.** No visualization, no progress bars, no HTML output. Emits events; consumer renders them.
4. **No classification.** Does not classify document types (receipt vs invoice vs statement). Consumer provides the schema and prompt for what they want extracted.
5. **No post-processing.** Does not do vendor matching, transaction linking, or any domain-specific business logic. That belongs in the consuming application.
6. **No auth or multi-tenancy.** It's a library function.
7. **No model hosting.** Does not run LLMs. Connects to them via AI SDK providers.
8. **No format conversion.** Does not convert between formats (PDF → DOCX). Only converts TO text for extraction.
9. **No forking or white-labeling other tools.** Clean-room implementation, inspired by but not derived from LangExtract or others.

---

## 17. Example Pipelines

### Receipt extraction (single page, with OCR)

```typescript
import { normalize, extract } from 'munchr';
import { mineruBackend } from 'munchr/backends';
import { openai } from '@ai-sdk/openai';
import * as v from 'valibot';

const ReceiptSchema = v.object({
  vendor: v.string(),
  date: v.string(),
  total: v.number(),
  currency: v.string(),
  lineItems: v.array(
    v.object({
      description: v.string(),
      amount: v.number(),
      quantity: v.optional(v.number()),
    }),
  ),
});

// Define pipeline — nothing executes yet
const receipts = normalize({ ocr: mineruBackend({ url: 'http://localhost:8888' }) }).extract({
  model: openai('gpt-4o-mini'),
  schema: ReceiptSchema,
  prompt: 'Extract all receipt details. Include every line item.',
});

// Stream partial results for UI
for await (const event of receipts.stream(pdfBuffer)) {
  if (event.phase === 'extracting') {
    renderPartialReceipt(event.extraction);
  }
}

// Or just await the final result
const receipt = await receipts.run(pdfBuffer);
```

### Bank statement (multi-page, chunked)

```typescript
import { normalize } from 'munchr';

const TransactionSchema = v.object({
  transactions: v.array(
    v.object({
      date: v.string(),
      description: v.string(),
      amount: v.number(),
      type: v.picklist(['debit', 'credit']),
      balance: v.optional(v.number()),
    }),
  ),
});

const statements = normalize({ ocr: mineruBackend({ url: 'http://localhost:8888' }) })
  .chunk({ strategy: 'row', maxChars: 8000, contextWindow: 500 })
  .extract({
    model: openai('gpt-4o'),
    schema: TransactionSchema,
    prompt: 'Extract all bank transactions from this statement section.',
    concurrency: 3,
    onChunkError: 'skip',
  })
  .merge({
    strategy: 'dedupe',
    dedupeKey: (tx) => `${tx.date}-${tx.amount}-${tx.description}`,
  });

const result = await statements.run(pdfBuffer);
console.log(`Extracted ${result.transactions.length} transactions`);
```

### CSV classification (no OCR, no chunking)

```typescript
const csvClassifier = normalize({ type: 'csv' }).extract({
  model: openai('gpt-4o-mini'),
  schema: v.object({
    transactions: v.array(
      v.object({
        original: v.string(),
        vendor: v.string(),
        category: v.string(),
        amount: v.number(),
      }),
    ),
  }),
  prompt: 'For each row, identify the vendor name and assign a spending category.',
});

const result = await csvClassifier.run(csvString, { type: 'csv' });
```

### End-to-end VLM (self-hosted GLM-OCR, no separate OCR)

```typescript
import { extract } from 'munchr';
import { openai } from '@ai-sdk/openai';

// vLLM serving GLM-OCR (0.9B params, runs on consumer GPU)
const glmOcr = openai('glm-ocr', {
  baseURL: 'http://localhost:8000/v1',
});

// extract() alone — no normalize or chunk needed
const invoices = extract({
  visionModel: glmOcr,
  schema: InvoiceSchema,
  prompt: 'Extract invoice details from this document.',
});

// True end-to-end streaming: image in, partial JSON out
for await (const event of invoices.stream(imageBuffer, { type: 'image' })) {
  if (event.phase === 'extracting') {
    console.log(event.extraction); // progressively fills in
  }
}
```

### High-recall entity extraction (multi-pass, from LangExtract pattern)

```typescript
const entities = normalize()
  .chunk({ strategy: 'sentence', maxChars: 2000, contextWindow: 300 })
  .extract({
    model: google('gemini-3.1-flash'),
    schema: v.object({
      entities: v.array(
        v.object({
          name: v.string(),
          type: v.picklist(['person', 'org', 'location', 'date', 'amount']),
          text: v.string(),
        }),
      ),
    }),
    prompt: 'Extract all named entities.',
    passes: 2,
    concurrency: 5,
  })
  .merge({
    strategy: 'dedupe',
    dedupeKey: (e) => `${e.type}:${e.name.toLowerCase()}`,
  });

const result = await entities.run(longDocument);
```

### Email invoice extraction

```typescript
const emailInvoices = normalize({ type: 'email', includeHeaders: true }).extract({
  model: openai('gpt-4o-mini'),
  schema: v.object({
    from: v.string(),
    subject: v.string(),
    invoiceNumber: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  }),
  prompt: 'Extract invoice details from this email.',
});

const invoice = await emailInvoices.run(emlFileBuffer);
```

### Individual steps (composable, no chain required)

Each step is also usable standalone for custom pipelines:

```typescript
import { normalizeStep, chunkStep, extractStep } from 'munchr/steps';

// Use normalize alone to convert any file to text
const blocks = [];
for await (const block of normalizeStep({ ocr })(fileBuffer, { type: 'pdf' })) {
  blocks.push(block);
}

// Use chunk alone on existing text blocks
const chunks = [];
for await (const c of chunkStep({ strategy: 'sentence' })(blocks)) {
  chunks.push(c);
}

// Use extract alone on pre-chunked text
for await (const partial of extractStep({ model, schema, prompt })(chunks)) {
  updateUI(partial);
}
```

---

## Appendix: Naming

- **Package name**: `munchr` (npm available, checked 2026-03-25)
- **Tagline**: "Any document + schema in, streamed structured JSON out."
- **Alternatives considered**: `munch` (taken — CSS minifier), `extracto` (available but generic)
