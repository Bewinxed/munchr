<p align="center">
  <img src="https://raw.githubusercontent.com/Bewinxed/munchr/main/assets/logo.png?v=2" alt="munchr" width="200" />
</p>

<h1 align="center">munchr</h1>

<p align="center">
  <strong>Any document in, structured JSON or clean markdown out.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/munchr"><img src="https://img.shields.io/npm/v/munchr" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/munchr"><img src="https://img.shields.io/npm/dm/munchr" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" />
</p>

---

munchr is a TypeScript document extraction library built on the [Vercel AI SDK](https://ai-sdk.dev). Feed it a file and a schema, get back streamed structured data. Or skip the schema and get clean markdown instead.

```bash
npm install munchr
```

## Two output modes

**Schema mode** — structured JSON matching your schema, streamed progressively:

```typescript
import { normalize } from 'munchr';
import { openai } from '@ai-sdk/openai';
import * as v from 'valibot';

const result = await normalize()
  .extract({
    output: 'schema',
    model: openai('gpt-4o-mini'),
    schema: v.object({
      vendor: v.string(),
      total: v.number(),
      items: v.array(
        v.object({
          description: v.string(),
          amount: v.number(),
        }),
      ),
    }),
    prompt: 'Extract the receipt details.',
  })
  .run(pdfBuffer);
```

**Markdown mode** — LLM-cleaned markdown, no schema needed:

```typescript
const markdown = await normalize()
  .extract({
    output: 'markdown',
    model: openai('gpt-4o-mini'),
    prompt: 'Convert to clean, well-structured markdown.',
  })
  .run(pdfBuffer);
```

Both modes stream progressively and work with the full pipeline.

## The pipeline

Every extraction is a chain of up to four steps. Each step is optional depending on your use case.

```
normalize()  →  chunk()  →  extract()  →  merge()
```

The chain is lazy — nothing runs until you call `.run()` or `.stream()`.

```typescript
// Full pipeline: OCR → chunk → extract → deduplicate
const pipeline = normalize({ ocr: mineruBackend({ url: 'http://localhost:8888' }) })
  .chunk({ strategy: 'row', maxChars: 8000 })
  .extract({
    output: 'schema',
    model: openai('gpt-4o'),
    schema: TransactionSchema,
    prompt: 'Extract all transactions.',
    concurrency: 3,
  })
  .merge({ strategy: 'dedupe', dedupeKey: (tx) => `${tx.date}-${tx.amount}` });

const result = await pipeline.run(bankStatementPdf);
```

Pipelines are reusable — define once, run on many files:

```typescript
const receipt1 = await pipeline.run(pdf1);
const receipt2 = await pipeline.run(pdf2);
```

## Streaming

Use `.stream()` instead of `.run()` to get events as they happen:

```typescript
for await (const event of pipeline.stream(pdfBuffer)) {
  switch (event.phase) {
    case 'normalizing':
      /* TextBlock emitted */ break;
    case 'chunking':
      /* Chunk emitted */ break;
    case 'extracting':
      /* Partial<T> streaming */ break;
    case 'merging':
      /* Final result */ break;
    case 'error':
      /* Per-chunk error */ break;
  }
}
```

## Supported formats

| Format        | How it normalizes                                                                            |
| ------------- | -------------------------------------------------------------------------------------------- |
| PDF (text)    | Extracts embedded text via [unpdf](https://www.npmjs.com/package/unpdf)                      |
| PDF (scanned) | Delegates to OCR backend                                                                     |
| Image         | OCR backend or direct to vision model                                                        |
| CSV / TSV     | Parses to markdown table via [papaparse](https://www.npmjs.com/package/papaparse)            |
| HTML          | Strips tags, preserves tables via [html-to-text](https://www.npmjs.com/package/html-to-text) |
| XLSX          | Sheets to CSV text via [exceljs](https://www.npmjs.com/package/exceljs)                      |
| DOCX          | Extracts text via [mammoth](https://www.npmjs.com/package/mammoth)                           |
| Email (.eml)  | Headers + body via [mailparser](https://www.npmjs.com/package/mailparser)                    |
| Plain text    | Pass through                                                                                 |
| Markdown      | Pass through                                                                                 |

Format is auto-detected from magic bytes, extension, MIME type, or content sniffing.

## Chunking strategies

Pick based on the document's structure:

| Strategy       | Use when                                                         |
| -------------- | ---------------------------------------------------------------- |
| `'auto'`       | Default. Auto-selects based on content.                          |
| `'row'`        | Tables, bank statements. Never splits mid-row. Prepends headers. |
| `'sentence'`   | Prose. Splits at sentence boundaries.                            |
| `'structural'` | Markdown with headings. Splits at `#` boundaries.                |
| `'page'`       | Multi-page PDFs. One chunk per page.                             |
| `'sliding'`    | Fixed-size windows with overlap. Pair with `'dedupe'` merge.     |

```typescript
.chunk({ strategy: 'row', maxChars: 8000, contextWindow: 500 })
```

## Merge strategies

When multiple chunks produce results, merge them:

| Strategy   | Behavior                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `'concat'` | Default. Arrays concatenated, scalars first-non-null. In markdown mode, joins with `\n\n---\n\n`. |
| `'dedupe'` | Concat + deduplicate array items by key.                                                          |
| `'first'`  | First chunk only.                                                                                 |
| Custom fn  | `(extractions) => T` for full control.                                                            |

```typescript
.merge({ strategy: 'dedupe', dedupeKey: (tx) => `${tx.date}-${tx.amount}` })
```

## Vision model mode (no OCR)

For single-page visual documents, skip OCR and send the image directly to a vision model:

```typescript
import { extract } from 'munchr';

// Structured JSON from an image
const data = await extract({
  output: 'schema',
  visionModel: openai('gpt-4o'),
  schema: InvoiceSchema,
  prompt: 'Extract invoice details.',
}).run(imageBuffer, { type: 'image' });

// Markdown from an image
const md = await extract({
  output: 'markdown',
  model: openai('gpt-4o'),
  visionModel: openai('gpt-4o'),
  prompt: 'Convert this document to markdown.',
}).run(imageBuffer, { type: 'image' });
```

## OCR backends

### MinerU (self-hosted)

```typescript
import { mineruBackend } from 'munchr/backends';

const ocr = mineruBackend({
  url: 'http://localhost:8888',
  tableEnable: true,
  formulaEnable: true,
});

normalize({ ocr }).extract({ ... })
```

### Any AI SDK provider

Use any vision-capable model via the AI SDK provider system:

```typescript
import { openai } from '@ai-sdk/openai';

openai('gpt-4o');
openai('glm-ocr', { baseURL: 'http://localhost:8000/v1' }); // self-hosted
openai('anthropic/claude-4-sonnet', { baseURL: 'https://openrouter.ai/api/v1' }); // OpenRouter
```

## Standalone functions

Every pipeline step also works independently:

```typescript
import { normalize, chunk, extract, merge } from 'munchr';

const blocks = await normalize({ ocr }).run(fileBuffer, { type: 'pdf' });
const chunks = chunk(blocks, { strategy: 'sentence', maxChars: 8000 });

for await (const event of extract({ output: 'schema', model, schema, prompt }).stream(
  imageBuffer,
)) {
  console.log(event);
}

const result = merge(extractions, { strategy: 'concat' });
```

## Error handling

One bad chunk doesn't kill the pipeline. By default, errors are skipped:

```typescript
for await (const event of pipeline.stream(input)) {
  if (event.phase === 'error') {
    console.warn(`Chunk ${event.chunk?.index} failed:`, event.error.message);
  }
}

// Or throw on any error
.extract({ ..., onChunkError: 'throw' })

// Or handle per-chunk
.extract({ ..., onChunkError: (err, chunk) => log(err, chunk.index) })
```

## Schemas

Any [Standard Schema](https://standardschema.dev)-compatible library works — Valibot, Zod, ArkType. TypeScript infers the output type from your schema.

```typescript
import * as v from 'valibot';
import { z } from 'zod';

// Either works
const schema = v.object({ name: v.string(), amount: v.number() });
const schema = z.object({ name: z.string(), amount: z.number() });
```

## License

MIT
