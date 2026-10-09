import 'server-only';

/**
 * Bộ dùng chung của ba lần import Excel (Equipment, Calibration/sub-equipment, Golden): đọc file, tiêu đề cột,
 * giới hạn, và dựng file mẫu theo Configuration lúc tải (docs/DETAIL_MODEL.md mục 6).
 *
 * File mẫu: dòng 1 ghi chú từng cột nhận gì, dòng 2 là tiêu đề (`*` = bắt buộc), nhập từ dòng 3. Cột chọn có ô thả
 * xuống lấy từ sheet "Giá trị hợp lệ", bấm vào ô hiện chú thích; thêm sheet Hướng dẫn.
 */
import ExcelJS from 'exceljs';
import { AppError } from '@/lib/errors';
import { textFor, type Language } from '@/lib/i18n/text';
import { IMPORT_MAX_FILE_MB, IMPORT_MAX_ROWS, type ImportFileError } from '@/lib/equipmentImport';

// ---------------------------------------------------------------------------
// Hằng số, tiện ích
// ---------------------------------------------------------------------------

export const PRUSSIAN = 'FF002B49';
export const NOTE_FILL = 'FFEAF6FC';
export const NOTE_INK = 'FF33495C';
export const STAR = 'FFFFD54F';
/** Ghi chú dòng 1 chỉ liệt kê nguyên danh sách khi danh sách ngắn. */
export const SHORT_LIST = 80;

export type Text = ReturnType<typeof textFor>;
type Validations = { add(range: string, validation: Record<string, unknown>): void };
export const validationsOf = (ws: ExcelJS.Worksheet) => (ws as unknown as { dataValidations: Validations }).dataValidations;

export const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Ước lượng chiều cao dòng (Excel không tự giãn dòng có chữ xuống dòng). */
export function fitHeight(texts: { text: string; width: number }[], lineHeight = 15): number {
  const lines = Math.max(1, ...texts.map(({ text, width }) =>
    text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(width * 1.05, 1))), 0)));
  return Math.min(lines * lineHeight + 4, 409);
}

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

export type SheetTable = { headers: string[]; rows: { row: number; cells: string[] }[] };

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
 * File mẫu: dòng 1 ghi chú, dòng 2 tiêu đề.
 */
export async function readWorkbook(buffer: Buffer, keys: Map<string, string>): Promise<SheetTable> {
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
      if (!headers.some((h) => keys.get(normalize(h)) === 'serial_number')) continue;

      const rows: SheetTable['rows'] = [];
      ws.eachRow({ includeEmpty: false }, (dataRow, number) => {
        if (number <= r) return;
        const cells = headers.map((_h, c) => cellText(dataRow.getCell(c + 1).value));
        if (cells.some(Boolean)) rows.push({ row: number, cells });
      });
      return { headers, rows };
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
  guideTitle: string;
  /** Các bước trong sheet Hướng dẫn (đã dịch). */
  steps: string[];
  /** Ghi chú đứng trước phần "chọn / chữ" của cột (ví dụ cách ghi serial cha). */
  leadingNotes?: (col: TemplateColumn, t: Text) => string[];
  /** Quy tắc riêng của cột (ngoài bắt buộc / độ dài / danh sách). */
  extraRules?: (col: TemplateColumn, t: Text) => string[];
  /** Cột chọn mà giá trị ngoài danh sách chỉ cảnh báo, không chặn (ví dụ part number của cha có thể đã ẩn). */
  lenientLists?: readonly string[];
  language: Language;
  now?: Date;
};

