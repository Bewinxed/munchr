---
name: munchr
description: |
  How to build document extraction pipelines with the munchr library. Use this skill whenever the user works with munchr, imports from 'munchr' or 'munchr/backends' or 'munchr/steps', wants to extract structured data or markdown from documents (PDFs, images, CSVs, HTML, XLSX, DOCX, emails), sets up OCR pipelines, or configures LLM-based extraction with schemas. Also trigger when you see the normalize/chunk/extract/merge pipeline pattern, or when someone asks about streaming structured JSON or markdown from documents.
---

# munchr

munchr turns any document into typed structured data or clean markdown through a fluent pipeline: **normalize → chunk → extract → merge**. The user only configures the steps they need.

## Output modes

The `extract()` step has two modes, controlled by the `output` discriminant:

- **`output: 'schema'`** — Structured JSON. Requires a schema (Valibot, Zod, ArkType). Uses AI SDK `streamObject()`. Returns typed `T`.
- **`output: 'markdown'`** — Clean markdown. No schema needed. Uses AI SDK `streamText()`. Returns `string`.

Both stream progressively and work with the full pipeline.

## Deciding what the user needs

### 1. What's the input?

**Text-extractable** (CSV, HTML, XLSX, DOCX, email, text, markdown, text-based PDF): Use `normalize()`. No OCR needed. Format detection is automatic.

**Scanned PDFs or images** — two choices:
- **Pipeline mode** — `normalize({ ocr: mineruBackend(...) })` — OCR first, then LLM extracts from text. Use for multi-page documents or when chunking is needed.
- **VLM mode** — `extract({ visionModel })` — Image goes straight to a vision model. Simpler, but the whole document must fit in one call. Best for single-page docs (receipts, ID cards, single invoices).

### 2. What output?

**Structured data** → `output: 'schema'`. User provides a schema. Primary use case for data extraction, form parsing, invoices.

**Clean markdown** → `output: 'markdown'`. No schema. LLM converts/cleans the text into markdown. Use for document conversion, content migration, OCR cleanup.

### 3. Does it need chunking?

If the text exceeds ~8K chars, chunk it:

- **Tables / rows** → `'row'` — never splits mid-row, prepends headers to each chunk
- **Prose** → `'sentence'` — splits at sentence boundaries, handles abbreviations
- **Markdown with sections** → `'structural'` — splits at heading boundaries
- **Sliding window** → `'sliding'` — overlapping. Always pair with `'dedupe'` merge

If it fits in context, skip `.chunk()`.

### 4. Schema design (schema mode only)

- Use whichever Standard Schema library the user prefers. Default to Valibot if they haven't chosen.
- Use `v.optional()` for fields that may not appear in every chunk
- Put arrays inside the schema object (not as the top-level schema)
- Keep schemas flat — deeply nested schemas are harder for LLMs

### 5. Merging

**Schema mode:**
- `'concat'` (default) — concatenates arrays, first-non-null for scalars
- `'dedupe'` — concat + deduplicate by key. Use with sliding window chunks.
- Custom function for full control

**Markdown mode:**
- `'concat'` (default) — joins chunks with `\n\n---\n\n`
- `'first'` — first chunk only

## Pipeline examples

### Schema mode — structured extraction

```typescript
import { normalize } from 'munchr';
import { mineruBackend } from 'munchr/backends';
import { openai } from '@ai-sdk/openai';
import * as v from 'valibot';

const TransactionSchema = v.object({
  transactions: v.array(v.object({
    date: v.string(),
    description: v.string(),
    amount: v.number(),
    type: v.picklist(['debit', 'credit']),
  })),
});

const pipeline = normalize({ ocr: mineruBackend({ url: 'http://localhost:8888' }) })
  .chunk({ strategy: 'row', maxChars: 8000, contextWindow: 500 })
  .extract({
    output: 'schema',
    model: openai('gpt-4o'),
    schema: TransactionSchema,
    prompt: 'Extract all bank transactions. Include date, description, amount, and type.',
    concurrency: 3,
    onChunkError: 'skip',
  })
  .merge({
    strategy: 'dedupe',
    dedupeKey: (tx) => `${tx.date}-${tx.amount}-${tx.description.slice(0, 20)}`,
  });

const result = await pipeline.run(pdfBuffer);
```

### Markdown mode — document conversion

```typescript
import { normalize } from 'munchr';
import { openai } from '@ai-sdk/openai';

// Single document
const md = await normalize({ ocr })
  .extract({
    output: 'markdown',
    model: openai('gpt-4o-mini'),
    prompt: 'Convert this document to clean markdown.',
  })
  .run(pdfBuffer);

// Multi-page with chunking
const md = await normalize({ ocr })
  .chunk({ strategy: 'page' })
  .extract({
    output: 'markdown',
    model: openai('gpt-4o-mini'),
    prompt: 'Convert to well-structured markdown. Preserve tables and headings.',
  })
  .merge({ strategy: 'concat' })
  .run(largePdf);
```

### Streaming markdown

```typescript
for await (const event of normalize({ ocr })
  .extract({ output: 'markdown', model, prompt: 'Convert to markdown.' })
  .stream(pdfBuffer)) {
  if (event.phase === 'extracting') {
    process.stdout.write(event.extraction); // progressive markdown string
  }
}
```

### VLM mode — both output modes

```typescript
import { extract } from 'munchr';
import { openai } from '@ai-sdk/openai';

// VLM → structured JSON
const data = await extract({
  output: 'schema',
  visionModel: openai('gpt-4o'),
  schema: InvoiceSchema,
  prompt: 'Extract invoice details.',
}).run(imageBuffer, { type: 'image' });

// VLM → markdown
const md = await extract({
  output: 'markdown',
  model: openai('gpt-4o'),
  visionModel: openai('gpt-4o'),
  prompt: 'Convert this image to markdown.',
}).run(imageBuffer, { type: 'image' });
```

### Simple cases (no OCR, no chunking)

```typescript
// CSV classification
const result = await normalize({ type: 'csv' }).extract({
  output: 'schema',
  model: openai('gpt-4o-mini'),
  schema: v.object({
    transactions: v.array(v.object({
      vendor: v.string(),
      category: v.string(),
      amount: v.number(),
    })),
  }),
  prompt: 'Identify vendor names and assign spending categories.',
}).run(csvString, { type: 'csv' });
```

## What to avoid

- **Don't skip chunking for long documents** — extraction quality drops past ~8K chars even with large context windows
- **Don't use VLM for multi-page documents** — use pipeline mode with OCR instead
- **Don't write vague prompts** — "extract data" is worse than "extract all transactions with date, description, and amount"
- **Don't use `onChunkError: 'throw'` in production** — one bad chunk shouldn't kill a 50-page run
- **Don't use `output: 'schema'` when the user just wants markdown** — it's slower and needs a schema

## Source code reference

- `src/core/types.ts` — all TypeScript interfaces (ExtractSchemaConfig, ExtractMarkdownConfig, OutputMode)
- `src/chain.ts` — fluent builder classes (Normalized, Chunked, Extracted, Merged)
- `src/steps/extract.ts` — extraction step (branches on output mode: streamObject vs streamText)
- `src/steps/` — step factory functions
- `src/chunking/` — chunking strategy implementations
- `src/backends/mineru.ts` — MinerU OCR backend
- `src/normalize/detect.ts` — format auto-detection

For the full type reference, see `references/api-reference.md`.
