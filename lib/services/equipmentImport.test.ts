import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no database in unit tests'); } }));

import ExcelJS from 'exceljs';
import { buildTemplate, checkTable, importChoices, type ExistingEquipment } from './equipmentImport';
import { cellText, headerKeys, readWorkbook } from './core/importKit';
import { IMPORT_COLUMNS } from '@/lib/equipmentImport';
import { AppError } from '@/lib/errors';
import type { Usage } from '@/lib/types';
import { TYPE_OF_PART, makeLookups, named } from './testing/fixtures';

const lookups = makeLookups();
const HEADERS = headerKeys(IMPORT_COLUMNS);

async function loadTemplate(language: 'vi' | 'en' = 'vi') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildTemplate(lookups, language, new Date('2026-10-02T03:00:00Z'))) as unknown as ArrayBuffer);
  return wb;
}

/** Điền file mẫu như người dùng: nhập từ dòng 2 của sheet Equipment. */
async function filledTemplate(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = await loadTemplate();
  const ws = wb.getWorksheet('Equipment')!;
  rows.forEach((values, i) => values.forEach((v, c) => { if (v !== null) ws.getCell(2 + i, c + 1).value = v; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** id cố định cho dòng mới: new-1, new-2… (theo thứ tự dòng). */
const ids = () => { let n = 0; return () => `new-${++n}`; };

const check = async (rows: (string | number | null)[][], existing: ExistingEquipment[] = [], serials?: string[]) =>
  checkTable(await readWorkbook(await filledTemplate(rows), HEADERS), lookups, existing, serials ?? existing.map((e) => e.serial_number), ids());

const eq = (id: string, serial: string, part: string | null, location: string, level: string | null = null, usage: Usage = 'not_in_use'): ExistingEquipment =>
  ({ id, serial_number: serial, part_number_id: part, type_id: part ? TYPE_OF_PART[part] ?? null : null, location_id: location, level_id: level, usage });

/** Một dòng file mẫu; mặc định chỉ có Serial + Part number (P12316 = Tester) + Location + Level 1 khi không có cha (Level bắt buộc khi không có cha; có cha thì theo cha). */
type Cells = {
  sn?: string | null; pn?: string | null; jabil?: string; asset?: string; type?: string; level?: string | number | null;
  loc?: string | null; parent?: string; parentPn?: string; remark?: string; usage?: string; tags?: string;
};
const line = (c: Cells): (string | number | null)[] => [
  c.sn === undefined ? 'SN-X' : c.sn, c.pn === undefined ? 'P12316' : c.pn, c.jabil ?? null, c.asset ?? null, c.type ?? null, c.level === undefined ? (c.parent ? null : '1') : c.level,
  c.usage ?? null, c.loc === undefined ? 'B3F1' : c.loc, c.parent ?? null, c.parentPn ?? null, c.tags ?? null, c.remark ?? null,
];

const GOOD = () => line({ sn: 'SN-001', pn: 'P12316', jabil: 'J1', asset: 'A-01', type: 'Tester', level: '3' });
const issues = (report: { rows: { row: number; issues: unknown[] }[] }) => report.rows.map((r) => [r.row, r.issues]);

describe('equipment import template — theo Configuration lúc tải', () => {
  it('has the entry sheet first, then valid values — no guide sheet', async () => {
    expect((await loadTemplate('vi')).worksheets.map((w) => w.name)).toEqual(['Equipment', 'Giá trị hợp lệ']);
    expect((await loadTemplate('en')).worksheets.map((w) => w.name)).toEqual(['Equipment', 'Valid values']);
  });

  it('row 1 is the header with * on required columns, with nothing else above or beside it', async () => {
    const ws = (await loadTemplate()).getWorksheet('Equipment')!;
    const header = (c: number) => cellText(ws.getCell(1, c).value);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(header)).toEqual([
      'Serial number *', 'Part number *', 'Jabil ID', 'Asset', 'Type', 'Level *', 'Status', 'Location *',
      'Parent serial number', 'Parent part number', 'Tags', 'Remark',
    ]);
    expect(ws.getCell('M1').value).toBeNull();
    expect(ws.getCell('A2').value).toBeNull();
  });

  it('list columns get a drop-down from the valid values sheet, text columns a length limit', async () => {
    const wb = await loadTemplate();
    const ws = wb.getWorksheet('Equipment')!;
    expect(ws.getCell('F2').dataValidation).toMatchObject({ type: 'list', formulae: ["'Giá trị hợp lệ'!$C$2:$C$6"] });
    expect(ws.getCell('F1001').dataValidation.type).toBe('list');
    expect(ws.getCell('A2').dataValidation).toMatchObject({ type: 'textLength', operator: 'lessThanOrEqual', formulae: [200] });
    expect(ws.getCell('L2').dataValidation.formulae).toEqual([1000]);
    // Status: danh sách cố định In use / Not in use.
    expect(ws.getCell('G2').dataValidation).toMatchObject({ type: 'list', formulae: ["'Giá trị hợp lệ'!$D$2:$D$3"], errorStyle: 'stop' });
    // Tags nhận nhiều giá trị trong một ô ("Repair; Spare"): một ô thả xuống chỉ nhận một giá trị nên không có kiểm tra danh sách.
    expect(ws.getCell('K2').dataValidation.type).toBe('any');
    // Part number của cha dùng chung danh sách Part number, chỉ cảnh báo (mã đã ẩn vẫn tìm được).
    expect(ws.getCell('J2').dataValidation).toMatchObject({ type: 'list', formulae: ["'Giá trị hợp lệ'!$A$2:$A$4"], errorStyle: 'warning' });

    const values = wb.getWorksheet('Giá trị hợp lệ')!;
    const column = (c: number) => (values.getColumn(c).values as ExcelJS.CellValue[]).slice(1).map((v) => cellText(v));
    expect(column(1)).toEqual(['Part number', 'P12316', 'P20001', 'B-100']);
    expect(column(2)).toEqual(['Type', 'Tester', 'Fixture', 'Base']);
    expect(column(4)).toEqual(['Status', 'In use', 'Not in use']);
    expect(column(5)).toEqual(['Location', 'B3F1', 'B3F2']);
    expect(column(6)).toEqual(['Tags', 'Repair', 'Spare']);
  });

  it('follows Configuration at download time — a new level shows up in the next template', async () => {
    const more = makeLookups({ levels: named('level', [['1'], ['2'], ['3'], ['4'], ['5'], ['6']]) });
    expect(importChoices(more).levels).toEqual(['1', '2', '3', '4', '5', '6']);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildTemplate(more, 'en')) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Equipment')!.getCell('F2').dataValidation.formulae).toEqual(["'Valid values'!$C$2:$C$7"]);
  });
});

describe('equipment import check — cùng quy tắc với form Thêm thiết bị', () => {
  it('maps every column of a valid row to ids, matching names case-insensitively', async () => {
    const { report, inserts } = await check([
      GOOD(), line({ sn: 'SN-002', pn: 'p20001', type: 'fixture', level: 5, loc: 'b3f2', remark: 'ok' }),
    ]);
    expect(report).toMatchObject({ total: 2, valid: 2, invalid: 0, duplicates: 0, rows: [], ignored_columns: [] });
    expect(inserts).toEqual([
      { id: 'new-1', serial_number: 'SN-001', part_number_id: 'pn-0', jabil_id: 'J1', asset: 'A-01', type_id: 'type-0', level_id: 'level-2', location_id: 'loc-0', parent_id: null, remark: null, usage: 'not_in_use', tag_ids: [] },
      { id: 'new-2', serial_number: 'SN-002', part_number_id: 'pn-1', jabil_id: null, asset: null, type_id: 'type-1', level_id: 'level-4', location_id: 'loc-1', parent_id: null, remark: 'ok', usage: 'not_in_use', tag_ids: [] },
    ]);
  });

  it('reports each bad cell with its Excel row number', async () => {
    const { report, inserts } = await check([
      GOOD(),
      line({ sn: null, pn: 'P12316', level: '6', loc: null }),
      line({ sn: 'SN-003', pn: 'OLD-PN', loc: 'Closed' }),
      line({ sn: 'x'.repeat(201) }),
    ]);
    expect(report).toMatchObject({ total: 4, valid: 1, invalid: 3 });
    expect(inserts).toHaveLength(1);
    expect(issues(report)).toEqual([
      [3, [{ column: 'serial_number', code: 'required' }, { column: 'level_id', code: 'not_found', value: '6' }, { column: 'location_id', code: 'required' }]],
      [4, [{ column: 'part_number_id', code: 'inactive', value: 'OLD-PN' }, { column: 'location_id', code: 'inactive', value: 'Closed' }]],
      [5, [{ column: 'serial_number', code: 'too_long', max: 200 }]],
    ]);
  });

  it('a part number of sub-equipment is refused here (wrong_kind) — sub-equipment have their own import', async () => {
    const { report, inserts } = await check([line({ sn: 'S-1', pn: 'DMM-100' })]);
    expect(inserts).toEqual([]);
    expect(issues(report)).toEqual([[2, [{ column: 'part_number_id', code: 'wrong_kind', value: 'DMM-100' }]]]);
  });

  it('warns (does not block) on duplicate serials in any table or earlier in the file', async () => {
    const { report, inserts } = await check(
      [GOOD(), line({ sn: 'sn-001 ' }), line({ sn: 'SN-OLD' }), line({ sn: 'GB-7' })],
      [eq('old-1', 'SN-old', null, 'loc-0')],
      ['SN-old', 'gb-7'], // serial đã có ở bảng khác (golden board)
    );
    expect(report).toMatchObject({ total: 4, valid: 4, invalid: 0, duplicates: 3 });
    expect(inserts).toHaveLength(4);
    expect(report.rows.map((r) => [r.row, r.duplicate_of])).toEqual([[3, 2], [4, 'existing'], [5, 'existing']]);
  });

  it('skips blank rows and accepts a file whose header is on row 1', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(['SERIAL NUMBER', 'PART NUMBER', 'location', 'level', 'Note']);
    ws.addRow(['SN-1', 'P12316', 'B3F1', '1', 'x']);
    ws.addRow([]);
    ws.addRow(['SN-2', 'p12316', 'B3F2', '2', '']);
    const table = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), HEADERS);
    const { report, inserts } = checkTable(table, lookups, []);
    expect(report).toMatchObject({ total: 2, valid: 2, ignored_columns: ['Note'] });
    expect(inserts.map((r) => r.location_id)).toEqual(['loc-0', 'loc-1']);
    // A file made before the Status and Tags columns existed still imports: Not in use, no tags.
    expect(inserts.map((r) => [r.usage, r.tag_ids])).toEqual([['not_in_use', []], ['not_in_use', []]]);
  });

  it('rejects the whole file when a required column is missing or there are no rows', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Data').addRow(['Serial number', 'Part number']);
    wb.getWorksheet('Data')!.addRow(['SN-1', 'P12316']);
    const table = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), HEADERS);
    expect(() => checkTable(table, lookups, [])).toThrow(AppError);
    try { checkTable(table, lookups, []); } catch (e) {
      // Level và Location đều bắt buộc khi không có cha (file này không có cột Parent).
      expect((e as AppError).details).toEqual({ fields: { file: 'missing_columns' }, columns: ['Level', 'Location'] });
    }
    const empty = await readWorkbook(await filledTemplate([]), HEADERS);
    try { checkTable(empty, lookups, []); throw new Error('expected empty'); } catch (e) {
      expect((e as AppError).details).toEqual({ fields: { file: 'empty' } });
    }
  });

  it('rejects a file that is not a readable workbook', async () => {
    await expect(readWorkbook(Buffer.from('not a zip'), HEADERS)).rejects.toMatchObject({ details: { fields: { file: 'unreadable' } } });
  });
});

