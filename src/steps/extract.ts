import { streamObject, streamText } from 'ai';
import type { Chunk, ExtractConfig, ExtractSchemaConfig, PipelineEvent } from '../core/types.js';
import { ExtractionError, MunchrError } from '../core/errors.js';
import { toAISchema } from '../core/schema.js';
import { PromptBuilder } from '../prompt/builder.js';

const DEFAULT_MARKDOWN_SYSTEM_PROMPT = `You are a document-to-markdown converter. Your task is to convert the provided document content into clean, well-structured markdown.

Rules:
- Reconstruct heading hierarchy from the document structure
- Format tables as proper markdown tables
- Clean up OCR artifacts and fix obvious errors
- Preserve the document's logical structure and content
- Use appropriate markdown formatting (bold, italic, lists, code blocks)
- Do not add commentary or explanations — output only the converted markdown`;

async function extractChunkSchema<T>(
  chunk: Chunk,
  config: ExtractSchemaConfig<T>,
  promptBuilder: PromptBuilder,
): Promise<PipelineEvent<T>[]> {
  const prompt = promptBuilder.build(chunk, config);
  const schema = toAISchema(config.schema);

  const { partialObjectStream, object } = streamObject({
    model: config.model,
    schema,
    prompt,
    ...(config.systemPrompt ? { system: config.systemPrompt } : {}),
    ...(config.generationOptions as Record<string, unknown> | undefined),
  });

  const events: PipelineEvent<T>[] = [];
  for await (const partial of partialObjectStream) {
    events.push({
      phase: 'extracting',
      extraction: partial as Partial<T>,
      chunk,
      done: false,
    });
  }

  const final = await object;
  events.push({
    phase: 'extracting',
    extraction: final as Partial<T>,
    chunk,
    done: true,
  });

  return events;
}

async function extractChunkMarkdown<T>(
  chunk: Chunk,
  config: ExtractConfig<T>,
  promptBuilder: PromptBuilder,
): Promise<PipelineEvent<T>[]> {
  const prompt = promptBuilder.build(chunk, config);
  const system = config.systemPrompt ?? DEFAULT_MARKDOWN_SYSTEM_PROMPT;

  const { textStream, text } = streamText({
    model: config.model,
    prompt,
    system,
    ...(config.generationOptions as Record<string, unknown> | undefined),
  });

  const events: PipelineEvent<T>[] = [];
  let accumulated = '';
  for await (const delta of textStream) {
    accumulated += delta;
    events.push({
      phase: 'extracting',
      extraction: accumulated as unknown as Partial<T>,
      chunk,
      done: false,
    });
  }

  const final = await text;
  events.push({
    phase: 'extracting',
    extraction: final as unknown as Partial<T>,
    chunk,
    done: true,
  });

  return events;
}

/**
 * Extract step: sends chunks to LLM, streams results.
 * Schema mode uses streamObject(), markdown mode uses streamText().
 */
export async function* extractStep<T>(
  chunks: Chunk[],
  config: ExtractConfig<T>,
): AsyncGenerator<PipelineEvent<T>> {
  const concurrency = config.concurrency ?? 3;
  const onChunkError = config.onChunkError ?? 'skip';
  const promptBuilder = new PromptBuilder();

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchPromises = batch.map(async (chunk) => {
      try {
        if (config.output === 'markdown') {
          return await extractChunkMarkdown(chunk, config, promptBuilder);
        }
        return await extractChunkSchema(chunk, config, promptBuilder);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (onChunkError === 'throw') {
          throw new ExtractionError(
            `Extraction failed for chunk ${chunk.index}: ${error.message}`,
            chunk,
            error,
          );
        }

        if (typeof onChunkError === 'function') {
          onChunkError(error, chunk);
        }

        return [
          {
            phase: 'error' as const,
            error,
            chunk,
            source: 'extract',
          },
        ];
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const events of batchResults) {
      for (const event of events) {
        yield event as PipelineEvent<T>;
      }
    }
  }
}

/**
 * Extract step for VLM mode: sends raw image to vision model.
 * Schema mode uses streamObject(), markdown mode uses streamText().
 */
export async function* extractVlmStep<T>(
  input: Buffer,
  config: ExtractConfig<T>,
): AsyncGenerator<PipelineEvent<T>> {
  if (!config.visionModel) {
    throw new MunchrError('VLM mode requires a visionModel in the extract config.', 'extract');
  }

  const chunk: Chunk = {
    text: '[image input]',
    index: 0,
    total: 1,
    charOffset: 0,
    source: { format: 'image' },
  };

  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'image' as const, image: input },
        { type: 'text' as const, text: config.prompt },
      ],
    },
  ];

  try {
    if (config.output === 'markdown') {
      const system = config.systemPrompt ?? DEFAULT_MARKDOWN_SYSTEM_PROMPT;

      const { textStream, text } = streamText({
        model: config.visionModel,
        messages,
        system,
        ...(config.generationOptions as Record<string, unknown> | undefined),
      });

      let accumulated = '';
      for await (const delta of textStream) {
        accumulated += delta;
        yield {
          phase: 'extracting',
          extraction: accumulated as unknown as Partial<T>,
          chunk,
          done: false,
        };
      }

      const final = await text;
      yield {
        phase: 'extracting',
        extraction: final as unknown as Partial<T>,
        chunk,
        done: true,
      };
    } else {
      const schema = toAISchema(config.schema);

      const { partialObjectStream, object } = streamObject({
        model: config.visionModel,
        schema,
        messages,
        ...(config.systemPrompt ? { system: config.systemPrompt } : {}),
        ...(config.generationOptions as Record<string, unknown> | undefined),
      });

      for await (const partial of partialObjectStream) {
        yield {
          phase: 'extracting',
          extraction: partial as Partial<T>,
          chunk,
          done: false,
        };
      }

      const final = await object;
      yield {
        phase: 'extracting',
        extraction: final as Partial<T>,
        chunk,
        done: true,
      };
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (config.onChunkError === 'throw') {
      throw new ExtractionError(`VLM extraction failed: ${error.message}`, chunk, error);
    }
    if (typeof config.onChunkError === 'function') {
      config.onChunkError(error, chunk);
    }
    yield { phase: 'error', error, chunk, source: 'extract' };
  }
}
