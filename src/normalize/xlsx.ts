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

    const mdRows: string[] = [];
    let isFirstRow = true;

    worksheet.eachRow((row) => {
      const cells = row.values as any[];
      const values = cells.slice(1).map((v: any) => (v != null ? String(v) : ''));
      mdRows.push('| ' + values.join(' | ') + ' |');

      if (isFirstRow) {
        mdRows.push('| ' + values.map(() => '---').join(' | ') + ' |');
        isFirstRow = false;
      }
    });

    blocks.push({
      text: mdRows.join('\n'),
      source: { ...source, format: 'xlsx', sheet: worksheet.name },
      isVisual: false,
    });
  });

  return blocks;
}