describe('equipment import — thiết bị cha (Tester ⊃ Base ⊃ Fixture)', () => {
  const TESTER = eq('t-1', 'TESTER-01', 'pn-0', 'loc-1', 'level-1'); // Tester ở B3F2, Level 2
  const BASE = eq('b-1', 'BASE-01', 'pn-3', 'loc-1', 'level-1');

  it('attaches a Fixture or Base to an existing Tester; location follows the parent', async () => {
    const { report, inserts } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'tester-01' }),
      line({ sn: 'BS-1', pn: 'B-100', loc: null, parent: 'TESTER-01' }),
    ], [TESTER]);
    expect(report).toMatchObject({ valid: 2, invalid: 0 });
    expect(inserts.map((r) => [r.parent_id, r.location_id])).toEqual([['t-1', 'loc-1'], ['t-1', 'loc-1']]);
  });

  it('attaches to another row of the file, whatever the row order, down a whole chain', async () => {
    const { report, inserts } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'BS-1' }), // cháu — dòng đầu tiên
      line({ sn: 'BS-1', pn: 'B-100', loc: null, parent: 'TS-1' }),
      line({ sn: 'TS-1', pn: 'P12316', loc: 'B3F2' }),
    ]);
    expect(report).toMatchObject({ valid: 3, invalid: 0 });
    expect(inserts.map((r) => [r.id, r.parent_id, r.location_id])).toEqual([
      ['new-1', 'new-2', 'loc-1'], ['new-2', 'new-3', 'loc-1'], ['new-3', null, 'loc-1'],
    ]);
  });

  it("accepts a Location equal to the parent's, rejects a different one", async () => {
    const { report } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: 'B3F2', parent: 'TESTER-01' }),
      line({ sn: 'FX-2', pn: 'P20001', loc: 'B3F1', parent: 'TESTER-01' }),
    ], [TESTER]);
    expect(issues(report)).toEqual([[3, [{ column: 'location_id', code: 'location_follows_parent', value: 'B3F2' }]]]);
  });

  it('refuses a parent of the wrong kind — the tree rule is checked before the database sees the file', async () => {
    const { report, inserts } = await check([
      line({ sn: 'TS-2', pn: 'P12316', loc: null, parent: 'TESTER-01' }), // Tester không có cha
      line({ sn: 'BS-2', pn: 'B-100', loc: null, parent: 'BASE-01' }), // Base dưới Base
      line({ sn: 'FX-3', pn: 'P20001', loc: null, parent: 'BASE-01' }), // Fixture dưới Base: được
      line({ sn: 'FX-4', pn: 'P20001', loc: null, parent: 'FX-3' }), // Fixture dưới Fixture
    ], [TESTER, BASE]);
    expect(issues(report)).toEqual([
      [2, [{ column: 'parent_serial', code: 'parent_type_invalid', value: 'TESTER-01' }]],
      [3, [{ column: 'parent_serial', code: 'parent_type_invalid', value: 'BASE-01' }]],
      [5, [{ column: 'parent_serial', code: 'parent_type_invalid', value: 'FX-3' }]],
    ]);
    expect(inserts.map((r) => r.serial_number)).toEqual(['FX-3']);
  });

  it('reports a parent that is missing or ambiguous', async () => {
    const twins = [eq('x-1', 'TWIN', 'pn-0', 'loc-0'), eq('x-2', 'TWIN', 'pn-0', 'loc-1')];
    const { report } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'NOPE' }),
      line({ sn: 'FX-2', pn: 'P20001', loc: null, parent: 'TWIN' }),
      line({ sn: 'FX-3', pn: 'P20001', parentPn: 'P12316' }),
    ], twins);
    expect(issues(report)).toEqual([
      [2, [{ column: 'parent_serial', code: 'parent_not_found', value: 'NOPE' }]],
      [3, [{ column: 'parent_serial', code: 'parent_ambiguous', value: 'TWIN', count: 2 }]],
      [4, [{ column: 'parent_serial', code: 'required' }]],
    ]);
  });

  it('Parent part number picks one of several parents sharing a serial (hidden part numbers included)', async () => {
    const twins = [eq('x-1', 'TWIN', 'pn-0', 'loc-0'), eq('x-2', 'TWIN', 'pn-2', 'loc-1')]; // pn-2 = OLD-PN (đã ẩn, vẫn là Tester)
    const { report, inserts } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'twin', parentPn: 'old-pn' }),
      line({ sn: 'FX-2', pn: 'P20001', loc: null, parent: 'TWIN', parentPn: 'P20001' }),
    ], twins);
    expect(inserts[0]).toMatchObject({ parent_id: 'x-2', location_id: 'loc-1' });
    expect(issues(report)).toEqual([[3, [{ column: 'parent_serial', code: 'parent_not_found', value: 'TWIN · P20001' }]]]);
  });

  it('a file without Level and Location columns is fine when every row has a parent (both follow the parent)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(['Serial number', 'Part number', 'Parent serial number']);
    ws.addRow(['FX-1', 'P20001', 'TESTER-01']);
    ws.addRow(['FX-2', 'P20001', '']);
    const { report } = checkTable(await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), HEADERS), lookups, [TESTER]);
    // FX-2 không có cha: Level và Location bắt buộc.
    expect(issues(report)).toEqual([[3, [{ column: 'level_id', code: 'required' }, { column: 'location_id', code: 'required' }]]]);
  });

  it('a row without a parent needs a Level too — the same rule as the form', async () => {
    const { report } = await check([line({ sn: 'NO-LEVEL', level: null })]);
    expect(issues(report)).toEqual([[2, [{ column: 'level_id', code: 'required' }]]]);
  });
});

