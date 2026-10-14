import 'server-only';

/**
 * Import Excel cho Equipment (docs/DETAIL_MODEL.md mục 6, DATABASE_MODIFIED.md mục 3).
 *
 * - File mẫu sinh lúc tải: danh sách chọn (Part number, Type, Level, Location) lấy từ Configuration ngay lúc đó nên
 *   luôn khớp với app; part number chỉ liệt kê loại tester / base / fixture.
 * - Kiểm tra cùng quy tắc với form Thêm thiết bị. Giá trị chọn tìm theo display_name (không phân biệt hoa / thường);
 *   chưa có hoặc đã ẩn → lỗi, không tự tạo.
 * - Status (In use / Not in use) và Tags (tên thẻ cách nhau dấu ;) là cột không bắt buộc. Thiết bị con theo Status của cha (ô trống
 *   hoặc đúng Status của cha — như Location, Level); không có cha thì ô trống = Not in use, và chỉ Tester được In use.
 * - Thiết bị cha: tìm theo serial (+ part number nếu serial trùng) trong thiết bị đã có hoặc các dòng khác của file,
 *   thứ tự dòng không quan trọng; cha phải đúng loại theo cây (Tester ⊃ Base ⊃ Fixture). Có cha thì vị trí và Level
 *   theo cha (cả chuỗi cha trong file).
 * - Tất cả hoặc không: còn dòng lỗi thì không ghi; hết lỗi thì database chạy thử cả file (dry run, mọi trigger) rồi
 *   mới ghi một lần qua RPC equipment_import (một giao dịch, nhật ký CREATE với source = import).
 */
import { randomUUID } from 'node:crypto';
import { rpc, selectAll } from './core/db';
import { kindOf, loadLookups, nameOf, partNumberType, type Lookups } from './core/lookups';
import {
  activeNames, buildImportTemplate, fileError, headerKeys, indexBy, normalize, readUpload, readWorkbook, serialKey,
  type Entry, type SheetTable, type UploadedFile,
} from './core/importKit';
import { textFor, type Language } from '@/lib/i18n/text';
import { parentAllowed } from '@/lib/assetTree';
import {
  IMPORT_COLUMNS, IMPORT_MAX_ROWS,
  type ImportColumnKey, type ImportIssue, type ImportListKey, type ImportReport, type ImportRowReport,
} from '@/lib/equipmentImport';
import type { AssetOpResult, Usage } from '@/lib/types';

const HEADER_KEYS = headerKeys(IMPORT_COLUMNS);
const EQUIPMENT_KINDS = ['tester', 'base', 'fixture'];
const DATA_SHEET = 'Equipment';

// ---------------------------------------------------------------------------
// Giá trị chọn được + file mẫu
// ---------------------------------------------------------------------------

export type ImportChoices = Record<ImportListKey, string[]>;

/** Chữ của Status trong file: cả hai ngôn ngữ và mã (`in_use`), bỏ dấu cách / gạch / hoa thường — "In use", "in_use", "INUSE" đều nhận. */
const USAGE_BY_TEXT = new Map<string, Usage>(
  (['en', 'vi'] as const).flatMap((language) => (['in_use', 'not_in_use'] as const).map((u) => [normalize(textFor(language)(`values.${u}`)), u] as const))
    .concat((['in_use', 'not_in_use'] as const).map((u) => [normalize(u), u] as const)),
);

/** Giá trị chọn được cho thiết bị mới — đang dùng, đúng thứ tự Configuration; chỉ part number / Type của tester, base, fixture. */
export function importChoices(lookups: Lookups, language: Language = 'en'): ImportChoices {
  const isEquipment = (typeId: string) => EQUIPMENT_KINDS.includes(kindOf(lookups, typeId) ?? '');
  const t = textFor(language);
  return {
    part_numbers: activeNames([...lookups.part_numbers.values()].filter((p) => isEquipment(p.type_id))),
    types: activeNames([...lookups.types.values()].filter((t) => EQUIPMENT_KINDS.includes(t.kind))),
    levels: activeNames([...lookups.levels.values()]),
    locations: activeNames([...lookups.locations.values()]),
    usages: [t('values.in_use'), t('values.not_in_use')],
    // Thẻ không có "ẩn": mọi thẻ đều chọn được.
    tags: activeNames([...lookups.tags.values()].map((tag) => ({ ...tag, is_active: true }))),
  };
}

