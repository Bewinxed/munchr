import type { OcrBackend, OcrOptions } from '../core/types.js';

export interface MineruConfig {
  /** MinerU API endpoint URL. */
  url: string;
  /** Enable table recognition. Default: true. */
  tableEnable?: boolean;
  /** Enable formula recognition. Default: true. */
  formulaEnable?: boolean;
}

/**
 * Create a MinerU OCR backend.
 * Calls MinerU's HTTP API (Docker service) and returns markdown.
 */
export function mineruBackend(config: MineruConfig): OcrBackend {
  const baseUrl = config.url.replace(/\/$/, '');

  return {
    name: 'mineru',

    async parse(input: Buffer | ReadableStream, options?: OcrOptions): Promise<string> {
      const buffer =
        input instanceof Buffer
          ? input
          : Buffer.from(await streamToBuffer(input as ReadableStream));

      const filename = options?.filename ?? 'document.pdf';
      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(buffer)]), filename);
      formData.append('parse_method', 'auto');

      if (config.tableEnable !== false) {
        formData.append('table_enable', 'true');
      }
      if (config.formulaEnable !== false) {
        formData.append('formula_enable', 'true');
      }

      const response = await fetch(`${baseUrl}/file_parse`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`MinerU API error: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as Record<string, any>;

      // MinerU response shape: { results: { [filename]: { md_content } } }
      const results = result.results ?? result;
      for (const key of Object.keys(results)) {
        const entry = results[key];
        if (entry?.md_content) return entry.md_content;
      }

      // Fallback: try direct md_content
      if (result.md_content) return result.md_content;

      throw new Error('MinerU returned no markdown content');
    },
  };
}

async function streamToBuffer(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
