import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no database in unit tests'); } }));

import ExcelJS from 'exceljs';
import { buildSubTemplate, checkSubTable, subImportChoices, type ExistingEquipmentRef } from './subEquipmentImport';
import { cellText, headerKeys, readWorkbook } from './core/importKit';
import { SUB_IMPORT_COLUMNS } from '@/lib/subEquipmentImport';
import { TYPE_OF_PART, makeLookups } from './testing/fixtures';

const lookups = makeLookups();
const HEADERS = headerKeys(SUB_IMPORT_COLUMNS);

async function loadTemplate(language: 'vi' | 'en' = 'vi') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildSubTemplate(lookups, language, new Date('2026-10-05T03:00:00Z'))) as unknown as ArrayBuffer);
  return wb;
}

/** Điền file mẫu như người dùng: nhập từ dòng 2 của sheet Calibration. */
async function filledTemplate(rows: (string | null)[][]): Promise<Buffer> {
  const wb = await loadTemplate();
  const ws = wb.getWorksheet('Calibration')!;
  rows.forEach((values, i) => values.forEach((v, c) => { if (v !== null) ws.getCell(2 + i, c + 1).value = v; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const equipment = (id: string, serial: string, part: string, location: string): ExistingEquipmentRef =>
  ({ id, serial_number: serial, part_number_id: part, type_id: TYPE_OF_PART[part] ?? null, location_id: location });

const TESTER = equipment('t-1', 'TESTER-01', 'pn-0', 'loc-1');

const check = async (rows: (string | null)[][], eqs: ExistingEquipmentRef[] = [TESTER], serials: string[] = eqs.map((e) => e.serial_number)) =>
  checkSubTable(await readWorkbook(await filledTemplate(rows), HEADERS), lookups, eqs, serials);

/** Một dòng file mẫu: Serial, Part number (mặc định DMM-100), Jabil ID, Asset, Type, Location, Tester serial, Tester part number, Remark. */
type Cells = {
  sn?: string | null; pn?: string | null; jabil?: string; asset?: string; type?: string; loc?: string | null;
  tester?: string; testerPn?: string; remark?: string;
};
const line = (c: Cells): (string | null)[] => [
  c.sn === undefined ? 'SN-DMM-1' : c.sn, c.pn === undefined ? 'DMM-100' : c.pn, c.jabil ?? null, c.asset ?? null, c.type ?? null,
  c.loc === undefined ? 'B3F1' : c.loc, c.tester ?? null, c.testerPn ?? null, c.remark ?? null,
];
const issues = (report: { rows: { row: number; issues: unknown[] }[] }) => report.rows.map((r) => [r.row, r.issues]);

describe('sub-equipment import template', () => {
  it('has the Calibration / Valid values sheets with the column headers on row 1', async () => {
    const wb = await loadTemplate('en');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Calibration', 'Valid values']);
    const ws = wb.getWorksheet('Calibration')!;
    expect(SUB_IMPORT_COLUMNS.map((_c, i) => cellText(ws.getCell(1, i + 1).value).replace(/ \*$/, ''))).toEqual(SUB_IMPORT_COLUMNS.map((c) => c.header));
  });

  it('lists only sub-equipment part numbers and Types; the tester part number column lists tester part numbers', async () => {
    expect(subImportChoices(lookups)).toEqual({ part_numbers: ['DMM-100'], types: ['DMM'], locations: ['B3F1', 'B3F2'] });
    const values = (await loadTemplate()).getWorksheet('Giá trị hợp lệ')!;
    const column = (c: number) => (values.getColumn(c).values as ExcelJS.CellValue[]).slice(1).map((v) => cellText(v));
    expect(column(1)).toEqual(['Part number', 'DMM-100']);
    expect(column(4).slice(0, 1)).toEqual(['Tester part number']);
    expect(column(4)).toContain('P12316');
    expect(column(4)).not.toContain('DMM-100');
  });
});

describe('sub-equipment import check — cùng quy tắc với form Thêm sub-equipment', () => {
  it('maps a valid row to ids; a loose sub-equipment needs a Location', async () => {
    const { report, inserts } = await check([line({ jabil: 'J1', asset: 'A-1', type: 'DMM', remark: 'ok' }), line({ sn: 'SN-DMM-2', loc: null })]);
    expect(issues(report)).toEqual([[3, [{ column: 'location_id', code: 'required' }]]]);
    expect(inserts).toEqual([{
      serial_number: 'SN-DMM-1', part_number_id: 'pn-4', jabil_id: 'J1', asset: 'A-1', type_id: 'type-3', location_id: 'loc-0',
      tester_id: null, remark: 'ok',
    }]);
  });

  it('the part number must be a sub-equipment one (wrong_kind), and Type follows the part number', async () => {
    const { report, inserts } = await check([
      line({ sn: 'A', pn: 'P12316' }), // part number của tester
      line({ sn: 'B', type: 'Tester' }), // Type khác với Type của part number
      line({ sn: 'C', pn: 'DMM-OLD' }), // part number đã ẩn
    ]);
    expect(inserts).toEqual([]);
    expect(issues(report)).toEqual([
      [2, [{ column: 'part_number_id', code: 'wrong_kind', value: 'P12316' }]],
      [3, [{ column: 'type_id', code: 'type_follows_part_number', value: 'DMM' }]],
      [4, [{ column: 'part_number_id', code: 'inactive', value: 'DMM-OLD' }]],
    ]);
  });

  it('attaches to an existing Tester by serial; the location follows the tester', async () => {
    const { report, inserts } = await check([line({ sn: 'SN-1', loc: null, tester: 'tester-01' }), line({ sn: 'SN-2', loc: 'B3F2', tester: 'TESTER-01' })]);
    expect(report).toMatchObject({ valid: 2, invalid: 0 });
    expect(inserts.map((r) => [r.tester_id, r.location_id])).toEqual([['t-1', 'loc-1'], ['t-1', 'loc-1']]);
  });

  it('refuses a different Location, a missing/ambiguous tester and a parent that is not a Tester', async () => {
    const eqs = [TESTER, equipment('f-1', 'FIX-01', 'pn-1', 'loc-0'), equipment('x-1', 'TWIN', 'pn-0', 'loc-0'), equipment('x-2', 'TWIN', 'pn-0', 'loc-1')];
    const { report } = await check([
      line({ sn: 'S1', loc: 'B3F1', tester: 'TESTER-01' }),
      line({ sn: 'S2', loc: null, tester: 'NOPE' }),
      line({ sn: 'S3', loc: null, tester: 'TWIN' }),
      line({ sn: 'S4', loc: null, tester: 'FIX-01' }),
      line({ sn: 'S5', testerPn: 'P12316' }),
    ], eqs);
    expect(issues(report)).toEqual([
      [2, [{ column: 'location_id', code: 'location_follows_parent', value: 'B3F2' }]],
      [3, [{ column: 'tester_serial', code: 'parent_not_found', value: 'NOPE' }]],
      [4, [{ column: 'tester_serial', code: 'parent_ambiguous', value: 'TWIN', count: 2 }]],
      [5, [{ column: 'tester_serial', code: 'parent_type_invalid', value: 'FIX-01' }]],
      [6, [{ column: 'tester_serial', code: 'required' }]],
    ]);
  });

  it('warns on duplicate serials in any table (equipment, golden) or earlier in the file, but accepts them', async () => {
    const { report, inserts } = await check([line({ sn: 'SN-A' }), line({ sn: 'sn-a ' }), line({ sn: 'GB-1' })], [TESTER], ['TESTER-01', 'gb-1']);
    expect(report).toMatchObject({ total: 3, valid: 3, duplicates: 2 });
    expect(inserts).toHaveLength(3);
    expect(report.rows.map((r) => [r.row, r.duplicate_of])).toEqual([[3, 2], [4, 'existing']]);
  });

  it('rejects a file missing a required column', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Data').addRow(['Serial number', 'Part number']);
    wb.getWorksheet('Data')!.addRow(['S1', 'DMM-100']);
    const table = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), HEADERS);
    expect(() => checkSubTable(table, lookups, [], [])).toThrow();
    try { checkSubTable(table, lookups, [], []); } catch (e) {
      expect((e as { details: unknown }).details).toEqual({ fields: { file: 'missing_columns' }, columns: ['Location'] });
    }
  });
});
