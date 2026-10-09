import 'server-only';

/**
 * Import Excel cho Golden board — cùng cách làm với Equipment (equipmentImport.ts): file mẫu sinh lúc tải (Location và
 * Parent part number lấy từ Configuration ngay lúc đó), kiểm tra từng dòng như form Thêm golden board, tất cả hoặc không,
 * database chạy thử (dry run) rồi ghi một lần qua RPC golden_import (nhật ký CREATE với source = import).
 * Khác Equipment: Part number của golden board là chữ tự do; "Parent serial number" gắn vào tester hoặc fixture đã có.
 */
import { rpc, selectAll } from './core/db';
import { kindOf, loadLookups, nameOf, type Lookups } from './core/lookups';
import {
  activeNames, bySerial, buildImportTemplate, fileError, findExistingParent, headerKeys, indexBy, normalize, readUpload,
  readWorkbook, serialKey, type Entry, type ParentCandidate, type SheetTable, type UploadedFile,
} from './core/importKit';
import { allSerials, type ExistingEquipment } from './equipmentImport';
import { textFor, type Language } from '@/lib/i18n/text';
import { parentAllowed } from '@/lib/assetTree';
import { GOLDEN_IMPORT_COLUMNS, type GoldenImportColumnKey } from '@/lib/goldenImport';
import { IMPORT_MAX_ROWS, type ImportIssue, type ImportReport, type ImportRowReport } from '@/lib/equipmentImport';
import type { AssetOpResult } from '@/lib/types';

const HEADER_KEYS = headerKeys(GOLDEN_IMPORT_COLUMNS);
const DATA_SHEET = 'Golden';

/** Một dòng sẽ ghi — đúng tên cột của bảng golden_boards. */
export type GoldenInsertRow = {
  part_number: string | null; serial_number: string | null; utd_part_number: string | null; location_id: string | null;
  origin: string | null; purpose: string | null; parent_id: string | null; remark: string | null;
};

// ---------------------------------------------------------------------------
// Giá trị chọn được + file mẫu
// ---------------------------------------------------------------------------

/** Location đang dùng; part number của tester / fixture (cột Parent part number — cha của golden board). */
export function goldenImportChoices(lookups: Lookups) {
  const isParentKind = (typeId: string) => ['tester', 'fixture'].includes(kindOf(lookups, typeId) ?? '');
  return {
    locations: activeNames([...lookups.locations.values()]),
    part_numbers: activeNames([...lookups.part_numbers.values()].filter((p) => isParentKind(p.type_id))),
  };
}

export async function buildGoldenTemplate(lookups: Lookups, language: Language, now = new Date()): Promise<Buffer> {
  const t = textFor(language);
  return buildImportTemplate({
    columns: GOLDEN_IMPORT_COLUMNS,
    choices: goldenImportChoices(lookups),
    sheet: DATA_SHEET,
    guideTitle: t('gimp.tpl.guideTitle'),
    steps: [
      t('gimp.tpl.step1', { sheet: DATA_SHEET }), t('imp.tpl.step2'), t('imp.tpl.step3'), t('gimp.tpl.stepParent'),
      t('gimp.tpl.step4', { max: IMPORT_MAX_ROWS }),
    ],
    leadingNotes: (col, tr) => col.key === 'parent_serial' ? [tr('gimp.tpl.parentSerial')]
      : col.key === 'parent_part_number' ? [tr('imp.tpl.parentPart')] : [],
    extraRules: (col, tr) => col.key === 'serial_number' ? [tr('imp.tpl.serialDuplicate')] : [],
    lenientLists: ['parent_part_number'],
    language, now,
  });
}

export async function goldenImportTemplate(language: Language): Promise<Buffer> {
  return buildGoldenTemplate(await loadLookups(), language);
}

// ---------------------------------------------------------------------------
// Kiểm tra
// ---------------------------------------------------------------------------

const DB_KEYS = ['part_number', 'serial_number', 'utd_part_number', 'location_id', 'origin', 'purpose', 'remark'] as const;

