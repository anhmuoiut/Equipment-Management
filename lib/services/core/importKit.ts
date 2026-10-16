import 'server-only';

/**
 * Bộ dùng chung của ba lần import Excel (Equipment, Calibration/sub-equipment, Golden): đọc file, tiêu đề cột,
 * giới hạn, và dựng file mẫu theo Configuration lúc tải (docs/ARCHITECTURE.md §7).
 *
 * File mẫu chỉ có hai sheet: sheet nhập (dòng 1 là tiêu đề, `*` = bắt buộc, nhập từ dòng 2; cột chọn có ô thả xuống lấy từ sheet
 * "Giá trị hợp lệ") và sheet "Giá trị hợp lệ" (nguồn của các ô thả xuống). Không có dòng ghi chú, không có sheet hướng dẫn.
 */
import ExcelJS from 'exceljs';
import { AppError } from '@/lib/errors';
import { textFor, type Language } from '@/lib/i18n/text';
import { IMPORT_MAX_FILE_MB, IMPORT_MAX_ROWS, type ImportFileError } from '@/lib/equipmentImport';

// ---------------------------------------------------------------------------
// Hằng số, tiện ích
// ---------------------------------------------------------------------------

export const PRUSSIAN = 'FF002B49';
export const STAR = 'FFFFD54F';

type Validations = { add(range: string, validation: Record<string, unknown>): void };
export const validationsOf = (ws: ExcelJS.Worksheet) => (ws as unknown as { dataValidations: Validations }).dataValidations;

/**
 * Gắn một quy tắc kiểm tra dữ liệu cho cả cột (dòng `from` → `to`) bằng TỪNG Ô một. Không dùng khóa dạng vùng ("A2:A1001"): exceljs 3.x
 * không nhận khóa vùng — optimiseDataValidations giải mã nó thành MỘT ô rồi lỗi "Cannot set properties of undefined (setting 'marked')"
 * khi ghi file (4.4+ thì nhận). Khóa từng ô chạy được ở cả hai bản, và khi ghi file exceljs gộp các ô giống hệt nhau thành một vùng.
 *
 * `_digits` (số chữ số của số dòng) chia cột thành các khúc 2–9, 10–99, 100–999, 1000+: exceljs duyệt các ô theo thứ tự CHỮ ("A10" đứng
 * trước "A2") và mở rộng mỗi vùng xuống tận ô cuối giống hệt, nên không có dấu này thì "A2" tạo vùng A2:A1001 chồng lên A10:A1001 —
 * Excel coi vùng chồng nhau là file lỗi. Khúc khác nhau thì dừng đúng chỗ → các vùng liền nhau, không chồng. Thuộc tính này không được
 * ghi ra file (exceljs chỉ ghi các thuộc tính nó biết).
 */
function addColumnValidation(ws: ExcelJS.Worksheet, letter: string, from: number, to: number, validation: Record<string, unknown>): void {
  const validations = validationsOf(ws);
  for (let row = from; row <= to; row++) validations.add(`${letter}${row}`, { ...validation, _digits: String(row).length });
}

export const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export function fileError(code: ImportFileError, extra: Record<string, unknown> = {}): AppError {
  return new AppError('VALIDATION_ERROR', { fields: { file: code }, ...extra });
}

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const serialKey = (serial: string) => serial.trim().toLowerCase();

/** Tiêu đề cột → trường. Nhận cả "Serial number *", "SERIAL NUMBER", "serial_number". */
export function headerKeys<K extends string>(columns: readonly { key: K; header: string }[]): Map<string, K> {
  return new Map(columns.flatMap((c) => [
    [normalize(c.header), c.key] as const,
    [normalize(c.key), c.key] as const,
    [normalize(c.key.replace(/_id$/, '')), c.key] as const,
  ]));
}

// ---------------------------------------------------------------------------
// Đọc file
// ---------------------------------------------------------------------------

export type SheetTable = { headers: string[]; rows: { row: number; cells: string[] }[]; /** Dòng chứa tiêu đề cột (để dựng file báo lỗi đúng số dòng). */ headerRow?: number };

/** Chữ trong ô — số, công thức, rich text, link đều về chuỗi đã cắt khoảng trắng. */
export function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('').trim();
    if ('formula' in value || 'sharedFormula' in value) {
      return cellText((value as { result?: ExcelJS.CellValue }).result);
    }
    if ('text' in value) return cellText(value.text as ExcelJS.CellValue);
    if ('error' in value) return '';
  }
  return String(value).trim();
}

