import type { FormatType, InputData, InputOptions } from '../core/types.js';

type DetectedFormat = Exclude<FormatType, 'auto'>;

const EXTENSION_MAP: Record<string, DetectedFormat> = {
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.svg': 'image',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.html': 'html',
  '.htm': 'html',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.docx': 'docx',
  '.doc': 'docx',
  '.eml': 'email',
  '.msg': 'email',
  '.txt': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
};

const MIME_MAP: Record<string, DetectedFormat> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'text/csv': 'csv',
  'text/tab-separated-values': 'csv',
  'text/html': 'html',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'message/rfc822': 'email',
  'text/plain': 'text',
  'text/markdown': 'markdown',
};

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function toBytes(input: InputData): Uint8Array | null {
  if (typeof input === 'string') return new TextEncoder().encode(input.slice(0, 16));
  if (input instanceof Buffer) return input;
  if (input instanceof Uint8Array) return input;
  // ReadableStream — can't peek synchronously
  return null;
}

function detectFromMagicBytes(bytes: Uint8Array): DetectedFormat | null {
  if (bytes.length < 4) return null;

  // PDF: %PDF-
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf';
  }

  // PNG: \x89PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image';
  }

  // JPEG: \xFF\xD8\xFF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image';
  }

  // GIF: GIF8
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image';
  }

  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image';
  }

  // ZIP (PK\x03\x04) — could be XLSX or DOCX
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    // Can't distinguish XLSX from DOCX by magic bytes alone without reading the ZIP contents.
    // Return null and let filename/mime take precedence.
    return null;
  }

  // BMP: BM
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image';
  }

  // TIFF: II or MM
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return 'image';
  }

  return null;
}

function detectFromContent(input: InputData): DetectedFormat | null {
  const text = typeof input === 'string' ? input : null;
  if (!text) return null;

  const trimmed = text.trimStart();

  // HTML detection
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML')
  ) {
    return 'html';
  }

  // Email detection
  if (/^(From|To|Subject|Date|MIME-Version|Content-Type):\s/m.test(trimmed.slice(0, 500))) {
    return 'email';
  }

  // Markdown detection: has headings
  if (/^#{1,6}\s/m.test(trimmed.slice(0, 2000))) {
    return 'markdown';
  }

  // CSV detection: consistent commas or tabs across lines
  const lines = trimmed.split('\n', 5);
  if (lines.length >= 2) {
    const commas = lines.map((l) => (l.match(/,/g) || []).length);
    if (commas[0] > 0 && commas.every((c) => c === commas[0])) {
      return 'csv';
    }
    const tabs = lines.map((l) => (l.match(/\t/g) || []).length);
    if (tabs[0] > 0 && tabs.every((t) => t === tabs[0])) {
      return 'csv';
    }
  }

  return 'text';
}

/**
 * Detect the format of the input data.
 * Priority: explicit type → mimeType → filename extension → magic bytes → content sniffing.
 */
export function detectFormat(
  input: InputData,
  options?: InputOptions,
): Exclude<FormatType, 'auto'> {
  // 1. Explicit type
  if (options?.type && options.type !== 'auto') {
    return options.type;
  }

  // 2. MIME type
  if (options?.mimeType) {
    const fromMime = MIME_MAP[options.mimeType.toLowerCase().split(';')[0].trim()];
    if (fromMime) return fromMime;
  }

  // 3. Filename extension
  if (options?.filename) {
    const ext = getExtension(options.filename);
    const fromExt = EXTENSION_MAP[ext];
    if (fromExt) return fromExt;
  }

  // 4. Magic bytes
  const bytes = toBytes(input);
  if (bytes) {
    const fromMagic = detectFromMagicBytes(bytes);
    if (fromMagic) return fromMagic;
  }

  // 5. Content sniffing
  const fromContent = detectFromContent(input);
  if (fromContent) return fromContent;

  return 'text';
}