/** Kiểm tra từng dòng như form Thêm golden board; trả báo cáo + các dòng sẽ ghi. */
export function checkGoldenTable(
  table: SheetTable, lookups: Lookups, equipment: ExistingEquipment[], existingSerials: string[],
): { report: ImportReport; inserts: GoldenInsertRow[] } {
  const columnIndex = new Map<GoldenImportColumnKey, number>();
  const ignored: string[] = [];
  table.headers.forEach((h, i) => {
    if (!h) return;
    const key = HEADER_KEYS.get(normalize(h));
    if (key && !columnIndex.has(key)) columnIndex.set(key, i);
    else ignored.push(h);
  });
  const missing = GOLDEN_IMPORT_COLUMNS
    .filter((c) => !columnIndex.has(c.key) && (c.required || (c.requiredUnlessParent && !columnIndex.has('parent_serial'))))
    .map((c) => c.header);
  if (missing.length) throw fileError('missing_columns', { columns: missing });
  if (!table.rows.length) throw fileError('empty');
  if (table.rows.length > IMPORT_MAX_ROWS) throw fileError('too_many_rows', { count: table.rows.length, max: IMPORT_MAX_ROWS });

  const locations: Map<string, Entry> = indexBy(lookups.locations, (r) => r.is_active);
  const pool = bySerial(equipment.map((e): ParentCandidate => ({
    id: e.id, serial_number: e.serial_number, part_number: nameOf(lookups.part_numbers, e.part_number_id) ?? '',
    kind: kindOf(lookups, e.type_id), location_id: e.location_id,
  })));
  const serialsInSystem = new Set(existingSerials.map(serialKey));
  const firstRowOfSerial = new Map<string, number>();
  const rows: ImportRowReport[] = [];
  const inserts: GoldenInsertRow[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const source of table.rows) {
    const cell = (key: GoldenImportColumnKey) => {
      const index = columnIndex.get(key);
      return index === undefined ? '' : source.cells[index] ?? '';
    };
    const issues: ImportIssue[] = [];
    const data = { parent_id: null } as GoldenInsertRow;
    for (const key of DB_KEYS) {
      const col = GOLDEN_IMPORT_COLUMNS.find((c) => c.key === key)!;
      const raw = cell(key);
      data[key] = null;
      if (!raw) {
        if (col.required || (col.requiredUnlessParent && !cell('parent_serial'))) issues.push({ column: key, code: 'required' });
      } else if (col.list) {
        const entry = locations.get(raw.toLowerCase());
        if (!entry) issues.push({ column: key, code: 'not_found', value: raw });
        else if (!entry.usable) issues.push({ column: key, code: 'inactive', value: raw });
        else data[key] = entry.id;
      } else if (col.max && raw.length > col.max) {
        issues.push({ column: key, code: 'too_long', max: col.max });
      } else {
        data[key] = raw;
      }
    }

    // Cha: tester hoặc fixture đã có; vị trí theo cha.
    const parentSerial = cell('parent_serial');
    if (parentSerial.length > 200) issues.push({ column: 'parent_serial', code: 'too_long', max: 200 });
    else if (cell('parent_part_number') && !parentSerial) issues.push({ column: 'parent_serial', code: 'required' });
    else if (parentSerial) {
      const found = findExistingParent(parentSerial, cell('parent_part_number'), pool);
      const shown = cell('parent_part_number') ? `${parentSerial} · ${cell('parent_part_number')}` : parentSerial;
      if ('code' in found) {
        issues.push({ column: 'parent_serial', code: found.code, value: shown, ...(found.code === 'parent_ambiguous' ? { count: found.count } : {}) });
      } else if (!parentAllowed('golden_board', found.parent.kind)) {
        issues.push({ column: 'parent_serial', code: 'parent_type_invalid', value: shown });
      } else {
        if (data.location_id && data.location_id !== found.parent.location_id) {
          issues.push({ column: 'location_id', code: 'location_follows_parent', value: nameOf(lookups.locations, found.parent.location_id) ?? '' });
        }
        data.location_id = found.parent.location_id;
        data.parent_id = found.parent.id;
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
      rows.push({ row: source.row, serial_number: data.serial_number, issues, duplicate_of: duplicateOf });
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
export async function importGoldenFile(file: UploadedFile | null, commit: boolean, actor: string): Promise<ImportReport> {
  const table = await readWorkbook(await readUpload(file), HEADER_KEYS);
  const [lookups, equipment, serials] = await Promise.all([
    loadLookups(),
    selectAll<ExistingEquipment>('equipment', 'id, serial_number, part_number_id, type_id, location_id, level_id'),
    allSerials(),
  ]);
  const { report, inserts } = checkGoldenTable(table, lookups, equipment, serials);
  if (report.invalid > 0) return report;

  const result = await rpc<AssetOpResult>('golden_import', { p_rows: inserts, p_actor: actor, p_dry_run: !commit });
  return commit ? { ...report, committed: true, created: result.count } : report;
}
