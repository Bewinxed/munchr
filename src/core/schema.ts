/**
 * Bridge between Standard Schema and the AI SDK's Schema type.
 *
 * The AI SDK accepts its own Schema type (created via jsonSchema()).
 * Standard Schema libraries (Valibot, Zod, ArkType) implement StandardSchemaV1.
 * This module converts between them.
 */

import { jsonSchema } from 'ai';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Convert a Standard Schema to an AI SDK Schema.
 * Extracts the JSON Schema for the LLM and uses the schema's validate() for type safety.
 */
export function toAISchema<T>(schema: StandardSchemaV1<unknown, T>) {
  const props = schema['~standard'];

  // Get JSON Schema if the schema supports it (StandardJSONSchemaV1)
  const jsonSchemaProps = props as typeof props & {
    jsonSchema?: { output: (opts: { target: string }) => Record<string, unknown> };
  };

  let rawJsonSchema: Record<string, unknown>;

  if (jsonSchemaProps.jsonSchema) {
    rawJsonSchema = jsonSchemaProps.jsonSchema.output({ target: 'draft-07' });
  } else {
    // Fallback: try to get JSON schema from common library-specific methods
    // Zod v4 and Valibot both implement StandardJSONSchemaV1
    throw new Error(
      `Schema from "${props.vendor}" does not implement StandardJSONSchemaV1. ` +
        'The schema must support JSON Schema conversion for LLM extraction.',
    );
  }

  return jsonSchema<T>(rawJsonSchema as Parameters<typeof jsonSchema>[0], {
    validate: (value) => {
      const result = props.validate(value);
      // Handle sync validation (Standard Schema validate can return sync or async)
      if (result instanceof Promise) {
        throw new Error(
          'Async schema validation is not supported. Use a schema with synchronous validation.',
        );
      }
      if (result.issues) {
        return {
          success: false as const,
          error: new Error(result.issues.map((i) => i.message).join('; ')),
        };
      }
      return { success: true as const, value: result.value as T };
    },
  });
}