/**
 * Sheet có cột Serial number trong 5 dòng đầu; dòng đó là tiêu đề, dữ liệu ở các dòng bên dưới (bỏ dòng trống).
 * File mẫu hiện tại: tiêu đề ở dòng 1. File mẫu cũ (dòng 1 ghi chú, dòng 2 tiêu đề) vẫn đọc được.
 * `anchor`: cột đánh dấu dòng tiêu đề (mặc định serial_number; Configuration dùng display_name).
 */
export async function readWorkbook(buffer: Buffer, keys: Map<string, string>, anchor = 'serial_number'): Promise<SheetTable> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw fileError('unreadable');
  }
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const headers: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) headers.push(cellText(row.getCell(c).value));
      if (!headers.some((h) => keys.get(normalize(h)) === anchor)) continue;

      const rows: SheetTable['rows'] = [];
      ws.eachRow({ includeEmpty: false }, (dataRow, number) => {
        if (number <= r) return;
        const cells = headers.map((_h, c) => cellText(dataRow.getCell(c + 1).value));
        if (cells.some(Boolean)) rows.push({ row: number, cells });
      });
      return { headers, rows, headerRow: r };
    }
  }
  return { headers: [], rows: [] };
}

export type UploadedFile = Blob & { name?: string };

/** File upload hợp lệ (có, .xlsx, không quá lớn) → nội dung. */
export async function readUpload(file: UploadedFile | null): Promise<Buffer> {
  if (!file || !file.size) throw fileError('required');
  if (!/\.xlsx$/i.test(file.name ?? '')) throw fileError('not_xlsx');
  if (file.size > IMPORT_MAX_FILE_MB * 1024 * 1024) throw fileError('too_large', { max: IMPORT_MAX_FILE_MB });
  return Buffer.from(await file.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Giá trị chọn được
// ---------------------------------------------------------------------------

export type Entry = { id: string; usable: boolean; name: string };

export function indexBy<T extends { id: string; display_name: string }>(map: Map<string, T>, usable: (row: T) => boolean) {
  const out = new Map<string, Entry>();
  map.forEach((row) => out.set(row.display_name.trim().toLowerCase(), { id: row.id, usable: usable(row), name: row.display_name }));
  return out;
}

/** Tên các giá trị đang dùng, đúng thứ tự Configuration (display_name, sort_order). */
export function activeNames(items: { display_name: string; sort_order: number; is_active: boolean }[]): string[] {
  return items
    .filter((i) => i.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name, undefined, { numeric: true }))
    .map((i) => i.display_name);
}

// ---------------------------------------------------------------------------
// Cha / tester có sẵn
// ---------------------------------------------------------------------------

/** Một equipment có sẵn có thể làm cha (tester / fixture…) — để tìm theo serial trong file import. */
export type ParentCandidate = { id: string; serial_number: string; part_number: string; kind: string | null; location_id: string };

export function bySerial<T extends { serial_number: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  rows.forEach((r) => out.set(serialKey(r.serial_number), [...(out.get(serialKey(r.serial_number)) ?? []), r]));
  return out;
}

/**
 * Tìm cha theo serial (+ part number khi serial trùng nhau) trong thiết bị đã có. Không thấy → parent_not_found;
 * nhiều hơn một → parent_ambiguous.
 */
export function findExistingParent(
  serial: string, partNumber: string, pool: Map<string, ParentCandidate[]>,
): { parent: ParentCandidate } | { code: 'parent_not_found' | 'parent_ambiguous'; count: number } {
  const part = partNumber.toLowerCase();
  const found = (pool.get(serialKey(serial)) ?? []).filter((c) => !part || c.part_number.toLowerCase() === part);
  if (found.length === 1) return { parent: found[0]! };
  return found.length === 0 ? { code: 'parent_not_found', count: 0 } : { code: 'parent_ambiguous', count: found.length };
}

// ---------------------------------------------------------------------------
// File mẫu
// ---------------------------------------------------------------------------

export type TemplateColumn = {
  key: string;
  header: string;
  required?: boolean;
  /** Bắt buộc, trừ khi dòng được gắn vào cha / tester (Location theo cha). */
  requiredUnlessParent?: boolean;
  /** Cột chữ: số ký tự tối đa. */
  max?: number;
  /** Cột chọn: tên danh sách (khóa của `choices`) và tên trang Configuration tương ứng. */
  list?: string;
  page?: string;
  /** Danh sách cố định của ứng dụng (ví dụ Status), không phải của Configuration. */
  fixed?: boolean;
  /** Một ô nhận nhiều giá trị, cách nhau dấu ; (ví dụ Tags): không có ô thả xuống. */
  multi?: boolean;
  width: number;
};

export type TemplateSpec = {
  columns: readonly TemplateColumn[];
  /** Giá trị chọn được của từng danh sách (khóa = TemplateColumn.list). */
  choices: Record<string, string[]>;
  /** Tên sheet nhập. */
  sheet: string;
  /** Cột chọn mà giá trị ngoài danh sách chỉ cảnh báo, không chặn (ví dụ part number của cha có thể đã ẩn). */
  lenientLists?: readonly string[];
  language: Language;
  now?: Date;
  /** Dòng dữ liệu điền sẵn từ dòng 2 (khóa = TemplateColumn.key; giá trị rỗng = ô trống): file XUẤT dùng đúng bố cục file mẫu. */
  rows?: Record<string, string>[];
};

export async function buildImportTemplate(spec: TemplateSpec): Promise<Buffer> {
  const t = textFor(spec.language);
  const now = spec.now ?? new Date();
  const { columns, choices } = spec;
  const valuesName = t('imp.tpl.sheetValues');
  const errorTitle = clip(t('imp.tpl.errorTitle'), 32);
  const lists = [...new Set(columns.flatMap((c) => (c.list ? [c.list] : [])))];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Equipment Management';
  wb.created = now;

  // ---- Sheet nhập: dòng 1 là tiêu đề (`*` = bắt buộc), nhập từ dòng 2. Chỉ có ô thả xuống / kiểm tra độ dài — không ghi chú, không hướng dẫn.
  const ws = wb.addWorksheet(spec.sheet, { views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }] });
  const firstRow = 2;
  const lastRow = Math.max(IMPORT_MAX_ROWS, spec.rows?.length ?? 0) + 1;
  columns.forEach((col, i) => {
    const column = ws.getColumn(i + 1);
    column.width = col.width;
    // Ô dạng chữ: giữ số 0 đầu serial / part number, Level "1" khớp đúng danh sách thả xuống.
    column.numFmt = '@';

    const header = ws.getCell(1, i + 1);
    const font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.value = col.required || col.requiredUnlessParent
      ? { richText: [{ text: col.header, font }, { text: ' *', font: { bold: true, color: { argb: STAR } } }] }
      : col.header;
    header.font = font;
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRUSSIAN } };
    header.alignment = { vertical: 'middle' };

    // Nhiều giá trị trong một ô ("A; B", ví dụ Tags): ô thả xuống chỉ nhận một giá trị nên không đặt — giá trị hợp lệ ở sheet Giá trị hợp lệ.
    if (col.list && col.multi) return;
    if (col.list) {
      const count = (choices[col.list] ?? []).length;
      if (count === 0) return;
      const letter = String.fromCharCode(65 + lists.indexOf(col.list)); // cột của danh sách ở sheet Giá trị hợp lệ
      const strict = !spec.lenientLists?.includes(col.key);
      addColumnValidation(ws, column.letter!, firstRow, lastRow, {
        type: 'list', allowBlank: true, formulae: [`'${valuesName}'!$${letter}$2:$${letter}$${count + 1}`],
        showErrorMessage: true, errorStyle: strict ? 'stop' : 'warning', errorTitle, error: clip(t('imp.tpl.errorList'), 255),
      });
    } else {
      addColumnValidation(ws, column.letter!, firstRow, lastRow, {
        type: 'textLength', operator: 'lessThanOrEqual', allowBlank: true, formulae: [col.max],
        showErrorMessage: true, errorStyle: 'stop', errorTitle, error: clip(t('imp.tpl.errorText', { max: col.max ?? 0 }), 255),
      });
    }
  });
  ws.getRow(1).height = 20;
  spec.rows?.forEach((row, r) => columns.forEach((col, i) => {
    const value = row[col.key];
    if (value) ws.getCell(r + 2, i + 1).value = value;
  }));

  // ---- Giá trị hợp lệ (nguồn của các ô thả xuống — không sửa ở đây).
  const vs = wb.addWorksheet(valuesName, { views: [{ state: 'frozen', ySplit: 1 }] });
  lists.forEach((list, i) => {
    const col = columns.find((c) => c.list === list)!;
    const values = choices[list] ?? [];
    const column = vs.getColumn(i + 1);
    column.width = Math.max(col.width, ...values.map((v) => Math.min(v.length + 2, 60)));
    column.numFmt = '@';
    const header = vs.getCell(1, i + 1);
    header.value = col.header;
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRUSSIAN } };
    values.forEach((value, j) => { vs.getCell(j + 2, i + 1).value = value; });
  });
  await vs.protect('', { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, sort: true });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
