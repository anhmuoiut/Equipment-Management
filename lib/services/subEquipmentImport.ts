import 'server-only';

/**
 * Import Excel cho Calibration (sub-equipment) — cùng cách làm với Equipment (equipmentImport.ts): file mẫu sinh lúc
 * tải, kiểm tra từng dòng như form Thêm sub-equipment, tất cả hoặc không, database chạy thử (dry run) rồi ghi một lần
 * qua RPC sub_equipment_import (nhật ký CREATE với source = import).
 * Khác Equipment: part number chỉ liệt kê loại sub_equipment; "Tester serial number" gắn vào tester đã có (vị trí theo tester).
 */
import { rpc, selectAll } from './core/db';
import { kindOf, loadLookups, nameOf, partNumberType, type Lookups } from './core/lookups';
import {
  activeNames, bySerial, buildImportTemplate, fileError, findExistingParent, headerKeys, indexBy, normalize, readUpload,
  readWorkbook, serialKey, type Entry, type ParentCandidate, type UploadedFile,
} from './core/importKit';
import { allSerials } from './equipmentImport';
import type { Language } from '@/lib/i18n/text';
import { parentAllowed } from '@/lib/assetTree';
import { SUB_IMPORT_COLUMNS, type SubImportColumnKey } from '@/lib/subEquipmentImport';
import {
  IMPORT_MAX_ROWS, type ImportIssue, type ImportListKey, type ImportReport, type ImportRowReport,
} from '@/lib/equipmentImport';
import type { AssetOpResult } from '@/lib/types';

const HEADER_KEYS = headerKeys(SUB_IMPORT_COLUMNS);
const DATA_SHEET = 'Calibration';

/** Một dòng sẽ ghi — đúng tên cột của bảng sub_equipment. */
export type SubInsertRow = {
  serial_number: string | null; part_number_id: string | null; jabil_id: string | null; asset: string | null;
  type_id: string | null; location_id: string | null; tester_id: string | null; remark: string | null;
};

// ---------------------------------------------------------------------------
// Giá trị chọn được + file mẫu
// ---------------------------------------------------------------------------

type Choices = Record<Exclude<ImportListKey, 'levels' | 'usages' | 'tags'>, string[]>;

/** Part number / Type chỉ của loại sub_equipment; part number của tester (cột Tester part number) lấy từ loại tester. */
export function subImportChoices(lookups: Lookups): Choices {
  const kindIs = (kind: string) => (typeId: string) => kindOf(lookups, typeId) === kind;
  return {
    part_numbers: activeNames([...lookups.part_numbers.values()].filter((p) => kindIs('sub_equipment')(p.type_id))),
    types: activeNames([...lookups.types.values()].filter((t) => t.kind === 'sub_equipment')),
    locations: activeNames([...lookups.locations.values()]),
  };
}

export async function buildSubTemplate(lookups: Lookups, language: Language, now = new Date()): Promise<Buffer> {
  const choices = subImportChoices(lookups);
  // Cột "Tester part number" liệt kê part number của tester (khác cột Part number của chính sub-equipment).
  const testerParts = activeNames([...lookups.part_numbers.values()].filter((p) => kindOf(lookups, p.type_id) === 'tester'));
  return buildImportTemplate({
    columns: SUB_IMPORT_COLUMNS.map((c) => (c.key === 'tester_part_number' ? { ...c, list: 'tester_part_numbers' } : c)),
    choices: { ...choices, tester_part_numbers: testerParts },
    sheet: DATA_SHEET,
    lenientLists: ['tester_part_number'],
    language, now,
  });
}

export async function subImportTemplate(language: Language): Promise<Buffer> {
  return buildSubTemplate(await loadLookups(), language);
}

// ---------------------------------------------------------------------------
// Kiểm tra
// ---------------------------------------------------------------------------

/** Equipment đã có — để tìm tester. */
export type ExistingEquipmentRef = {
  id: string; serial_number: string; part_number_id: string | null; type_id: string | null; location_id: string;
};

const DB_KEYS = ['serial_number', 'part_number_id', 'jabil_id', 'asset', 'type_id', 'location_id', 'remark'] as const;

