import type { Chunk, TextBlock } from './types.js';

export class MunchrError extends Error {
  phase: 'normalize' | 'chunk' | 'extract' | 'merge';

  constructor(message: string, phase: MunchrError['phase']) {
    super(message);
    this.name = 'MunchrError';
    this.phase = phase;
  }
}

export class NormalizeError extends MunchrError {
  format: string;

  constructor(message: string, format: string) {
    super(message, 'normalize');
    this.name = 'NormalizeError';
    this.format = format;
  }
}

export class ChunkError extends MunchrError {
  block: TextBlock;

  constructor(message: string, block: TextBlock) {
    super(message, 'chunk');
    this.name = 'ChunkError';
    this.block = block;
  }
}

export class ExtractionError extends MunchrError {
  chunk: Chunk;
  override cause: Error;

  constructor(message: string, chunk: Chunk, cause: Error) {
    super(message, 'extract');
    this.name = 'ExtractionError';
    this.chunk = chunk;
    this.cause = cause;
  }
}