export async function buildImportTemplate(spec: TemplateSpec): Promise<Buffer> {
  const t = textFor(spec.language);
  const now = spec.now ?? new Date();
  const { columns, choices } = spec;
  const guideName = t('imp.tpl.sheetGuide');
  const valuesName = t('imp.tpl.sheetValues');
  const errorTitle = clip(t('imp.tpl.errorTitle'), 32);
  const lists = [...new Set(columns.flatMap((c) => (c.list ? [c.list] : [])))];
  const rulesOf = (col: TemplateColumn) => spec.extraRules?.(col, t) ?? [];

  const noteOf = (col: TemplateColumn): string => {
    const parts: string[] = [];
    if (col.required) parts.push(t('imp.tpl.required'));
    if (col.requiredUnlessParent) parts.push(t('imp.tpl.requiredUnlessParent'));
    parts.push(...(spec.leadingNotes?.(col, t) ?? []));
    if (col.list) {
      const values = choices[col.list] ?? [];
      const joined = values.join(', ');
      if (!values.length) parts.push(t('imp.tpl.noValues'));
      else if (joined.length <= SHORT_LIST) parts.push(t(col.multi ? 'imp.tpl.pickMultiShort' : 'imp.tpl.pickShort', { values: joined }));
      else parts.push(t(col.multi ? 'imp.tpl.pickMultiMany' : 'imp.tpl.pickMany', { count: values.length, sheet: valuesName }));
    } else {
      parts.push(t('imp.tpl.text', { max: col.max ?? 0 }));
    }
    return [...parts, ...rulesOf(col)].join(' · ');
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Equipment Management';
  wb.created = now;

  // ---- Sheet nhập: dòng 1 ghi chú, dòng 2 tiêu đề, nhập từ dòng 3.
  const ws = wb.addWorksheet(spec.sheet, { views: [{ state: 'frozen', ySplit: 2, activeCell: 'A3' }] });
  const lastRow = IMPORT_MAX_ROWS + 2;
  const notes = columns.map(noteOf);
  columns.forEach((col, i) => {
    const text = notes[i] ?? '';
    const column = ws.getColumn(i + 1);
    column.width = col.width;
    // Ô dạng chữ: giữ số 0 đầu serial / part number, Level "1" khớp đúng danh sách thả xuống.
    column.numFmt = '@';

    const note = ws.getCell(1, i + 1);
    note.value = text;
    note.font = { size: 9, italic: true, color: { argb: NOTE_INK } };
    note.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NOTE_FILL } };
    note.alignment = { wrapText: true, vertical: 'top' };

    const header = ws.getCell(2, i + 1);
    const font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.value = col.required || col.requiredUnlessParent
      ? { richText: [{ text: col.header, font }, { text: ' *', font: { bold: true, color: { argb: STAR } } }] }
      : col.header;
    header.font = font;
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRUSSIAN } };
    header.alignment = { vertical: 'middle' };

    const range = `${column.letter}3:${column.letter}${lastRow}`;
    const prompt = { showInputMessage: true, promptTitle: clip(col.header, 32), prompt: clip(text, 255) };
    if (col.list && col.multi) {
      // Nhiều giá trị trong một ô ("A; B"): ô thả xuống chỉ nhận một giá trị nên không đặt — giá trị hợp lệ ở sheet Giá trị hợp lệ.
      validationsOf(ws).add(range, { type: 'any', ...prompt });
    } else if (col.list) {
      const count = (choices[col.list] ?? []).length;
      const letter = String.fromCharCode(65 + lists.indexOf(col.list)); // cột của danh sách ở sheet Giá trị hợp lệ
      const strict = !spec.lenientLists?.includes(col.key);
      validationsOf(ws).add(range, count
        ? {
          type: 'list', allowBlank: true, formulae: [`'${valuesName}'!$${letter}$2:$${letter}$${count + 1}`], ...prompt,
          showErrorMessage: true, errorStyle: strict ? 'stop' : 'warning', errorTitle, error: clip(t('imp.tpl.errorList'), 255),
        }
        : { type: 'any', ...prompt });
    } else {
      validationsOf(ws).add(range, {
        type: 'textLength', operator: 'lessThanOrEqual', allowBlank: true, formulae: [col.max], ...prompt,
        showErrorMessage: true, errorStyle: 'stop', errorTitle, error: clip(t('imp.tpl.errorText', { max: col.max ?? 0 }), 255),
      });
    }
  });
  ws.getRow(1).height = fitHeight(columns.map((c, i) => ({ text: notes[i] ?? '', width: c.width * 1.15 })), 12);
  ws.getRow(2).height = 20;

  // ---- Hướng dẫn
  const guide = wb.addWorksheet(guideName);
  guide.columns = [{ width: 22 }, { width: 14 }, { width: 58 }, { width: 58 }];
  const time = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(now);
  guide.getCell('A1').value = spec.guideTitle;
  guide.getCell('A1').font = { bold: true, size: 14, color: { argb: PRUSSIAN } };
  guide.getCell('A2').value = t('imp.tpl.generated', { time });
  guide.getCell('A2').font = { italic: true, color: { argb: NOTE_INK } };
  spec.steps.forEach((step, i) => {
    const r = 4 + i;
    guide.mergeCells(r, 1, r, 4);
    const cell = guide.getCell(r, 1);
    cell.value = `${i + 1}. ${step}`;
    cell.alignment = { wrapText: true, vertical: 'top' };
    guide.getRow(r).height = fitHeight([{ text: cell.value, width: 140 }]);
  });
  const headRow = 4 + spec.steps.length + 1;
  guide.getRow(headRow).values = [t('imp.tpl.colColumn'), t('imp.tpl.colRequired'), t('imp.tpl.colRule'), t('imp.tpl.colValues')];
  guide.getRow(headRow).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRUSSIAN } };
  });
  columns.forEach((col, i) => {
    const rules: string[] = [...(spec.leadingNotes?.(col, t) ?? [])];
    let values = '';
    if (col.list) {
      if (col.multi) rules.push(t('imp.tpl.pickMulti', { page: col.page ?? col.header }));
      else if (!spec.lenientLists?.includes(col.key)) rules.push(col.fixed ? t('imp.tpl.pickFixed') : t('imp.tpl.pick', { page: col.page ?? col.header }));
      const list = choices[col.list] ?? [];
      const joined = list.join(', ');
      values = !list.length ? t('imp.tpl.noValues')
        : joined.length <= 400 ? joined : t('imp.tpl.pickMany', { count: list.length, sheet: valuesName });
    } else {
      rules.push(t('imp.tpl.text', { max: col.max ?? 0 }));
    }
    if (col.requiredUnlessParent) rules.push(t('imp.tpl.locationParent'));
    rules.push(...rulesOf(col));
    const rule = rules.join(' — ');
    const required = col.required ? t('imp.tpl.yes') : col.requiredUnlessParent ? t('imp.tpl.yesUnlessParent') : t('imp.tpl.no');

    const row = guide.getRow(headRow + 1 + i);
    row.values = [col.header, required, rule, values];
    row.getCell(1).font = { bold: true };
    if (col.required || col.requiredUnlessParent) row.getCell(2).font = { bold: true, color: { argb: 'FFC00000' } };
    row.eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' }; });
    row.height = fitHeight([{ text: required, width: 14 }, { text: rule, width: 58 }, { text: values, width: 58 }]);
  });

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
