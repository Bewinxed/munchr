import type { Extraction, MergeConfig } from '../core/types.js';

/**
 * Deep merge two values with concat-array semantics.
 * Arrays are concatenated, scalars use first non-null, objects are recursively merged.
 */
function deepMerge(a: any, b: any): any {
  if (a == null) return b;
  if (b == null) return a;

  if (Array.isArray(a) && Array.isArray(b)) {
    return [...a, ...b];
  }

  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const result: Record<string, any> = { ...a };
    for (const key of Object.keys(b)) {
      result[key] = deepMerge(result[key], b[key]);
    }
    return result;
  }

  // Scalars: first non-null wins
  return a;
}

/**
 * Merge step: combines Extraction[] from multiple chunks into a single output.
 * Pure synchronous function.
 */
export function mergeStep<T>(extractions: Extraction<T>[], config: MergeConfig<T>): T {
  const strategy = config.strategy ?? 'concat';

  if (extractions.length === 0) {
    return null as unknown as T;
  }

  if (extractions.length === 1) {
    return extractions[0].data;
  }

  // Custom function
  if (typeof strategy === 'function') {
    return strategy(extractions);
  }

  switch (strategy) {
    case 'first':
      return extractions[0].data;

    case 'concat': {
      let result = extractions[0].data as any;
      for (let i = 1; i < extractions.length; i++) {
        result = deepMerge(result, extractions[i].data);
      }
      return result;
    }

    case 'dedupe': {
      // First, concat all
      let result = extractions[0].data as any;
      for (let i = 1; i < extractions.length; i++) {
        result = deepMerge(result, extractions[i].data);
      }

      // Then deduplicate array fields
      if (config.dedupeKey) {
        result = deduplicateArrays(result, config.dedupeKey, config.dedupeWinner ?? 'first');
      }
      return result;
    }

    default:
      return extractions[0].data;
  }
}

/**
 * Walk an object and deduplicate any array values using the dedupeKey function.
 */
function deduplicateArrays(
  obj: any,
  dedupeKey: (item: any) => string,
  winner: 'first' | 'last',
): any {
  if (Array.isArray(obj)) {
    const seen = new Map<string, any>();
    for (const item of obj) {
      const key = dedupeKey(item);
      if (winner === 'first') {
        if (!seen.has(key)) seen.set(key, item);
      } else {
        seen.set(key, item);
      }
    }
    return [...seen.values()];
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deduplicateArrays(value, dedupeKey, winner);
    }
    return result;
  }

  return obj;
}
