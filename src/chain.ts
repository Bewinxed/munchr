/**
 * Fluent builder chain — the core API.
 *
 * Type-level state machine:
 *   Normalized  → .chunk(), .extract()
 *   Chunked     → .extract()
 *   Extracted<T> → .merge(), .run(), .stream(), .then()
 *   Merged<T>   → .run(), .stream(), .then()
 */

import type {
  Chunk,
  ChunkConfig,
  Extraction,
  ExtractConfig,
  InputData,
  InputOptions,
  MergeConfig,
  NormalizeConfig,
  PipelineEvent,
  TextBlock,
} from './core/types.js';
import { normalizeStep } from './steps/normalize.js';
import { chunkStep } from './steps/chunk.js';
import { extractStep, extractVlmStep } from './steps/extract.js';
import { mergeStep } from './steps/merge.js';
import { blocksToChunks } from './chunking/passthrough.js';

// ---------------------------------------------------------------------------
// Normalized — entry point from normalize()
// ---------------------------------------------------------------------------

export class Normalized {
  private normalizeConfig: NormalizeConfig;

  constructor(config: NormalizeConfig) {
    this.normalizeConfig = config;
  }

  /**
   * Standalone: normalize input and return all TextBlocks.
   */
  async run(input: InputData, options?: InputOptions): Promise<TextBlock[]> {
    const blocks: TextBlock[] = [];
    for await (const block of this.stream(input, options)) {
      blocks.push(block);
    }
    return blocks;
  }

  /**
   * Standalone: stream TextBlocks as they're produced.
   */
  async *stream(input: InputData, options?: InputOptions): AsyncGenerator<TextBlock> {
    yield* normalizeStep(input, options, this.normalizeConfig);
  }

  chunk(config?: ChunkConfig): Chunked {
    return new Chunked(this.normalizeConfig, config ?? {});
  }

  extract<T>(config: ExtractConfig<T>): Extracted<T> {
    return new Extracted(this.normalizeConfig, undefined, config);
  }
}

// ---------------------------------------------------------------------------
// Chunked — after chunk()
// ---------------------------------------------------------------------------

export class Chunked {
  private normalizeConfig: NormalizeConfig;
  private chunkConfig: ChunkConfig;

  constructor(normalizeConfig: NormalizeConfig, chunkConfig: ChunkConfig) {
    this.normalizeConfig = normalizeConfig;
    this.chunkConfig = chunkConfig;
  }

  extract<T>(config: ExtractConfig<T>): Extracted<T> {
    return new Extracted(this.normalizeConfig, this.chunkConfig, config);
  }
}

// ---------------------------------------------------------------------------
// Extracted<T> — after extract(), thenable + async iterable
// ---------------------------------------------------------------------------

export class Extracted<T> {
  private normalizeConfig: NormalizeConfig | undefined;
  private chunkConfig: ChunkConfig | undefined;
  private extractConfig: ExtractConfig<T>;
  private boundInput?: InputData;
  private boundOptions?: InputOptions;

  constructor(
    normalizeConfig: NormalizeConfig | undefined,
    chunkConfig: ChunkConfig | undefined,
    extractConfig: ExtractConfig<T>,
  ) {
    this.normalizeConfig = normalizeConfig;
    this.chunkConfig = chunkConfig;
    this.extractConfig = extractConfig;
  }

  merge(config?: MergeConfig<T>): Merged<T> {
    return new Merged(this.normalizeConfig, this.chunkConfig, this.extractConfig, config ?? {});
  }

  /**
   * Execute the pipeline and return the final extracted result.
   *
   * Multi-chunk results are merged using the concat strategy by default
   * (arrays concatenated, scalars first-wins, objects deep-merged).
   *
   * @returns null when no data was extracted (no chunks produced results).
   */
  async run(input: InputData, options?: InputOptions): Promise<T> {
    const extractions: Extraction<T>[] = [];

    for await (const event of this.stream(input, options)) {
      if (event.phase === 'extracting' && event.done) {
        extractions.push({
          data: event.extraction as T,
          chunk: event.chunk,
        });
      }
    }

    if (extractions.length === 0) return null as unknown as T;
    if (extractions.length === 1) return extractions[0].data;

    // Default merge: concat
    return mergeStep(extractions, { strategy: 'concat' });
  }

