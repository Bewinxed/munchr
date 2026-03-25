import ExcelJS from 'exceljs';
import type { NormalizeConfig, TextBlock, TextBlockSource } from '../core/types.js';

/**
 * Normalize an XLSX buffer to text blocks (one per sheet).
 */
export async function normalizeXlsx(
  input: Buffer,
  source: TextBlockSource,
  config?: Pick<NormalizeConfig, 'sheets'>,
): Promise<TextBlock[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input as any);

  const sheets = config?.sheets ?? 'all';
  const blocks: TextBlock[] = [];

  workbook.eachSheet((worksheet, sheetId) => {
    if (sheets === 'first' && sheetId > 1) return;
    if (Array.isArray(sheets) && !sheets.includes(sheetId)) return;

    const rows: string[] = [];
    worksheet.eachRow((row) => {
      const cells = row.values as any[];
      // row.values is 1-indexed, first element is undefined
      const values = cells.slice(1).map((v: any) => (v != null ? String(v) : ''));
      rows.push(values.join(','));
    });

    blocks.push({
      text: rows.join('\n'),
      source: { ...source, format: 'xlsx', sheet: worksheet.name },
      isVisual: false,
    });
  });

  return blocks;
}
