import { extractText } from 'unpdf';
import type { OcrBackend, TextBlock, TextBlockSource } from '../core/types.js';
import { NormalizeError } from '../core/errors.js';

/**
 * Normalize a PDF buffer to text.
 * Tries text extraction first; falls back to OCR for scanned PDFs.
 */
export async function normalizePdf(
  input: Buffer,
  source: TextBlockSource,
  ocr?: OcrBackend,
): Promise<TextBlock[]> {
  // Try text extraction first
  let extractedText = '';
  try {
    const result = await extractText(new Uint8Array(input));
    extractedText = (
      Array.isArray(result.text) ? result.text.join('\n') : String(result.text)
    ).trim();
  } catch {
    // unpdf failed — will try OCR
  }

  // If text extraction yielded meaningful content, use it
  if (extractedText.length > 50) {
    return [
      {
        text: extractedText,
        source: { ...source, format: 'pdf' },
        isVisual: false,
      },
    ];
  }

  // Scanned PDF — delegate to OCR
  if (!ocr) {
    throw new NormalizeError(
      'PDF appears to be scanned but no OCR backend is configured. Pass an `ocr` option to normalize().',
      'pdf',
    );
  }

  const ocrText = await ocr.parse(input, {
    filename: source.filename,
    mimeType: 'application/pdf',
  });

  return [
    {
      text: ocrText,
      source: { ...source, format: 'pdf' },
      isVisual: true,
    },
  ];
}