  /**
   * Stream pipeline events.
   */
  async *stream(input: InputData, options?: InputOptions): AsyncGenerator<PipelineEvent<T>> {
    // VLM mode: extract directly from image
    if (this.extractConfig.visionModel && !this.normalizeConfig) {
      const buffer = input instanceof Buffer ? input : Buffer.from(input as any);
      yield* extractVlmStep(buffer, this.extractConfig);
      return;
    }

    // Pipeline mode: normalize → (chunk) → extract
    const blocks: TextBlock[] = [];
    const normalizeConfig = this.normalizeConfig ?? {};

    for await (const block of normalizeStep(input, options, normalizeConfig)) {
      yield { phase: 'normalizing', block };
      blocks.push(block);
    }

    // Chunk
    let chunks: Chunk[];
    if (this.chunkConfig) {
      chunks = chunkStep(blocks, this.chunkConfig);
    } else {
      chunks = blocksToChunks(blocks);
    }

    for (const chunk of chunks) {
      yield { phase: 'chunking', chunk };
    }

    // Extract
    yield* extractStep(chunks, this.extractConfig);
  }

  /**
   * Thenable protocol — makes this await-able.
   */
  then<TResult1 = T, TResult2 = never>(
    resolve?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (!this.boundInput) {
      return Promise.reject(
        new Error('No input bound. Use .run(input) or bind input before awaiting.'),
      ).then(resolve, reject);
    }
    return this.run(this.boundInput, this.boundOptions).then(resolve, reject);
  }

  /**
   * Bind input for thenable usage.
   */
  withInput(input: InputData, options?: InputOptions): this {
    this.boundInput = input;
    this.boundOptions = options;
    return this;
  }
}

// ---------------------------------------------------------------------------
// Merged<T> — after merge(), thenable + async iterable
// ---------------------------------------------------------------------------

export class Merged<T> {
  private normalizeConfig: NormalizeConfig | undefined;
  private chunkConfig: ChunkConfig | undefined;
  private extractConfig: ExtractConfig<T>;
  private mergeConfig: MergeConfig<T>;
  private boundInput?: InputData;
  private boundOptions?: InputOptions;

  constructor(
    normalizeConfig: NormalizeConfig | undefined,
    chunkConfig: ChunkConfig | undefined,
    extractConfig: ExtractConfig<T>,
    mergeConfig: MergeConfig<T>,
  ) {
    this.normalizeConfig = normalizeConfig;
    this.chunkConfig = chunkConfig;
    this.extractConfig = extractConfig;
    this.mergeConfig = mergeConfig;
  }

  /**
   * Execute the pipeline and return the merged result.
   */
  async run(input: InputData, options?: InputOptions): Promise<T> {
    const extractions: Extraction<T>[] = [];

    for await (const event of this.stream(input, options)) {
      if (event.phase === 'extracting' && event.done) {
        extractions.push({
          data: event.extraction as T,
          chunk: event.chunk,
        });
      }
    }

    return mergeStep(extractions, this.mergeConfig);
  }

  /**
   * Stream pipeline events including the final merge event.
   */
  async *stream(input: InputData, options?: InputOptions): AsyncGenerator<PipelineEvent<T>> {
    const extracted = new Extracted<T>(this.normalizeConfig, this.chunkConfig, this.extractConfig);

    const extractions: Extraction<T>[] = [];

    for await (const event of extracted.stream(input, options)) {
      yield event;
      if (event.phase === 'extracting' && event.done) {
        extractions.push({
          data: event.extraction as T,
          chunk: event.chunk,
        });
      }
    }

    const result = mergeStep(extractions, this.mergeConfig);
    yield { phase: 'merging', result };
  }

  /**
   * Thenable protocol.
   */
  then<TResult1 = T, TResult2 = never>(
    resolve?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (!this.boundInput) {
      return Promise.reject(
        new Error('No input bound. Use .run(input) or bind input before awaiting.'),
      ).then(resolve, reject);
    }
    return this.run(this.boundInput, this.boundOptions).then(resolve, reject);
  }

  /**
   * Bind input for thenable usage.
   */
  withInput(input: InputData, options?: InputOptions): this {
    this.boundInput = input;
    this.boundOptions = options;
    return this;
  }
}
