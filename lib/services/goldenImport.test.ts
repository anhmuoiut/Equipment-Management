import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no database in unit tests'); } }));

import ExcelJS from 'exceljs';
import { buildGoldenTemplate, checkGoldenTable, goldenImportChoices } from './goldenImport';
import { cellText, headerKeys, readWorkbook } from './core/importKit';
import type { ExistingEquipment } from './equipmentImport';
import { GOLDEN_IMPORT_COLUMNS } from '@/lib/goldenImport';
import { AppError } from '@/lib/errors';
import { TYPE_OF_PART, makeLookups } from './testing/fixtures';

const lookups = makeLookups();

/** Điền file mẫu như người dùng: nhập từ dòng 2 của sheet Golden. */
async function filledTemplate(rows: (string | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildGoldenTemplate(lookups, 'vi', new Date('2026-10-04T03:00:00Z'))) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Golden')!;
  rows.forEach((values, i) => values.forEach((v, c) => { if (v !== null) ws.getCell(2 + i, c + 1).value = v; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEADERS = headerKeys(GOLDEN_IMPORT_COLUMNS);
const eq = (id: string, serial: string, part: string, location: string): ExistingEquipment =>
  ({ id, serial_number: serial, part_number_id: part, type_id: TYPE_OF_PART[part] ?? null, location_id: location, level_id: null, usage: 'not_in_use' });
const TESTER = eq('t-1', 'TESTER-01', 'pn-0', 'loc-1');
const FIXTURE = eq('f-1', 'FIX-01', 'pn-1', 'loc-0');
const BASE = eq('b-1', 'BASE-01', 'pn-3', 'loc-0');

const check = async (rows: (string | null)[][], existing: string[] = [], equipment: ExistingEquipment[] = [TESTER, FIXTURE, BASE]) =>
  checkGoldenTable(await readWorkbook(await filledTemplate(rows), HEADERS), lookups, equipment, existing);

/** Một dòng file mẫu: Part, Serial, UTD, Location, Origin, Purpose, Parent serial, Parent part number, Remark. */
type Cells = {
  pn?: string | null; sn?: string | null; utd?: string; loc?: string | null; origin?: string; purpose?: string;
  parent?: string; parentPn?: string; remark?: string;
};
const line = (c: Cells): (string | null)[] => [
  c.pn === undefined ? 'P1' : c.pn, c.sn === undefined ? 'G-1' : c.sn, c.utd ?? null,
  c.loc === undefined ? 'B3F1' : c.loc,
  c.origin ?? null, c.purpose ?? null, c.parent ?? null, c.parentPn ?? null, c.remark ?? null,
];
const issues = (report: { rows: { row: number; issues: unknown[] }[] }) => report.rows.map((r) => [r.row, r.issues]);

describe('golden import template', () => {
  it('has the Golden / Valid values sheets with the column headers on row 1', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildGoldenTemplate(lookups, 'en')) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Golden', 'Valid values']);
    const header = wb.getWorksheet('Golden')!.getRow(1);
    expect(GOLDEN_IMPORT_COLUMNS.map((_c, i) => cellText(header.getCell(i + 1).value).replace(/ \*$/, ''))).toEqual(GOLDEN_IMPORT_COLUMNS.map((c) => c.header));
  });

  it('lists only usable locations, and tester / fixture part numbers for the parent', async () => {
    expect(goldenImportChoices(lookups)).toEqual({ locations: ['B3F1', 'B3F2'], part_numbers: ['P12316', 'P20001'] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildGoldenTemplate(lookups, 'en')) as unknown as ArrayBuffer);
    const vs = wb.getWorksheet('Valid values')!;
    expect([2, 3, 4].map((r) => vs.getCell(r, 1).value)).toEqual(['B3F1', 'B3F2', null]);
  });
});

describe('checkGoldenTable', () => {
  it('maps a valid row to ids and trims text', async () => {
    const { report, inserts } = await check([line({ pn: ' P1 ', loc: 'b3f2', origin: 'Lab', purpose: 'Calibrate', utd: 'U-9' })]);
    expect(report).toMatchObject({ total: 1, valid: 1, invalid: 0, duplicates: 0, rows: [] });
    expect(inserts).toEqual([{
      part_number: 'P1', serial_number: 'G-1', utd_part_number: 'U-9', location_id: 'loc-1', origin: 'Lab', purpose: 'Calibrate',
      parent_id: null, remark: null,
    }]);
  });

  it('reports required cells by column and row; a loose golden board needs a Location', async () => {
    const { report, inserts } = await check([line({ pn: null, sn: null, loc: null, origin: 'Lab' })]);
    expect(inserts).toEqual([]);
    expect(issues(report)).toEqual([[2, [
      { column: 'part_number', code: 'required' }, { column: 'serial_number', code: 'required' }, { column: 'location_id', code: 'required' },
    ]]]);
  });

  it('rejects unknown, hidden and too-long values', async () => {
    const { report } = await check([
      line({ loc: 'Nowhere' }), line({ sn: 'G-2', loc: 'Closed' }), line({ sn: 'G-3', purpose: 'p'.repeat(501) }),
    ]);
    expect(issues(report)).toEqual([
      [2, [{ column: 'location_id', code: 'not_found', value: 'Nowhere' }]],
      [3, [{ column: 'location_id', code: 'inactive', value: 'Closed' }]],
      [4, [{ column: 'purpose', code: 'too_long', max: 500 }]],
    ]);
  });

  it('attaches to a Tester or Fixture by serial; the location follows the parent', async () => {
    const { report, inserts } = await check([
      line({ sn: 'G-1', loc: null, parent: 'tester-01' }), line({ sn: 'G-2', loc: 'B3F1', parent: 'FIX-01' }),
    ]);
    expect(report).toMatchObject({ valid: 2, invalid: 0 });
    expect(inserts.map((r) => [r.parent_id, r.location_id])).toEqual([['t-1', 'loc-1'], ['f-1', 'loc-0']]);
  });

  it('refuses a Base as parent, a different Location, a missing or ambiguous parent', async () => {
    const twins = [eq('x-1', 'TWIN', 'pn-0', 'loc-0'), eq('x-2', 'TWIN', 'pn-1', 'loc-1')];
    const { report } = await check([
      line({ sn: 'G-1', loc: null, parent: 'BASE-01' }),
      line({ sn: 'G-2', loc: 'B3F1', parent: 'TESTER-01' }),
      line({ sn: 'G-3', loc: null, parent: 'NOPE' }),
      line({ sn: 'G-4', loc: null, parent: 'TWIN' }),
      line({ sn: 'G-5', loc: null, parent: 'TWIN', parentPn: 'P20001' }),
      line({ sn: 'G-6', parentPn: 'P12316' }),
    ], [], [TESTER, BASE, ...twins]);
    expect(issues(report)).toEqual([
      [2, [{ column: 'parent_serial', code: 'parent_type_invalid', value: 'BASE-01' }]],
      [3, [{ column: 'location_id', code: 'location_follows_parent', value: 'B3F2' }]],
      [4, [{ column: 'parent_serial', code: 'parent_not_found', value: 'NOPE' }]],
      [5, [{ column: 'parent_serial', code: 'parent_ambiguous', value: 'TWIN', count: 2 }]],
      [7, [{ column: 'parent_serial', code: 'required' }]],
    ]);
  });

  it('warns on duplicate serials (any table, or earlier in the file) but still accepts them', async () => {
    const { report, inserts } = await check([line({ sn: 'G-1' }), line({ sn: 'g-1 ' }), line({ sn: 'SN-OLD' })], ['sn-old']);
    expect(report).toMatchObject({ total: 3, valid: 3, invalid: 0, duplicates: 2 });
    expect(inserts).toHaveLength(3);
    expect(report.rows.map((r) => [r.row, r.duplicate_of])).toEqual([[3, 2], [4, 'existing']]);
  });

  it('skips blank rows and counts only filled ones', async () => {
    const { report } = await check([line({ sn: 'G-1' }), [null, null, null, null, null, null, null, null, null], line({ sn: 'G-2' })]);
    expect(report).toMatchObject({ total: 2, valid: 2 });
  });

  it('rejects a file with no data rows', async () => {
    const empty = await readWorkbook(await filledTemplate([]), HEADERS);
    expect(() => checkGoldenTable(empty, lookups, [], [])).toThrow(AppError);
    try { checkGoldenTable(empty, lookups, [], []); } catch (e) {
      expect((e as AppError).details).toEqual({ fields: { file: 'empty' } });
    }
  });

  it('rejects a file missing required columns', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Data').addRow(['Serial number', 'Origin']);
    wb.getWorksheet('Data')!.addRow(['G-1', 'Lab']);
    const table = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), HEADERS);
    try { checkGoldenTable(table, lookups, [], []); throw new Error('expected missing columns'); } catch (e) {
      expect((e as AppError).details).toEqual({ fields: { file: 'missing_columns' }, columns: ['Part number', 'Location'] });
    }
  });

  it('accepts header variants and ignores unknown columns', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(['PART NUMBER', 'serial_number', 'Location', 'UTD Part Number', 'Colour']);
    ws.addRow(['P1', 'G-1', 'b3f1', 'U-1', 'red']);
    const { report, inserts } = checkGoldenTable(await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), HEADERS), lookups, [], []);
    expect(report).toMatchObject({ valid: 1, ignored_columns: ['Colour'] });
    expect(inserts[0]).toMatchObject({ part_number: 'P1', serial_number: 'G-1', location_id: 'loc-0', utd_part_number: 'U-1' });
  });
});
