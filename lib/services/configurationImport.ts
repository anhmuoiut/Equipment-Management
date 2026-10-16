import 'server-only';

/**
 * Import Excel cho Configuration (Part Number, Location, Type, Group, Level, Department, Vendor) — cùng cách làm với Equipment
 * (equipmentImport.ts): file mẫu sinh lúc tải (Type / Level / Group lấy từ Configuration ngay lúc đó), kiểm tra từng dòng như form
 * Thêm, tất cả hoặc không. Chỉ Admin. Tên không phân biệt hoa thường (database chặn trùng: <bảng>_display_name_key).
 * Tên trùng dòng trước trong file = lỗi. Tên đã có trong hệ thống = KHÔNG lỗi: báo cho Admin chọn giữ bản gốc (bỏ dòng đó) hoặc ghi đè
 * (sửa dòng có sẵn bằng các ô có chữ trong file, kể cả Order và In use; ô trống giữ nguyên giá trị cũ). Dòng mới: Order trống = 0,
 * In use trống = đang dùng. Cột của file = cột của bảng (lib/configurationImport.ts). Không ghi nhật ký (như mọi sửa Configuration).
 */
import { insertMany, updateMany } from './core/db';
import { loadLookups, nameOf, type Lookups } from './core/lookups';
import {
  activeNames, buildImportTemplate, fileError, headerKeys, indexBy, normalize, readUpload, readWorkbook,
  type Entry, type SheetTable, type UploadedFile,
} from './core/importKit';
import { AppError } from '@/lib/errors';
import ExcelJS from 'exceljs';
import { textFor, type Language } from '@/lib/i18n/text';
import type { ConfigListDef } from '@/lib/configuration';
import { CONFIG_COLUMN_LABELS, CONFIG_ORDER_MAX, configImportColumns } from '@/lib/configurationImport';
import { IMPORT_MAX_ROWS, type ImportIssue, type ImportReport, type ImportRowReport } from '@/lib/equipmentImport';

type ExistingRow = { id: string; display_name: string } & Record<string, unknown>;

function columnsOf(list: ConfigListDef, language: Language = 'en') {
  const columns = configImportColumns(list, textFor(language));
  if (!columns) throw new AppError('NOT_FOUND');
  return columns;
}

/** Tiêu đề cột Tên của file mẫu bản đầu (theo danh sách) — file mẫu đã tải trước đó vẫn đọc được. */
const LEGACY_NAME_HEADERS: Record<string, string> = {
  'part-numbers': 'Part number', locations: 'Location', types: 'Type', 'type-groups': 'Group', levels: 'Level', departments: 'Department', 'calibration-vendors': 'Vendor',
};

/** Tiêu đề cột → trường: tiêu đề của bảng ở cả hai ngôn ngữ (file mẫu / Export), tên trường, và tiêu đề file mẫu bản đầu. */
function headerMapOf(list: ConfigListDef, columns: ReturnType<typeof columnsOf>) {
  const map = headerKeys(columns);
  const legacy = LEGACY_NAME_HEADERS[list.key];
  if (legacy) map.set(normalize(legacy), 'display_name');
  for (const language of ['en', 'vi'] as const) {
    const t = textFor(language);
    for (const c of columns) {
      const label = CONFIG_COLUMN_LABELS[c.key];
      if (label) map.set(normalize(t(label)), c.key);
    }
  }
  return map;
}

/** Ô In use: chữ của bảng (In use / Hidden, cả hai ngôn ngữ) hoặc yes / no, true / false, 1 / 0. Khác → null. */
function parseState(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  const words = (key: string, extra: string[]) => new Set([...extra, textFor('en')(key).toLowerCase(), textFor('vi')(key).toLowerCase()]);
  if (words('cfg.active', ['yes', 'true', '1']).has(v)) return true;
  if (words('cfg.hidden', ['no', 'false', '0']).has(v)) return false;
  return null;
}