describe('equipment import — Type theo part number', () => {
  it("a blank Type takes the part number's Type; the same Type is fine; another Type is an error", async () => {
    const { report, inserts } = await check([
      line({ sn: 'A', pn: 'P12316' }),
      line({ sn: 'B', pn: 'P12316', type: 'tester' }),
      line({ sn: 'C', pn: 'P12316', type: 'Fixture' }),
      line({ sn: 'D', pn: 'P20001', type: 'Fixture' }),
      line({ sn: 'E', pn: null }),
    ]);
    expect(issues(report)).toEqual([
      [4, [{ column: 'type_id', code: 'type_follows_part_number', value: 'Tester' }]],
      [6, [{ column: 'part_number_id', code: 'required' }]],
    ]);
    expect(inserts.map((r) => [r.serial_number, r.type_id])).toEqual([['A', 'type-0'], ['B', 'type-0'], ['D', 'type-1']]);
  });

  it('a Type that is not in Configuration at all is reported once, as "follows the part number"', async () => {
    const { report } = await check([line({ sn: 'A', pn: 'P12316', type: 'Nonsense' })]);
    expect(report.rows[0]!.issues).toEqual([{ column: 'type_id', code: 'type_follows_part_number', value: 'Tester' }]);
  });

  it("the part number's Type is accepted even after the admin hid that Type", async () => {
    const hidden = makeLookups();
    hidden.types.set('type-0', { ...hidden.types.get('type-0')!, is_active: false });
    const table = await readWorkbook(await filledTemplate([line({ sn: 'A', pn: 'P12316', type: 'Tester' }), line({ sn: 'B', pn: 'P12316' })]), HEADERS);
    const { report, inserts } = checkTable(table, hidden, [], [], ids());
    expect(report.rows).toEqual([]);
    expect(inserts.map((r) => r.type_id)).toEqual(['type-0', 'type-0']);
  });
});

