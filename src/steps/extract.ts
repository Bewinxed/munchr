import { streamObject } from 'ai';
import type { Chunk, ExtractConfig, PipelineEvent } from '../core/types.js';
import { ExtractionError, MunchrError } from '../core/errors.js';
import { toAISchema } from '../core/schema.js';
import { PromptBuilder } from '../prompt/builder.js';

/**
 * Extract step: sends chunks to LLM with schema, streams partial results.
 * Uses AI SDK streamObject — deprecated in v6 but still functional and
 * properly typed. Will migrate to streamText + Output.object() when it
 * supports Standard Schema natively.
 */
export async function* extractStep<T>(
  chunks: Chunk[],
  config: ExtractConfig<T>,
): AsyncGenerator<PipelineEvent<T>> {
  const concurrency = config.concurrency ?? 3;
  const onChunkError = config.onChunkError ?? 'skip';
  const promptBuilder = new PromptBuilder();
  const schema = toAISchema(config.schema);

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchPromises = batch.map(async (chunk) => {
      try {
        const prompt = promptBuilder.build(chunk, config);

        const { partialObjectStream, object } = streamObject({
          model: config.model,
          schema,
          prompt,
          ...(config.systemPrompt ? { system: config.systemPrompt } : {}),
          ...(config.generationOptions as Record<string, unknown> | undefined),
        });

        const partials: PipelineEvent<T>[] = [];
        for await (const partial of partialObjectStream) {
          partials.push({
            phase: 'extracting',
            extraction: partial as Partial<T>,
            chunk,
            done: false,
          });
        }

        const final = await object;
        partials.push({
          phase: 'extracting',
          extraction: final as Partial<T>,
          chunk,
          done: true,
        });

        return partials;
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
 * Extract step for VLM mode: sends raw image to vision model with schema.
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

  const schema = toAISchema(config.schema);

  try {
    const { partialObjectStream, object } = streamObject({
      model: config.visionModel,
      schema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: input },
            { type: 'text', text: config.prompt },
          ],
        },
      ],
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