/** Cột nào của file là trường nào (theo tiêu đề); `ignored`: tiêu đề không nhận ra. */
function mapColumns(table: SheetTable, headerMap: Map<string, string>) {
  const columnIndex = new Map<string, number>();
  const ignored: string[] = [];
  table.headers.forEach((h, i) => {
    if (!h) return;
    const key = headerMap.get(normalize(h));
    if (key && !columnIndex.has(key)) columnIndex.set(key, i);
    else ignored.push(h);
  });
  return { columnIndex, ignored };
}

/** Group chọn được: chỉ nhóm sub_equipment (3 nhóm hệ thống Tester / Base / Fixture thuộc về 3 Type hệ thống). */
function groupsOf(lookups: Lookups) {
  return new Map([...lookups.type_groups].filter(([, g]) => g.kind === 'sub_equipment'));
}

/** Giá trị chọn được của file mẫu: Type, Level, Group đang dùng; In use / Hidden. */
export function configImportChoices(lookups: Lookups, language: Language) {
  const t = textFor(language);
  return {
    types: activeNames([...lookups.types.values()]),
    levels: activeNames([...lookups.levels.values()]),
    type_groups: activeNames([...groupsOf(lookups).values()]),
    states: [t('cfg.active'), t('cfg.hidden')],
  };
}

export async function buildConfigTemplate(list: ConfigListDef, lookups: Lookups, language: Language, now = new Date()): Promise<Buffer> {
  return buildImportTemplate({
    columns: columnsOf(list, language), choices: configImportChoices(lookups, language), sheet: textFor(language)(`cfg.list.${list.key}`), language, now,
  });
}

/** Mọi dòng của danh sách đúng như bảng (cùng cột, cùng chữ trong ô) — xuất ra rồi sửa và import lại được. */
export async function configExport(list: ConfigListDef, language: Language, now = new Date()): Promise<Buffer> {
  const t = textFor(language);
  const lookups = await loadLookups();
  const source = (lookups as unknown as Record<string, Map<string, ExistingRow>>)[list.table]!;
  // 3 Type / Group hệ thống (Tester, Base, Fixture) không sửa được bằng import — không đưa vào file.
  const rows = [...source.values()]
    .filter((r) => r.kind === undefined || r.kind === 'sub_equipment')
    .sort((a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0) || a.display_name.localeCompare(b.display_name, undefined, { numeric: true }))
    .map((r) => ({
      display_name: r.display_name,
      type_id: nameOf(lookups.types, r.type_id as string),
      manufacturer: r.manufacturer as string | null,
      level_id: nameOf(lookups.levels, r.level_id as string | null),
      group_id: nameOf(lookups.type_groups, r.group_id as string),
      description: r.description as string | null,
      remark: r.remark as string | null,
      sort_order: String((r.sort_order as number | undefined) ?? 0),
      is_active: (r.is_active as boolean | undefined) === false ? t('cfg.hidden') : t('cfg.active'),
    }))
    .map((r) => Object.fromEntries(Object.entries(r).map(([key, value]) => [key, value ?? ''])));
  return buildImportTemplate({
    columns: columnsOf(list, language), choices: configImportChoices(lookups, language), sheet: t(`cfg.list.${list.key}`), language, now, rows,
  });
}

export async function configImportTemplate(list: ConfigListDef, language: Language): Promise<Buffer> {
  return buildConfigTemplate(list, await loadLookups(), language);
}

/**
 * Kiểm tra từng dòng như form Thêm; trả báo cáo + các dòng sẽ thêm (đúng tên cột của bảng) + các dòng có sẵn sẽ bị ghi đè nếu Admin chọn
 * ghi đè (đã trộn: ô có chữ thắng, ô trống giữ giá trị đang có).
 */