/** Kiểm tra từng dòng như form Thêm sub-equipment; trả báo cáo + các dòng sẽ ghi. */
export function checkSubTable(
  table: Awaited<ReturnType<typeof readWorkbook>>, lookups: Lookups, equipment: ExistingEquipmentRef[], existingSerials: string[],
): { report: ImportReport; inserts: SubInsertRow[] } {
  const columnIndex = new Map<SubImportColumnKey, number>();
  const ignored: string[] = [];
  table.headers.forEach((h, i) => {
    if (!h) return;
    const key = HEADER_KEYS.get(normalize(h));
    if (key && !columnIndex.has(key)) columnIndex.set(key, i);
    else ignored.push(h);
  });
  const missing = SUB_IMPORT_COLUMNS
    .filter((c) => !columnIndex.has(c.key) && (c.required || (c.requiredUnlessParent && !columnIndex.has('tester_serial'))))
    .map((c) => c.header);
  if (missing.length) throw fileError('missing_columns', { columns: missing });
  if (!table.rows.length) throw fileError('empty');
  if (table.rows.length > IMPORT_MAX_ROWS) throw fileError('too_many_rows', { count: table.rows.length, max: IMPORT_MAX_ROWS });

  const lists: Record<Exclude<ImportListKey, 'levels' | 'usages' | 'tags'>, Map<string, Entry>> = {
    part_numbers: indexBy(lookups.part_numbers, (r) => r.is_active),
    types: indexBy(lookups.types, (r) => r.is_active),
    locations: indexBy(lookups.locations, (r) => r.is_active),
  };
  const pool = bySerial(equipment.map((e): ParentCandidate => ({
    id: e.id, serial_number: e.serial_number, part_number: nameOf(lookups.part_numbers, e.part_number_id) ?? '',
    kind: kindOf(lookups, e.type_id), location_id: e.location_id,
  })));
  const serialsInSystem = new Set(existingSerials.map(serialKey));
  const firstRowOfSerial = new Map<string, number>();
  const rows: ImportRowReport[] = [];
  const inserts: SubInsertRow[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const source of table.rows) {
    const cell = (key: SubImportColumnKey) => {
      const index = columnIndex.get(key);
      return index === undefined ? '' : source.cells[index] ?? '';
    };
    const issues: ImportIssue[] = [];
    const data = { tester_id: null } as SubInsertRow;
    for (const key of DB_KEYS) {
      const col = SUB_IMPORT_COLUMNS.find((c) => c.key === key)!;
      const raw = cell(key);
      data[key] = null;
      if (!raw) {
        if (col.required || (col.requiredUnlessParent && !cell('tester_serial'))) issues.push({ column: key, code: 'required' });
        continue;
      }
      if (col.list) {
        const entry = lists[col.list as keyof typeof lists].get(raw.toLowerCase());
        if (!entry) issues.push({ column: key, code: 'not_found', value: raw });
        else if (!entry.usable) issues.push({ column: key, code: 'inactive', value: raw });
        else data[key] = entry.id;
      } else if (col.max && raw.length > col.max) {
        issues.push({ column: key, code: 'too_long', max: col.max });
      } else {
        data[key] = raw;
      }
    }
    // Part number phải thuộc loại sub_equipment; Type luôn theo part number (ô trống hoặc đúng Type đó).
    const partType = partNumberType(lookups, data.part_number_id);
    if (partType) {
      if (kindOf(lookups, partType) !== 'sub_equipment') {
        issues.push({ column: 'part_number_id', code: 'wrong_kind', value: cell('part_number_id') });
      }
      const partTypeName = nameOf(lookups.types, partType) ?? '';
      for (let i = issues.length - 1; i >= 0; i--) if (issues[i]!.column === 'type_id') issues.splice(i, 1);
      if (cell('type_id') && cell('type_id').toLowerCase() !== partTypeName.toLowerCase()) {
        issues.push({ column: 'type_id', code: 'type_follows_part_number', value: partTypeName });
      }
      data.type_id = partType;
    }

    // Tester: equipment loại tester đã có; vị trí theo tester.
    const testerSerial = cell('tester_serial');
    if (testerSerial.length > 200) issues.push({ column: 'tester_serial', code: 'too_long', max: 200 });
    else if (cell('tester_part_number') && !testerSerial) issues.push({ column: 'tester_serial', code: 'required' });
    else if (testerSerial) {
      const found = findExistingParent(testerSerial, cell('tester_part_number'), pool);
      const shown = cell('tester_part_number') ? `${testerSerial} · ${cell('tester_part_number')}` : testerSerial;
      if ('code' in found) {
        issues.push({ column: 'tester_serial', code: found.code, value: shown, ...(found.code === 'parent_ambiguous' ? { count: found.count } : {}) });
      } else if (!parentAllowed('sub_equipment', found.parent.kind)) {
        issues.push({ column: 'tester_serial', code: 'parent_type_invalid', value: shown });
      } else {
        if (data.location_id && data.location_id !== found.parent.location_id) {
          issues.push({ column: 'location_id', code: 'location_follows_parent', value: nameOf(lookups.locations, found.parent.location_id) ?? '' });
        }
        data.location_id = found.parent.location_id;
        data.tester_id = found.parent.id;
      }
    }

    let duplicateOf: ImportRowReport['duplicate_of'] = null;
    if (data.serial_number) {
      const key = serialKey(data.serial_number);
      if (serialsInSystem.has(key)) duplicateOf = 'existing';
      else if (firstRowOfSerial.has(key)) duplicateOf = firstRowOfSerial.get(key)!;
      else firstRowOfSerial.set(key, source.row);
    }
    if (issues.length) invalid++;
    if (duplicateOf !== null) duplicates++;
    if (issues.length || duplicateOf !== null) {
      rows.push({ row: source.row, serial_number: cell('serial_number') || null, issues, duplicate_of: duplicateOf });
    }
    if (!issues.length) inserts.push(data);
  }

  return {
    report: {
      total: table.rows.length, valid: table.rows.length - invalid, invalid, duplicates,
      committed: false, created: 0, ignored_columns: ignored, rows,
    },
    inserts,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** commit = false: chỉ kiểm tra (+ database chạy thử). commit = true: kiểm tra lại từ đầu, hết lỗi mới ghi (tất cả hoặc không). */
export async function importSubEquipmentFile(file: UploadedFile | null, commit: boolean, actor: string): Promise<ImportReport> {
  const table = await readWorkbook(await readUpload(file), HEADER_KEYS);
  const [lookups, equipment, serials] = await Promise.all([
    loadLookups(),
    selectAll<ExistingEquipmentRef>('equipment', 'id, serial_number, part_number_id, type_id, location_id'),
    allSerials(),
  ]);
  const { report, inserts } = checkSubTable(table, lookups, equipment, serials);
  if (report.invalid > 0) return report;

  const result = await rpc<AssetOpResult>('sub_equipment_import', { p_rows: inserts, p_actor: actor, p_dry_run: !commit });
  return commit ? { ...report, committed: true, created: result.count } : report;
}