export async function buildTemplate(lookups: Lookups, language: Language, now = new Date()): Promise<Buffer> {
  return buildImportTemplate({
    columns: IMPORT_COLUMNS,
    choices: importChoices(lookups, language),
    sheet: DATA_SHEET,
    // Part number của thiết bị cha có thể là mã đã ẩn → chỉ cảnh báo, không chặn.
    lenientLists: ['parent_part_number'],
    language, now,
  });
}

export async function equipmentImportTemplate(language: Language): Promise<Buffer> {
  return buildTemplate(await loadLookups(), language);
}

// ---------------------------------------------------------------------------
// Kiểm tra
// ---------------------------------------------------------------------------

/** Thiết bị đã có — để tìm thiết bị cha. */
export type ExistingEquipment = {
  id: string; serial_number: string; part_number_id: string | null; type_id: string | null;
  location_id: string; level_id: string | null; usage: Usage;
};

/** Một dòng sẽ ghi — đúng tên cột của bảng equipment. */
export type InsertRow = {
  id: string; serial_number: string | null; part_number_id: string | null; jabil_id: string | null; asset: string | null;
  type_id: string | null; level_id: string | null; location_id: string | null;
  parent_id: string | null; remark: string | null;
  /** Status đã quyết (theo cha, hoặc ô Status, hoặc Not in use). */
  usage: Usage | null; tag_ids: string[];
};

type Parent = { existing: ExistingEquipment } | { row: number };

type Work = {
  source: SheetTable['rows'][number];
  issues: ImportIssue[];
  data: InsertRow;
  /** Chữ trong ô (đã cắt khoảng trắng). */
  cell: (key: ImportColumnKey) => string;
  parent: Parent | null;
  /** Status ghi trong ô (null = để trống / không hợp lệ). */
  ownUsage: Usage | null;
};

const DB_KEYS = ['serial_number', 'part_number_id', 'jabil_id', 'asset', 'type_id', 'level_id', 'location_id', 'remark'] as const;

/**
 * Kiểm tra từng dòng như form Thêm thiết bị; trả báo cáo + các dòng sẽ ghi.
 * `existing`: equipment đã có (làm cha). `existingSerials`: serial đã có ở cả ba bảng (chỉ để cảnh báo trùng).
 */