export function checkConfigTable(
  list: ConfigListDef, table: SheetTable, lookups: Lookups,
): { report: ImportReport; inserts: Record<string, unknown>[]; updates: ({ id: string } & Record<string, unknown>)[] } {
  const columns = columnsOf(list);
  const headerMap = headerMapOf(list, columns);
  const { columnIndex, ignored } = mapColumns(table, headerMap);
  const missing = columns.filter((c) => c.required && !columnIndex.has(c.key)).map((c) => c.header);
  if (missing.length) throw fileError('missing_columns', { columns: missing });
  if (!table.rows.length) throw fileError('empty');
  if (table.rows.length > IMPORT_MAX_ROWS) throw fileError('too_many_rows', { count: table.rows.length, max: IMPORT_MAX_ROWS });

  const entries: Record<string, Map<string, Entry>> = {
    types: indexBy(lookups.types, (r) => r.is_active),
    levels: indexBy(lookups.levels, (r) => r.is_active),
    type_groups: indexBy(groupsOf(lookups), (r) => r.is_active),
  };
  // Bảng của danh sách này trong Lookups trùng tên bảng (part_numbers, locations, types…). Cả dòng đã ẩn: tên vẫn không dùng lại được.
  const existing = (lookups as unknown as Record<string, Map<string, ExistingRow>>)[list.table]!;
  const byName = new Map([...existing.values()].map((r) => [r.display_name.trim().toLowerCase(), r]));
  const firstRowOfName = new Map<string, number>();

  const rows: ImportRowReport[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: ({ id: string } & Record<string, unknown>)[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const source of table.rows) {
    const issues: ImportIssue[] = [];
    const cell = (key: string) => {
      const index = columnIndex.get(key);
      return index === undefined ? '' : source.cells[index] ?? '';
    };

    // Tên trước: trùng dòng trước trong file = lỗi; trùng dòng có sẵn = hỏi giữ / ghi đè (match).
    const nameKey = cell('display_name').toLowerCase();
    const firstRow = nameKey ? firstRowOfName.get(nameKey) : undefined;
    let match: ExistingRow | undefined;
    if (nameKey && firstRow === undefined) {
      firstRowOfName.set(nameKey, source.row);
      match = byName.get(nameKey);
    }

    const data: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = cell(col.key);
      data[col.key] = null;
      if (!raw) {
        if (col.required) issues.push({ column: col.key, code: 'required' });
      } else if (col.key === 'sort_order') {
        if (/^\d+$/.test(raw) && Number(raw) <= CONFIG_ORDER_MAX) data[col.key] = Number(raw);
        else issues.push({ column: col.key, code: 'invalid_value', value: raw });
      } else if (col.key === 'is_active') {
        const state = parseState(raw);
        if (state === null) issues.push({ column: col.key, code: 'invalid_value', value: raw });
        else data[col.key] = state;
      } else if (col.list) {
        const entry = entries[col.list]?.get(raw.toLowerCase());
        if (!entry) issues.push({ column: col.key, code: 'not_found', value: raw });
        // Giá trị đã ẩn: chỉ lỗi nếu ĐỔI sang nó — dòng có sẵn đang giữ đúng giá trị đó thì giữ nguyên được (như form sửa).
        else if (!entry.usable && match?.[col.key] !== entry.id) issues.push({ column: col.key, code: 'inactive', value: raw });
        else data[col.key] = entry.id;
      } else if (col.max && raw.length > col.max) {
        issues.push({ column: col.key, code: 'too_long', max: col.max });
      } else {
        data[col.key] = raw;
      }
    }
    const name = data.display_name as string | null;
    if (firstRow !== undefined) issues.push({ column: 'display_name', code: 'name_in_file', value: cell('display_name'), count: firstRow });

    if (issues.length) {
      invalid++;
      rows.push({ row: source.row, serial_number: name ?? (cell('display_name') || null), issues, duplicate_of: null });
    } else if (match) {
      duplicates++;
      rows.push({ row: source.row, serial_number: name, issues: [], duplicate_of: 'existing' });
      const current = match;
      // 3 Type / Group hệ thống (Tester, Base, Fixture) khóa — không ghi đè.
      if (current.kind === undefined || current.kind === 'sub_equipment') {
        updates.push({ id: current.id, ...Object.fromEntries(columns.map((c) => [c.key, data[c.key] ?? current[c.key] ?? null])) });
      }
    } else {
      // Dòng mới: Order trống = 0, In use trống = đang dùng.
      inserts.push({ ...data, sort_order: data.sort_order ?? 0, is_active: data.is_active ?? true });
    }
  }

  return {
    report: {
      total: table.rows.length, valid: table.rows.length - invalid, invalid, duplicates,
      committed: false, created: 0, ignored_columns: ignored, rows,
    },
    inserts, updates,
  };
}

