---
name: munchr
description: |
  How to build document extraction pipelines with the munchr library. Use this skill whenever the user works with munchr, imports from 'munchr' or 'munchr/backends' or 'munchr/steps', wants to extract structured data or markdown from documents (PDFs, images, CSVs, HTML, XLSX, DOCX, emails), sets up OCR pipelines, or configures LLM-based extraction with schemas. Also trigger when you see the normalize/chunk/extract/merge pipeline pattern, or when someone asks about streaming structured JSON or markdown from documents.
---

# munchr

munchr turns any document into typed structured data or clean markdown through a fluent pipeline. The key design insight: every document extraction problem is a sequence of **normalize → chunk → extract → merge**, and the user only configures the steps relevant to their use case.

## Output modes

munchr supports two output modes via the `extract()` step, controlled by the `output` discriminant:

- **`output: 'schema'`** — Structured JSON extraction. Requires a schema (Valibot, Zod, ArkType). Uses AI SDK `streamObject()`. Returns typed `T`.
- **`output: 'markdown'`** — LLM-enhanced markdown conversion. No schema needed. Uses AI SDK `streamText()`. Returns `string`.

Both modes stream progressively and work with the full pipeline (normalize → chunk → extract → merge).

## How to think about a user's extraction problem

When a user comes to you with a document extraction task, work through these questions in order. Each answer narrows the pipeline design.

### 1. What's the input?

This determines whether you need OCR and which path to take.

**Text-extractable formats** (CSV, HTML, XLSX, DOCX, email, plain text, markdown, text-based PDF): Start with `normalize()`. No OCR needed — munchr has built-in parsers for all of these. Format detection is automatic from magic bytes, extension, MIME type, or content sniffing, so the user rarely needs to specify the type.

**Scanned PDFs or images**: Two choices, and this is an important design decision:
- **Pipeline mode** — `normalize({ ocr: mineruBackend(...) })` — OCR produces text first, then the LLM extracts structure from text. Better when you need chunking (long documents) or when the OCR model is separate from the extraction model.
- **VLM mode** — `extract({ visionModel })` — Image goes directly to a vision-capable LLM with the schema. Simpler, fewer moving parts, but the entire document must fit in one LLM call. Best for single-page documents or when using large-context vision models.

Guide the user toward VLM mode for single-page visual documents (receipts, single invoices, ID cards) and pipeline mode for multi-page scanned documents (bank statements, contracts).

### 2. What output does the user need?

**Structured data** (JSON matching a schema) → `output: 'schema'`. The user must provide a schema. This is the primary use case for data extraction, form parsing, invoice processing, etc.

**Clean markdown** → `output: 'markdown'`. No schema needed. The LLM converts/cleans the normalized text into well-structured markdown. Use for document conversion, content migration, OCR cleanup, or when the user wants readable text output rather than structured fields.

### 3. Does the text exceed the LLM's effective context?

If yes, the user needs chunking. Pick the strategy based on the document's structure, not its format:

- **Tables or row-oriented data** → `'row'` — This is critical for financial documents. Row chunking never splits a table row across chunks and prepends the header row to each chunk so the LLM always knows which column is which.
- **Prose with paragraphs** → `'sentence'` — Splits at sentence boundaries. The tokenizer handles abbreviations (Mr., Dr., Inc.) so it won't break at false periods. Context window carries the tail of the previous chunk for coreference resolution.
- **Markdown with clear sections** → `'structural'` — Splits at heading boundaries. Falls back to sentence splitting for sections that are too large.
- **Sliding window** → `'sliding'` — When you need overlapping context. Always pair with `'dedupe'` merge strategy to handle the duplicate extractions from the overlap regions.

If the document fits in context, skip `.chunk()` entirely.

### 4. What does the output schema look like? (schema mode only)

Help the user design a schema that reflects how data actually appears in the document. The schema is both the extraction target AND the validation gate — if the LLM output doesn't match, that chunk's extraction is discarded.

Use whichever Standard Schema library the user prefers (Valibot, Zod, ArkType). When the user hasn't chosen, default to Valibot — it's the lightest and tree-shakes best.

Key schema design principles:
- Use `v.optional()` / `z.optional()` for fields that might not appear in every chunk
- For array extraction (transactions, line items, entities), the array goes inside the schema object — don't make the top-level schema an array
- Keep schemas flat when possible — deeply nested schemas are harder for LLMs to populate correctly

### 5. Do multiple chunks produce results that need combining?

If yes, the user needs `.merge()`. The strategy depends on the output mode and schema shape:

**For schema mode:**
- **Array data** (transactions, line items, entities) → `'concat'` or `'dedupe'`. Concat is the default — it appends arrays from each chunk. If chunks overlap (sliding window) or multi-pass is used, use `'dedupe'` with a key function that uniquely identifies each item.
- **Scalar data** (single vendor name, total amount) → `'concat'` works — it uses the first non-null value for scalars.
- **Complex merging logic** → pass a custom function: `.merge({ strategy: (extractions) => myMerge(extractions) })`

**For markdown mode:**
- The default `'concat'` strategy joins markdown strings with `\n\n---\n\n` separators between chunks.
- `'first'` returns only the first chunk's markdown.

## Constructing pipelines

Always construct the pipeline as a reusable chain, then call `.run()` or `.stream()` on it:

### Schema mode (structured JSON)

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

### Markdown mode (document conversion)

```typescript
import { normalize } from 'munchr';
import { openai } from '@ai-sdk/openai';

// Single-page document
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

// Streaming markdown
for await (const event of normalize({ ocr })
  .extract({ output: 'markdown', model, prompt: 'Convert to markdown.' })
  .stream(pdfBuffer)) {
  if (event.phase === 'extracting') {
    process.stdout.write(event.extraction);
  }
}
```

### VLM mode (vision model, both output modes)

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

## What to avoid

- **Don't skip `.chunk()` for long documents hoping the LLM handles it** — LLM extraction quality degrades sharply past 8-10K chars of source text, even if the context window is larger. Chunk it.
- **Don't use VLM mode for multi-page documents** — unless the model supports very large visual inputs. Use pipeline mode with OCR instead.
- **Don't make the extraction prompt too vague** — "extract data" is worse than "extract all bank transactions including date, description, debit/credit amount, and running balance." Specificity drives extraction quality.
- **Don't set `onChunkError: 'throw'` for production pipelines** — one malformed table on page 37 shouldn't kill a 50-page extraction. Use `'skip'` (default) and handle error events.
- **Don't use `output: 'schema'` when the user just wants markdown** — it's slower and requires a schema. Use `output: 'markdown'` instead.

## Source code reference

The library source is in `src/`. Read these files for implementation details:
- `src/core/types.ts` — all TypeScript interfaces and config types (ExtractSchemaConfig, ExtractMarkdownConfig)
- `src/chain.ts` — the fluent builder classes (Normalized, Chunked, Extracted, Merged)
- `src/core/errors.ts` — error class hierarchy
- `src/steps/extract.ts` — extraction step (branches on output mode: streamObject vs streamText)
- `src/steps/` — step factory functions (normalize, chunk, extract, merge)
- `src/chunking/` — chunking strategy implementations
- `src/backends/mineru.ts` — MinerU OCR backend
- `src/normalize/detect.ts` — format auto-detection logic

For the full API type reference, read `references/api-reference.md`.
