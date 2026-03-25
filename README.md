<p align="center">
  <img src="https://raw.githubusercontent.com/Bewinxed/munchr/main/assets/logo.png" alt="munchr" width="200" />
</p>

<h1 align="center">munchr</h1>

<p align="center">
  <strong>Any document + schema in, streamed structured JSON out.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/munchr"><img src="https://img.shields.io/npm/v/munchr" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/munchr"><img src="https://img.shields.io/npm/dm/munchr" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" />
</p>

---

A composable, TypeScript-native document extraction library built on the [Vercel AI SDK](https://ai-sdk.dev). Feed it any file format — PDFs, images, CSVs, HTML, XLSX, emails, plain text — along with a schema and a prompt, and get back progressively-streamed structured data.

## Features

- **10 input formats** — PDF (text + scanned), images, CSV, HTML, XLSX, DOCX, email (.eml), plain text, markdown
- **Schema-driven** — any [Standard Schema](https://standardschema.dev)-compatible library (Valibot, Zod, ArkType, etc.). TypeScript infers your output type.
- **Streaming** — partial structured JSON streams in real-time via AI SDK `streamObject()`
- **Fluent pipeline** — `normalize().chunk().extract().merge()` — lazy, thenable, `for await`-able
- **Any LLM** — OpenAI, Anthropic, Google, OpenRouter, or self-hosted via vLLM/SGLang/Ollama
- **End-to-end VLM** — skip OCR entirely, send images straight to vision models
- **Per-chunk resilience** — one bad chunk doesn't kill a 50-page extraction
- **6 chunking strategies** — sentence, row, structural, page, sliding, auto

## Install

```bash
bun add munchr
# or
npm install munchr
```

## Quick Start

### Receipt extraction (OCR + LLM)

```typescript
import { normalize } from 'munchr';
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

const receipts = normalize({ ocr: mineruBackend({ url: 'http://localhost:8888' }) }).extract({
  model: openai('gpt-4o-mini'),
  schema: ReceiptSchema,
  prompt: 'Extract all receipt details. Include every line item.',
});

// Stream partial results
for await (const event of receipts.stream(pdfBuffer)) {
  if (event.phase === 'extracting') {
    renderPartialReceipt(event.extraction);
  }
}

// Or just await the final result
const receipt = await receipts.run(pdfBuffer);
```

### Bank statement (multi-page, chunked, deduplicated)

```typescript
import { normalize } from 'munchr';
import * as v from 'valibot';

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

### End-to-end VLM (no separate OCR)

```typescript
import { extract } from 'munchr';
import { openai } from '@ai-sdk/openai';

// vLLM serving GLM-OCR locally
const glmOcr = openai('glm-ocr', {
  baseURL: 'http://localhost:8000/v1',
});

const invoices = extract({
  visionModel: glmOcr,
  schema: InvoiceSchema,
  prompt: 'Extract invoice details from this document.',
});

for await (const event of invoices.stream(imageBuffer, { type: 'image' })) {
  if (event.phase === 'extracting') {
    console.log(event.extraction); // progressively fills in
  }
}
```

### CSV (no OCR, no chunking)

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

## Pipeline API

Every step returns a builder with the valid next steps as methods. The chain is lazy — nothing executes until you `.run()`, `.stream()`, or `await` it.

```
normalize(config?)        → Normalized    — has .chunk(), .extract()
  .chunk(config?)         → Chunked       — has .extract()
    .extract(config)      → Extracted<T>  — has .merge(), .run(), .stream()
      .merge(config?)     → Merged<T>     — has .run(), .stream()

extract(config)           → Extracted<T>  — entry point for VLM mode
```

### Execution

```typescript
// Option A: .run() for final result
const result = await pipeline.run(pdfBuffer);
const result = await pipeline.run(pdfBuffer, { type: 'pdf', filename: 'invoice.pdf' });

// Option B: .stream() for events
for await (const event of pipeline.stream(pdfBuffer)) {
  switch (event.phase) {
    case 'normalizing': // TextBlock emitted
    case 'chunking': // Chunk emitted
    case 'extracting': // Partial<T> streaming
    case 'merging': // Final T
    case 'error': // Per-chunk error
  }
}
```

### Reusable pipelines

Chains are immutable descriptions — store and reuse them:

```typescript
const receiptPipeline = normalize({ ocr }).extract({ model, schema: ReceiptSchema, prompt: '...' });

const receipt1 = await receiptPipeline.run(pdf1);
const receipt2 = await receiptPipeline.run(pdf2);
```

## Chunking Strategies

| Strategy       | When to use                                                                     |
| -------------- | ------------------------------------------------------------------------------- |
| `'auto'`       | Default. Auto-detects based on content.                                         |
| `'sentence'`   | Prose documents. Splits at sentence boundaries with abbreviation filtering.     |
| `'row'`        | Tables / bank statements. Never splits mid-row. Prepends headers to each chunk. |
| `'structural'` | Markdown with headings. Splits at `#` boundaries.                               |
| `'page'`       | Multi-page PDFs. One chunk per page.                                            |
| `'sliding'`    | Fixed-size windows with overlap. Use with `dedupe` merge.                       |
| `'none'`       | No splitting. Document fits in context.                                         |

```typescript
.chunk({ strategy: 'sentence', maxChars: 8000, contextWindow: 500 })
.chunk({ strategy: 'row', maxChars: 8000 })
.chunk({ strategy: 'sliding', maxChars: 4000, overlap: 200 })
.chunk({ strategy: (blocks) => myCustomChunker(blocks) })
```

## Merge Strategies

| Strategy                    | Behavior                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| `'concat'`                  | Arrays concatenated, scalars first-non-null, objects recursive. Default. |
| `'first'`                   | First chunk's extraction only.                                           |
| `'dedupe'`                  | Concat + deduplicate array items by key.                                 |
| Custom `(extractions) => T` | Full control.                                                            |

```typescript
.merge({ strategy: 'dedupe', dedupeKey: (tx) => `${tx.date}-${tx.amount}` })
```

## OCR Backends

### MinerU (self-hosted Docker)

```typescript
import { mineruBackend } from 'munchr/backends';

const ocr = mineruBackend({
  url: 'http://localhost:8888',
  tableEnable: true,
  formulaEnable: true,
});
```

### Vision LLMs (no separate OCR)

Use the AI SDK provider system directly — no backend wrapper needed:

```typescript
import { openai } from '@ai-sdk/openai';

// Cloud
const model = openai('gpt-4o');

// Self-hosted via vLLM
const localVlm = openai('glm-ocr', { baseURL: 'http://localhost:8000/v1' });

// OpenRouter
const openRouter = openai('anthropic/claude-4-sonnet', {
  baseURL: 'https://openrouter.ai/api/v1',
});
```

## Standalone Usage

Every function works independently — the same ones used internally by the chain:

```typescript
import { normalize, chunk, extract, merge } from 'munchr';

// Normalize any file to text
const blocks = await normalize({ ocr }).run(fileBuffer, { type: 'pdf' });

// Chunk text blocks (sync)
const chunks = chunk(blocks, { strategy: 'sentence', maxChars: 8000 });

// Stream extraction from chunks
for await (const event of extract({ model, schema, prompt }).stream(imageBuffer)) {
  console.log(event);
}

// Merge extractions (sync)
const result = merge(extractions, { strategy: 'concat' });
```

## Supported Formats

| Format        | How it normalizes           | Library                                                    |
| ------------- | --------------------------- | ---------------------------------------------------------- |
| Plain text    | Pass through                | None                                                       |
| Markdown      | Pass through                | None                                                       |
| CSV / TSV     | Parse + markdown table      | [papaparse](https://www.npmjs.com/package/papaparse)       |
| HTML          | Strip tags, preserve tables | [html-to-text](https://www.npmjs.com/package/html-to-text) |
| XLSX          | Sheets → CSV text           | [exceljs](https://www.npmjs.com/package/exceljs)           |
| DOCX          | Extract text                | [mammoth](https://www.npmjs.com/package/mammoth)           |
| Email (.eml)  | Headers + body              | [mailparser](https://www.npmjs.com/package/mailparser)     |
| PDF (text)    | Extract embedded text       | [unpdf](https://www.npmjs.com/package/unpdf)               |
| PDF (scanned) | Delegate to OCR backend     | Configured `OcrBackend`                                    |
| Image         | Delegate to OCR or VLM      | Configured `OcrBackend` or `visionModel`                   |

Format is auto-detected from magic bytes, file extension, MIME type, or content sniffing.

## Error Handling

```typescript
import { MunchrError, NormalizeError, ExtractionError } from 'munchr';

// Per-chunk resilience (default: onChunkError: 'skip')
// One bad chunk emits an error event but doesn't stop the pipeline.

for await (const event of pipeline.stream(input)) {
  if (event.phase === 'error') {
    console.warn(`Chunk ${event.chunk?.index} failed:`, event.error.message);
  }
}

// Or throw on any chunk error
.extract({ ..., onChunkError: 'throw' })

// Or handle per-chunk
.extract({ ..., onChunkError: (err, chunk) => log(err, chunk.index) })
```

## Architecture

```
                    +-- PDF (scanned) ---> [OCR backend] --> markdown --+
                    |-- PDF (text) ------> [unpdf] --> text -----------+
                    |-- Image -----------> [VLM end-to-end] ---------->|---> streamed JSON
Input --> detect -> |-- CSV -------------> [papaparse] --> md table ---+          ^
                    |-- HTML ------------> [html-to-text] --> text ----+          |
                    |-- XLSX ------------> [exceljs] --> CSV text -----+    [AI SDK
                    |-- DOCX ------------> [mammoth] --> text ---------+     streamObject()
                    |-- Email (.eml) ----> [mailparser] --> text ------+     + schema]
                    +-- Plain/Markdown --> pass through ---------------+
                                  |                              |
                            normalize()                     chunk() --> extract() --> merge()
```

## License

MIT