/**
 * File báo lỗi: chính các dòng của file đã chọn (cùng số dòng) — dòng lỗi tô ĐỎ (ô sai tô đậm hơn), dòng đã có trong Configuration tô VÀNG,
 * thêm cột "Problem" ghi lý do — để tìm đúng dòng cần sửa rồi chọn lại file. Dựng workbook mới (chữ thuần), không sửa file gốc.
 */
export async function configCheckFile(list: ConfigListDef, file: UploadedFile | null, language: Language): Promise<Buffer> {
  const t = textFor(language);
  const columns = columnsOf(list, language);
  const headerMap = headerMapOf(list, columns);
  const table = await readWorkbook(await readUpload(file), headerMap, 'display_name');
  const { report } = checkConfigTable(list, table, await loadLookups());
  const { columnIndex } = mapColumns(table, headerMap);
  const headerOf = (key: string) => columns.find((c) => c.key === key)?.header ?? key;
  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  const wb = new ExcelJS.Workbook();
  const headerRow = table.headerRow ?? 1;
  const problemColumn = table.headers.length + 1;
  const ws = wb.addWorksheet(t('imp.checkSheet'), { views: [{ state: 'frozen', ySplit: headerRow }] });
  [...table.headers, t('imp.colProblem')].forEach((header, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill('FF002B49');
  });

  const byRow = new Map(report.rows.map((r) => [r.row, r]));
  for (const source of table.rows) {
    source.cells.forEach((value, i) => { if (value) ws.getCell(source.row, i + 1).value = value; });
    const problem = byRow.get(source.row);
    if (!problem) continue;
    const bad = problem.issues.length > 0;
    for (let c = 1; c <= problemColumn; c++) ws.getCell(source.row, c).fill = fill(bad ? 'FFFDE2E1' : 'FFFFF3CD');
    for (const issue of problem.issues) {
      const index = columnIndex.get(issue.column);
      if (index === undefined) continue;
      const cell = ws.getCell(source.row, index + 1);
      cell.fill = fill('FFF4A6A0');
      cell.font = { bold: true, color: { argb: 'FFB42318' } };
    }
    const text = bad
      ? problem.issues.map((i) => t(`imp.issue.${i.code}`, { column: headerOf(i.column), value: i.value ?? '', max: i.max ?? '', count: i.count ?? '' })).join('\n')
      : t('cimp.duplicateRow');
    const cell = ws.getCell(source.row, problemColumn);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    cell.font = { color: { argb: bad ? 'FFB42318' : 'FF8A5100' } };
  }
  table.headers.forEach((h, i) => { ws.getColumn(i + 1).width = Math.min(Math.max(h.length + 4, 14), 40); });
  ws.getColumn(problemColumn).width = 60;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * commit = false: chỉ kiểm tra. commit = true: kiểm tra lại từ đầu, hết lỗi mới ghi. Dòng trùng tên có sẵn: `onDuplicate` = 'keep' (bỏ qua,
 * giữ bản gốc) hoặc 'overwrite' (sửa dòng có sẵn). Dòng mới ghi trước, rồi mới ghi đè: nếu bước sau lỗi, chạy lại cùng file (chọn ghi đè)
 * là xong — các dòng đã thêm lúc này chỉ là dòng trùng tên.
 */
export async function importConfigFile(
  list: ConfigListDef, file: UploadedFile | null, commit: boolean, actor: string, onDuplicate: 'keep' | 'overwrite' = 'keep',
): Promise<ImportReport> {
  const columns = columnsOf(list);
  const table = await readWorkbook(await readUpload(file), headerMapOf(list, columns), 'display_name');
  const { report, inserts, updates } = checkConfigTable(list, table, await loadLookups());
  if (report.invalid > 0 || !commit) return report;
  const created = inserts.length ? await insertMany(list.table, inserts, actor) : 0;
  const updated = onDuplicate === 'overwrite' && updates.length ? await updateMany(list.table, updates, actor) : 0;
  return { ...report, committed: true, created, updated };
}