export function checkTable(
  table: SheetTable, lookups: Lookups, existing: ExistingEquipment[],
  existingSerials: string[] = existing.map((e) => e.serial_number), newId: () => string = randomUUID,
): { report: ImportReport; inserts: InsertRow[] } {
  const columnIndex = new Map<ImportColumnKey, number>();
  const ignored: string[] = [];
  table.headers.forEach((h, i) => {
    if (!h) return;
    const key = HEADER_KEYS.get(normalize(h));
    if (key && !columnIndex.has(key)) columnIndex.set(key, i);
    else ignored.push(h);
  });
  const missing = IMPORT_COLUMNS
    .filter((c) => !columnIndex.has(c.key) && (c.required || (c.requiredUnlessParent && !columnIndex.has('parent_serial'))))
    .map((c) => c.header);
  if (missing.length) throw fileError('missing_columns', { columns: missing });
  if (!table.rows.length) throw fileError('empty');
  if (table.rows.length > IMPORT_MAX_ROWS) throw fileError('too_many_rows', { count: table.rows.length, max: IMPORT_MAX_ROWS });

  const lists: Record<ImportListKey, Map<string, Entry>> = {
    part_numbers: indexBy(lookups.part_numbers, (r) => r.is_active),
    types: indexBy(lookups.types, (r) => r.is_active),
    levels: indexBy(lookups.levels, (r) => r.is_active),
    locations: indexBy(lookups.locations, (r) => r.is_active),
    usages: new Map(),
    tags: indexBy(lookups.tags, () => true),
  };

  // ---- 1. Từng ô như form Thêm thiết bị.
  const works: Work[] = table.rows.map((source) => {
    const cell = (key: ImportColumnKey) => {
      const index = columnIndex.get(key);
      return index === undefined ? '' : source.cells[index] ?? '';
    };
    const issues: ImportIssue[] = [];
    const data = { id: newId(), parent_id: null, usage: null, tag_ids: [] as string[] } as InsertRow;
    for (const key of DB_KEYS) {
      const col = IMPORT_COLUMNS.find((c) => c.key === key)!;
      const raw = cell(key);
      data[key] = null;
      if (!raw) {
        if (col.required || (col.requiredUnlessParent && !cell('parent_serial'))) issues.push({ column: key, code: 'required' });
        continue;
      }
      if (col.list) {
        const entry = lists[col.list].get(raw.toLowerCase());
        if (!entry) issues.push({ column: key, code: 'not_found', value: raw });
        else if (!entry.usable) issues.push({ column: key, code: 'inactive', value: raw });
        else data[key] = entry.id;
      } else if (col.max && raw.length > col.max) {
        issues.push({ column: key, code: 'too_long', max: col.max });
      } else {
        data[key] = raw;
      }
    }
    // Part number phải thuộc loại tester / base / fixture (sub-equipment nhập ở file Calibration).
    const partKind = kindOf(lookups, partNumberType(lookups, data.part_number_id));
    if (partKind && !EQUIPMENT_KINDS.includes(partKind)) {
      issues.push({ column: 'part_number_id', code: 'wrong_kind', value: cell('part_number_id') });
    }
    // Type theo part number (như Location theo cha): ô trống hoặc đúng Type đó (kể cả Type đã ẩn) → lấy
    // theo part number; ghi Type khác → một lỗi duy nhất cho ô này.
    const partType = partNumberType(lookups, data.part_number_id);
    if (partType) {
      const partTypeName = nameOf(lookups.types, partType) ?? '';
      for (let i = issues.length - 1; i >= 0; i--) if (issues[i]!.column === 'type_id') issues.splice(i, 1);
      if (cell('type_id') && cell('type_id').toLowerCase() !== partTypeName.toLowerCase()) {
        issues.push({ column: 'type_id', code: 'type_follows_part_number', value: partTypeName });
      }
      data.type_id = partType;
    }
    if (cell('parent_serial').length > 200) issues.push({ column: 'parent_serial', code: 'too_long', max: 200 });
    if (cell('parent_part_number') && !cell('parent_serial')) issues.push({ column: 'parent_serial', code: 'required' });
    // Status: ô trống = theo cha (hoặc Not in use khi không có cha) — quyết ở bước 3, sau khi biết cha.
    let ownUsage: Usage | null = null;
    if (cell('usage')) {
      ownUsage = USAGE_BY_TEXT.get(normalize(cell('usage'))) ?? null;
      if (!ownUsage) issues.push({ column: 'usage', code: 'usage_invalid', value: cell('usage') });
    }
    // Tags: tên thẻ cách nhau dấu ; (hoặc dấu phẩy), bỏ trùng; thẻ chưa có trong Configuration → một lỗi cho cả ô.
    const unknownTags: string[] = [];
    for (const name of cell('tag_ids').split(/[;,\n]/).map((n) => n.trim()).filter(Boolean)) {
      const tag = lists.tags.get(name.toLowerCase());
      if (!tag) unknownTags.push(name);
      else if (!data.tag_ids.includes(tag.id)) data.tag_ids.push(tag.id);
    }
    if (unknownTags.length) issues.push({ column: 'tag_ids', code: 'not_found', value: unknownTags.join(', ') });
    return { source, issues, data, cell, parent: null, ownUsage };
  });

  // ---- 2. Thiết bị cha: thiết bị đã có hoặc dòng khác trong file (serial, + part number nếu trùng); đúng loại theo cây.
  const kindOfRow = (w: Work) => kindOf(lookups, w.data.type_id);
  const existingBySerial = new Map<string, ExistingEquipment[]>();
  existing.forEach((e) => {
    const key = serialKey(e.serial_number);
    existingBySerial.set(key, [...(existingBySerial.get(key) ?? []), e]);
  });
  const rowsBySerial = new Map<string, number[]>();
  works.forEach((w, i) => {
    const serial = w.cell('serial_number');
    if (serial) rowsBySerial.set(serialKey(serial), [...(rowsBySerial.get(serialKey(serial)) ?? []), i]);
  });
  works.forEach((w, i) => {
    const serial = w.cell('parent_serial');
    if (!serial || serial.length > 200) return;
    const part = w.cell('parent_part_number').toLowerCase();
    const key = serialKey(serial);
    const candidates: { parent: Parent; part: string; kind: string | null }[] = [
      ...(existingBySerial.get(key) ?? []).map((e) => ({
        parent: { existing: e } as Parent, part: (nameOf(lookups.part_numbers, e.part_number_id) ?? '').toLowerCase(),
        kind: kindOf(lookups, e.type_id),
      })),
      ...(rowsBySerial.get(key) ?? []).filter((j) => j !== i).map((j) => ({
        parent: { row: j } as Parent, part: works[j]!.cell('part_number_id').toLowerCase(), kind: kindOfRow(works[j]!),
      })),
    ].filter((c) => !part || c.part === part);
    const shown = part ? `${serial} · ${w.cell('parent_part_number')}` : serial;
    if (candidates.length === 0) w.issues.push({ column: 'parent_serial', code: 'parent_not_found', value: shown });
    else if (candidates.length > 1) w.issues.push({ column: 'parent_serial', code: 'parent_ambiguous', value: shown, count: candidates.length });
    else {
      const [only] = candidates;
      const childKind = kindOfRow(w);
      // Loại của dòng hoặc của cha chưa biết (part number lỗi) → đã có lỗi ở ô đó, không báo thêm.
      if (childKind && only!.kind && !parentAllowed(childKind, only!.kind)) {
        w.issues.push({ column: 'parent_serial', code: 'parent_type_invalid', value: shown });
      } else {
        w.parent = only!.parent;
      }
    }
  });

  // ---- 3. Vị trí + Level theo cha (theo cả chuỗi cha trong file); chặn vòng lặp.
  const locationNames = lookups.locations;
  works.forEach((w) => {
    if (!w.parent) return;
    const seen = new Set<Work>([w]);
    let current: Work = w;
    let location: string | null = null;
    let level: string | null = null;
    let usage: Usage = 'not_in_use';
    let cycle = false;
    for (;;) {
      const parent: Parent | null = current.parent;
      if (!parent) { location = current.data.location_id; level = current.data.level_id; usage = current.ownUsage ?? 'not_in_use'; break; }
      if ('existing' in parent) { location = parent.existing.location_id; level = parent.existing.level_id; usage = parent.existing.usage; break; }
      const next = works[parent.row]!;
      if (seen.has(next)) { cycle = true; break; }
      seen.add(next);
      current = next;
    }
    if (cycle) {
      w.issues.push({ column: 'parent_serial', code: 'parent_cycle', value: w.cell('parent_serial') });
      return;
    }
    if (w.data.location_id && location && w.data.location_id !== location) {
      w.issues.push({ column: 'location_id', code: 'location_follows_parent', value: nameOf(locationNames, location) ?? '' });
    }
    w.data.location_id = location;
    // Level: ô trống hoặc đúng Level của cha (kể cả Level đã ẩn) → theo cha; Level khác → một lỗi cho ô này.
    const levelName = nameOf(lookups.levels, level) ?? '';
    if (w.cell('level_id')) {
      w.issues = w.issues.filter((i) => i.column !== 'level_id');
      if (w.cell('level_id').toLowerCase() !== levelName.toLowerCase()) {
        w.issues.push({ column: 'level_id', code: 'level_follows_parent', value: levelName || '—' });
      }
    }
    w.data.level_id = level;
    // Status: thiết bị con theo Status của cha (cả chuỗi cha trong file); ô trống hoặc đúng Status của cha — như Location, Level.
    w.data.usage = usage;
    if (w.ownUsage && w.ownUsage !== usage) {
      w.issues.push({ column: 'usage', code: 'usage_follows_parent', value: textFor('en')(`values.${usage}`) });
    }
    w.data.parent_id = 'existing' in w.parent ? w.parent.existing.id : works[w.parent.row]!.data.id;
  });

  // ---- 3b. Status của dòng không có cha: ô trống = Not in use; chỉ Tester được In use khi không có cha.
  works.forEach((w) => {
    if (w.parent || w.cell('parent_serial')) return; // có cha (đã xử lý ở trên) hoặc cha lỗi (đã có lỗi ở ô cha)
    w.data.usage = w.ownUsage ?? 'not_in_use';
    const kind = kindOfRow(w);
    if (w.data.usage === 'in_use' && kind && kind !== 'tester') {
      w.issues.push({ column: 'usage', code: 'usage_needs_parent', value: w.cell('usage') });
    }
  });

  // ---- 4. Serial trùng (chỉ cảnh báo, kể cả với sub-equipment / golden board đã có) + báo cáo.
  const serialsInSystem = new Set(existingSerials.map(serialKey));
  const firstRowOfSerial = new Map<string, number>();
  const rows: ImportRowReport[] = [];
  const inserts: InsertRow[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (const w of works) {
    let duplicateOf: ImportRowReport['duplicate_of'] = null;
    if (w.data.serial_number) {
      const key = serialKey(w.data.serial_number);
      if (serialsInSystem.has(key)) duplicateOf = 'existing';
      else if (firstRowOfSerial.has(key)) duplicateOf = firstRowOfSerial.get(key)!;
      else firstRowOfSerial.set(key, w.source.row);
    }
    if (w.issues.length) invalid++;
    if (duplicateOf !== null) duplicates++;
    if (w.issues.length || duplicateOf !== null) {
      rows.push({ row: w.source.row, serial_number: w.cell('serial_number') || null, issues: w.issues, duplicate_of: duplicateOf });
    }
    if (!w.issues.length) inserts.push(w.data);
  }

  return {
    report: {
      total: works.length, valid: works.length - invalid, invalid, duplicates,
      committed: false, created: 0, ignored_columns: ignored, rows,
    },
    inserts,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Serial đã có ở cả ba bảng. */
export async function allSerials(): Promise<string[]> {
  const [equipment, subs, golden] = await Promise.all([
    selectAll<{ serial_number: string }>('equipment', 'id, serial_number'),
    selectAll<{ serial_number: string }>('sub_equipment', 'id, serial_number'),
    selectAll<{ serial_number: string }>('golden_boards', 'id, serial_number'),
  ]);
  return [...equipment, ...subs, ...golden].map((r) => r.serial_number);
}

/**
 * commit = false: chỉ kiểm tra (hết lỗi thì database còn chạy thử cả file — dry run — để chắc chắn ghi được).
 * commit = true: kiểm tra lại từ đầu, hết lỗi mới ghi (tất cả hoặc không).
 */
export async function importEquipmentFile(file: UploadedFile | null, commit: boolean, actor: string): Promise<ImportReport> {
  const table = await readWorkbook(await readUpload(file), HEADER_KEYS);
  const [lookups, existing, serials] = await Promise.all([
    loadLookups(),
    selectAll<ExistingEquipment>('equipment', 'id, serial_number, part_number_id, type_id, location_id, level_id, usage'),
    allSerials(),
  ]);
  const { report, inserts } = checkTable(table, lookups, existing, serials);
  if (report.invalid > 0) return report;

  const result = await rpc<AssetOpResult>('equipment_import', { p_rows: inserts, p_actor: actor, p_dry_run: !commit });
  return commit ? { ...report, committed: true, created: result.count } : report;
}
