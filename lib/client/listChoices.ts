import type { SelectOption } from '@/components/ui/SearchableSelect';

/**
 * Lựa chọn của bộ lọc cột ở danh sách phân trang (Column.choices). Trước đây trình duyệt suy ra chúng từ mọi dòng đã tải; giờ chỉ có một
 * trang nên lấy từ nguồn đầy đủ: danh sách Configuration (/api/options) cho tên, mã enum cho Status, và /api/filter-values cho chữ tự do.
 * Sắp xếp theo nhãn, số tự nhiên (SN2 < SN10) như bộ lọc cũ.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byLabel = (a: SelectOption, b: SelectOption) => collator.compare(a.label, b.label);

/** Mục của Configuration (id → tên). Lọc theo id: tên đổi thì bộ lọc vẫn đúng. */
export function namedChoices(items: readonly { id: string; display_name: string }[] | undefined): SelectOption[] {
  return (items ?? []).map((item) => ({ value: item.id, label: item.display_name })).sort(byLabel);
}

/** Chữ tự do trong dữ liệu (serial của cha / tester, origin…): giá trị chính là nhãn. */
export function textChoices(values: readonly string[] | undefined): SelectOption[] {
  return (values ?? []).map((value) => ({ value, label: value })).sort(byLabel);
}

/** Mã enum cố định (Status, Calibration Status, kết quả): giữ thứ tự của hệ thống, nhãn đã dịch. */
export function enumChoices<T extends string>(values: readonly T[], label: (value: T) => string): SelectOption[] {
  return values.map((value) => ({ value, label: label(value) }));
}