describe('equipment import — Level theo thiết bị cha', () => {
  const TESTER = eq('t-1', 'TESTER-01', 'pn-0', 'loc-1', 'level-1');

  it("a child takes the parent's Level (existing equipment or another row, down the chain); a different Level is an error", async () => {
    const { report, inserts } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'TESTER-01' }),
      line({ sn: 'FX-2', pn: 'P20001', loc: null, parent: 'TESTER-01', level: '2' }),
      line({ sn: 'FX-3', pn: 'P20001', loc: null, parent: 'TESTER-01', level: '5' }),
      line({ sn: 'FX-4', pn: 'P20001', loc: null, parent: 'BS-1' }),
      line({ sn: 'BS-1', pn: 'B-100', level: '1' }),
    ], [TESTER]);
    expect(issues(report)).toEqual([
      [4, [{ column: 'level_id', code: 'level_follows_parent', value: '2' }]],
    ]);
    // FX-4 (Fixture) dưới BS-1 (Base) mang Level của BS-1; BS-1 không có cha nên giữ Level 1.
    expect(inserts.map((r) => [r.serial_number, r.level_id])).toEqual([
      ['FX-1', 'level-1'], ['FX-2', 'level-1'], ['FX-4', 'level-0'], ['BS-1', 'level-0'],
    ]);
  });

  it('a Level that is not in Configuration is reported once, as "follows the parent"; a parent without Level gives —', async () => {
    const { report } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'TESTER-01', level: 'Nope' }),
      line({ sn: 'FX-2', pn: 'P20001', loc: null, parent: 'BARE', level: '1' }),
    ], [TESTER, eq('bare-1', 'BARE', 'pn-0', 'loc-0')]);
    expect(issues(report)).toEqual([
      [2, [{ column: 'level_id', code: 'level_follows_parent', value: '2' }]],
      [3, [{ column: 'level_id', code: 'level_follows_parent', value: '—' }]],
    ]);
  });
});

