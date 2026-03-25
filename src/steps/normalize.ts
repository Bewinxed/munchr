import type { InputData, InputOptions, NormalizeConfig, TextBlock } from '../core/types.js';
import { NormalizeError } from '../core/errors.js';
import { detectFormat } from '../normalize/detect.js';
import { normalizeCsv } from '../normalize/csv.js';
import { normalizeHtml } from '../normalize/html.js';
import { normalizePdf } from '../normalize/pdf.js';
import { normalizeXlsx } from '../normalize/xlsx.js';
import { normalizeDocx } from '../normalize/docx.js';
import { normalizeEmail } from '../normalize/email.js';

/**
 * Convert InputData to a Buffer for normalizers that need binary input.
 */
async function toBuffer(input: InputData): Promise<Buffer> {
  if (typeof input === 'string') return Buffer.from(input, 'utf-8');
  if (input instanceof Buffer) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);

  // ReadableStream
  const reader = (input as ReadableStream).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function toString(input: InputData): string {
  if (typeof input === 'string') return input;
  if (input instanceof Buffer) return input.toString('utf-8');
  if (input instanceof Uint8Array) return new TextDecoder().decode(input);
  throw new NormalizeError('Cannot synchronously convert ReadableStream to string', 'text');
}

/**
 * Normalize step: converts any supported input format into TextBlock[].
 */
export async function* normalizeStep(
  input: InputData,
  options: InputOptions | undefined,
  config: NormalizeConfig,
): AsyncGenerator<TextBlock> {
  const format = detectFormat(input, {
    ...options,
    type: config.type ?? options?.type,
  });

  const source = {
    format,
    filename: options?.filename,
  };

  switch (format) {
    case 'text': {
      const text = typeof input === 'string' ? input : toString(input);
      yield { text, source: { ...source, format: 'text' }, isVisual: false };
      break;
    }

    case 'markdown': {
      const text = typeof input === 'string' ? input : toString(input);
      yield { text, source: { ...source, format: 'markdown' }, isVisual: false };
      break;
    }

    case 'csv': {
      const text = typeof input === 'string' ? input : toString(input);
      yield normalizeCsv(text, source);
      break;
    }

    case 'html': {
      const text = typeof input === 'string' ? input : toString(input);
      yield normalizeHtml(text, source, config.preserveTables ?? true);
      break;
    }

    case 'pdf': {
      const buffer = await toBuffer(input);
      const blocks = await normalizePdf(buffer, source, config.ocr);
      for (const block of blocks) yield block;
      break;
    }

    case 'xlsx': {
      const buffer = await toBuffer(input);
      const blocks = await normalizeXlsx(buffer, source, config);
      for (const block of blocks) yield block;
      break;
    }

    case 'docx': {
      const buffer = await toBuffer(input);
      const block = await normalizeDocx(buffer, source);
      yield block;
      break;
    }

    case 'email': {
      const buffer = await toBuffer(input);
      const block = await normalizeEmail(buffer, source, config);
      yield block;
      break;
    }

    case 'image': {
      if (!config.ocr) {
        throw new NormalizeError(
          'Image input requires an OCR backend. Pass an `ocr` option to normalize().',
          'image',
        );
      }
      const buffer = await toBuffer(input);
      const ocrText = await config.ocr.parse(buffer, {
        filename: options?.filename,
        mimeType: options?.mimeType,
      });
      yield {
        text: ocrText,
        source: { ...source, format: 'image' },
        isVisual: true,
      };
      break;
    }

    default:
      throw new NormalizeError(`Unsupported format: ${format}`, format);
  }
}
