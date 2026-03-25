import { streamObject } from 'ai';
import type { Chunk, ExtractConfig, PipelineEvent } from '../core/types.js';
import { ExtractionError } from '../core/errors.js';
import { PromptBuilder } from '../prompt/builder.js';

/**
 * Extract step: sends chunks to LLM with schema, streams partial results.
 * Async generator — always async (LLM calls).
 */
export async function* extractStep<T>(
  chunks: Chunk[],
  config: ExtractConfig<T>,
): AsyncGenerator<PipelineEvent<T>> {
  const concurrency = config.concurrency ?? 3;
  const onChunkError = config.onChunkError ?? 'skip';
  const promptBuilder = new PromptBuilder();

  // Process chunks with concurrency limit
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchPromises = batch.map(async (chunk) => {
      try {
        const prompt = promptBuilder.build(chunk, config);
        const systemPrompt = promptBuilder.getSystemPrompt(config);

        const streamOpts: Record<string, unknown> = {
          model: config.model,
          schema: config.schema,
          prompt,
        };
        if (systemPrompt) streamOpts.system = systemPrompt;
        if (config.generationOptions) {
          Object.assign(streamOpts, config.generationOptions);
        }

        const { partialObjectStream, object } = streamObject(streamOpts as any);

        // Collect partial objects as they stream in
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
    throw new Error('VLM mode requires a visionModel in the extract config.');
  }

  const chunk: Chunk = {
    text: '[image input]',
    index: 0,
    total: 1,
    charOffset: 0,
    source: { format: 'image' },
  };

  try {
    const streamOpts: Record<string, unknown> = {
      model: config.visionModel,
      schema: config.schema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: input },
            { type: 'text', text: config.prompt },
          ],
        },
      ],
    };
    if (config.systemPrompt) streamOpts.system = config.systemPrompt;
    if (config.generationOptions) {
      Object.assign(streamOpts, config.generationOptions);
    }

    const { partialObjectStream, object } = streamObject(streamOpts as any);

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
    yield { phase: 'error', error, chunk, source: 'extract' };
  }
}