describe('equipment import — Status (In use / Not in use)', () => {
  const TESTER_IN = eq('t-in', 'TESTER-IN', 'pn-0', 'loc-1', 'level-1', 'in_use');
  const TESTER_OUT = eq('t-out', 'TESTER-OUT', 'pn-0', 'loc-1', 'level-1', 'not_in_use');

  it('a blank Status is Not in use; In use, in_use and INUSE all mean In use (case, spaces and underscores do not matter)', async () => {
    const { report, inserts } = await check([
      line({ sn: 'A' }), line({ sn: 'B', usage: 'In use' }), line({ sn: 'C', usage: 'in_use' }), line({ sn: 'D', usage: ' INUSE ' }),
      line({ sn: 'E', usage: 'Not in use' }), line({ sn: 'F', usage: 'not_in_use' }),
    ]);
    expect(report.rows).toEqual([]);
    expect(inserts.map((r) => r.usage)).toEqual(['not_in_use', 'in_use', 'in_use', 'in_use', 'not_in_use', 'not_in_use']);
  });

  it('anything else is an error on the Status cell', async () => {
    const { report, inserts } = await check([line({ sn: 'A', usage: 'maybe' })]);
    expect(inserts).toEqual([]);
    expect(issues(report)).toEqual([[2, [{ column: 'usage', code: 'usage_invalid', value: 'maybe' }]]]);
  });

  it('only a Tester can be In use without a parent — the same rule as the database (USAGE_NEEDS_PARENT)', async () => {
    const { report, inserts } = await check([
      line({ sn: 'TS', pn: 'P12316', usage: 'In use' }), // Tester: được
      line({ sn: 'BS', pn: 'B-100', usage: 'In use' }), // Base không cha: không
      line({ sn: 'FX', pn: 'P20001', usage: 'Not in use' }),
    ]);
    expect(issues(report)).toEqual([[3, [{ column: 'usage', code: 'usage_needs_parent', value: 'In use' }]]]);
    expect(inserts.map((r) => [r.serial_number, r.usage])).toEqual([['TS', 'in_use'], ['FX', 'not_in_use']]);
  });

  it("a child follows its parent's Status — blank takes it (existing parent, or a row of the file, down a whole chain)", async () => {
    const { report, inserts } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'TESTER-IN' }), // cha có sẵn đang In use
      line({ sn: 'FX-2', pn: 'P20001', loc: null, parent: 'TESTER-OUT' }),
      line({ sn: 'FX-3', pn: 'P20001', loc: null, parent: 'BS-1' }), // cháu — trước dòng cha trong file
      line({ sn: 'BS-1', pn: 'B-100', loc: null, parent: 'TS-1' }),
      line({ sn: 'TS-1', pn: 'P12316', loc: 'B3F2', usage: 'In use' }),
    ], [TESTER_IN, TESTER_OUT]);
    expect(report.rows).toEqual([]);
    expect(inserts.map((r) => [r.serial_number, r.usage])).toEqual([
      ['FX-1', 'in_use'], ['FX-2', 'not_in_use'], ['FX-3', 'in_use'], ['BS-1', 'in_use'], ['TS-1', 'in_use'],
    ]);
  });

  it("a Status that differs from the parent's is one error that names the parent's Status (like Location and Level); the same Status is fine", async () => {
    const { report } = await check([
      line({ sn: 'FX-1', pn: 'P20001', loc: null, parent: 'TESTER-IN', usage: 'In use' }), // trùng cha: được
      line({ sn: 'FX-2', pn: 'P20001', loc: null, parent: 'TESTER-IN', usage: 'Not in use' }),
      line({ sn: 'FX-3', pn: 'P20001', loc: null, parent: 'TESTER-OUT', usage: 'In use' }),
    ], [TESTER_IN, TESTER_OUT]);
    expect(issues(report)).toEqual([
      [3, [{ column: 'usage', code: 'usage_follows_parent', value: 'In use' }]],
      [4, [{ column: 'usage', code: 'usage_follows_parent', value: 'Not in use' }]],
    ]);
  });

  it('a row whose parent could not be found does not also complain about Status (the parent error is enough)', async () => {
    const { report } = await check([line({ sn: 'BS', pn: 'B-100', loc: null, parent: 'NOPE', usage: 'In use' })]);
    expect(issues(report)).toEqual([[2, [{ column: 'parent_serial', code: 'parent_not_found', value: 'NOPE' }]]]);
  });
});

describe('equipment import — Tags', () => {
  it('names (case-insensitive) separated by ; or a comma become tag ids in the order written; a repeated tag counts once', async () => {
    const { report, inserts } = await check([
      line({ sn: 'A', tags: 'Spare; repair' }), line({ sn: 'B', tags: 'REPAIR, Spare ,repair' }), line({ sn: 'C', tags: 'Repair' }), line({ sn: 'D' }),
      line({ sn: 'E', tags: ' ; ' }),
    ]);
    expect(report.rows).toEqual([]);
    expect(inserts.map((r) => r.tag_ids)).toEqual([['tg2', 'tg1'], ['tg1', 'tg2'], ['tg1'], [], []]);
  });

  it('a tag that is not in Configuration is one error on the Tags cell listing every unknown name; nothing is created', async () => {
    const { report, inserts } = await check([line({ sn: 'A', tags: 'Repair; Nope; Gone' }), line({ sn: 'B', tags: 'Spare' })]);
    expect(issues(report)).toEqual([[2, [{ column: 'tag_ids', code: 'not_found', value: 'Nope, Gone' }]]]);
    expect(inserts.map((r) => r.serial_number)).toEqual(['B']);
  });

  it('a child may have tags of its own (they are not inherited)', async () => {
    const { inserts } = await check([line({ sn: 'FX', pn: 'P20001', loc: null, parent: 'TS', tags: 'Spare' }), line({ sn: 'TS', pn: 'P12316', tags: 'Repair' })]);
    expect(inserts.map((r) => [r.serial_number, r.tag_ids])).toEqual([['FX', ['tg2']], ['TS', ['tg1']]]);
  });

  it('the template lists the tags of Configuration at download time', () => {
    const more = makeLookups();
    more.tags.set('tg3', { id: 'tg3', display_name: 'Waiting', sort_order: 3, color: 'blue' });
    expect(importChoices(more).tags).toEqual(['Repair', 'Spare', 'Waiting']);
    expect(importChoices(more, 'vi').usages).toEqual(['In use', 'Not in use']);
  });
});
