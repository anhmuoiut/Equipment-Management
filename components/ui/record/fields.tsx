'use client';

/**
 * Trường và nhóm trường của một bản ghi (docs/DETAIL_MODEL.md 3.5): module khai báo
 * FieldDef / SectionDef, khung RecordModal vẽ chúng ở chế độ xem (FieldView) và sửa
 * (FieldEditor). Nhóm cuối "Thông tin hệ thống" (SystemInfoSection) là của khung.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '@/lib/client/api';
import { RequiredMark } from '@/components/ui';
import { SearchableSelect, type SelectOption } from '@/components/ui/SearchableSelect';
import type { Audit } from '@/lib/types';

export type Draft = Record<string, unknown>;
export type FieldKind = 'text' | 'textarea' | 'select' | 'radio' | 'date' | 'number' | 'checkboxes' | 'boolean' | 'password';

export type FieldDef<R> = {
  key: string;
  label: string;
  kind?: FieldKind;
  required?: boolean | ((draft: Draft) => boolean);
  options?: SelectOption[] | ((draft: Draft, record: R | null) => SelectOption[]);
  /** Vẽ một lựa chọn của ô radio (ví dụ chip màu) — dùng cả khi xem. */
  optionView?: (option: SelectOption) => ReactNode;
  /** Hiển thị khi xem (mặc định: giá trị / nhãn lựa chọn). */
  view?: (record: R) => ReactNode;
  /** Ô nhập tuỳ biến thay cho `kind` (ví dụ chọn thẻ có màu, chọn thiết bị cha tìm từ server); giá trị lưu vào draft như các ô khác. */
  editor?: (props: { id: string; value: unknown; onChange: (value: unknown) => void; label: string; draft: Draft; record: R | null }) => ReactNode;
  /** Hiển thị khi đang thêm / sửa mà ô bị khóa — theo giá trị đang nhập (ví dụ vị trí theo thiết bị cha đang chọn). */
  draftView?: (draft: Draft) => ReactNode;
  /**
   * Người dùng vừa đổi ô này: trả về giá trị điền sẵn cho các ô khác (ví dụ chọn part number → Level của nó). `draft` là trạng thái
   * TRƯỚC khi đổi. Chỉ chạy khi nhập tay, không chạy khi khung đặt giá trị ban đầu.
   */
  afterChange?: (value: unknown, draft: Draft, record: R | null) => Draft | undefined;
  /** Khóa khi sửa; lý do dùng để xác định trạng thái khóa, không hiển thị mô tả dưới ô. */
  lock?: (record: R | null, draft: Draft) => string | null;
  /** Luôn chỉ đọc (ví dụ trường tự tính). */
  readOnly?: boolean;
  /** Legacy metadata accepted for compatibility; field guidance is not rendered. */
  hint?: string;
  editHint?: string;
  wide?: boolean;
  /** Chỉ có khi thêm mới (ví dụ mật khẩu ban đầu). */
  createOnly?: boolean;
  /** Không có khi thêm mới. */
  hideInCreate?: boolean;
  /** Trường chỉ dùng khi nhập: hiện (và kiểm tra, gửi đi) khi đang thêm / sửa và điều kiện đúng. */
  when?: (draft: Draft, record: R | null) => boolean;
  min?: number;
  max?: number;
  maxLength?: number;
};

export type SectionDef<R> = {
  key: string;
  title: string;
  fields?: FieldDef<R>[];
  /** Nhóm tự vẽ (extension point, nhóm chỉ đọc của module khác). */
  render?: (record: R) => ReactNode;
  /** Nội dung chỉ đọc nối sau các trường khi xem (ví dụ thiết bị con, sub-equipment của một thiết bị). */
  viewExtra?: (record: R) => ReactNode;
  hideInCreate?: boolean;
};

export const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function optionsOf<R>(f: FieldDef<R>, draft: Draft, record: R | null): SelectOption[] {
  return typeof f.options === 'function' ? f.options(draft, record) : f.options ?? [];
}

/** Một nhóm trường: tiêu đề nhỏ viết hoa + lưới 2 cột. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dp-section">
      <h3 className="dp-section-title">{title}</h3>
      <div className="dp-grid">{children}</div>
    </section>
  );
}

/** Long read-only values stay within their column; relationship lists own their Show more behavior. */
export function ReadonlyValue({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const previewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [managed, setManaged] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const preview = previewRef.current;
    if (!content || !preview) return;
    function measure() {
      if (!content || !preview) return;
      const ownsOverflow = !!content.querySelector('.eq-rel');
      const limit = Number.parseFloat(getComputedStyle(preview).fontSize) * 4.8;
      setManaged(ownsOverflow);
      setOverflowing(!ownsOverflow && content.scrollHeight > limit + 1);
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(content);
    observer?.observe(preview);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [children]);

  return (
    <div className="dp-value dp-value-collapsible">
      <div ref={previewRef} id={id} className="dp-value-preview" data-clipped={overflowing && !expanded && !managed || undefined}
        onFocusCapture={(event) => {
          if (expanded || managed || !overflowing || !previewRef.current) return;
          const target = event.target as HTMLElement;
          if (target.getBoundingClientRect().bottom > previewRef.current.getBoundingClientRect().bottom + 1) setExpanded(true);
        }}>
        <div ref={contentRef} className="dp-value-content">{children}</div>
      </div>
      {overflowing && (
        <button type="button" className="dp-value-more" aria-expanded={expanded} aria-controls={id}
          aria-label={t(expanded ? 'dp.showLessField' : 'dp.showMoreField', { name: label })}
          onClick={() => setExpanded((value) => !value)}>
          {t(expanded ? 'dp.showLess' : 'dp.showMore')}
        </button>
      )}
    </div>
  );
}

/** Một trường khi xem; trống → —. Desktop có hai trường mỗi hàng, phone có nhãn / giá trị. */
export function DetailValue({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="dp-field dp-field-view" data-wide={wide || undefined}>
      <span className="dp-label">{label}</span>
      <ReadonlyValue label={label}>{empty ? <span className="dp-empty">—</span> : children}</ReadonlyValue>
    </div>
  );
}

/** Nhóm cuối của mọi bản ghi: Tạo bởi · Tạo lúc · Cập nhật bởi · Cập nhật lúc. */
export function SystemInfoSection({ record }: { record: Audit }) {
  const { t } = useTranslation();
  return (
    <DetailSection title={t('dp.systemInfo')}>
      <DetailValue label={t('fields.created_by')}>{record.created_by_name}</DetailValue>
      <DetailValue label={t('fields.created_at')}>{formatTime(record.created_at)}</DetailValue>
      <DetailValue label={t('fields.updated_by')}>{record.updated_by_name}</DetailValue>
      <DetailValue label={t('fields.updated_at')}>{formatTime(record.updated_at)}</DetailValue>
    </DetailSection>
  );
}

export function FieldView<R>({ field, record, draft, editing }: { field: FieldDef<R>; record: R | null; draft: Draft; editing: boolean }) {
  const { t } = useTranslation();
  let content: ReactNode;
  if (editing && field.draftView) content = field.draftView(draft);
  else if (field.view && record) content = field.view(record);
  else {
    const raw = editing && !field.readOnly && field.key in draft
      ? draft[field.key]
      : record ? (record as Record<string, unknown>)[field.key] : null;
    if (field.kind === 'select' || field.kind === 'radio') {
      const opt = optionsOf(field, draft, record).find((o) => o.value === raw);
      content = opt ? field.optionView?.(opt) ?? opt.label : null;
    } else if (field.kind === 'boolean') content = raw === null || raw === undefined ? null : raw ? t('common.yes') : t('common.no');
    else if (field.kind === 'checkboxes' && Array.isArray(raw)) {
      const opts = optionsOf(field, draft, record);
      content = raw.map((v) => opts.find((o) => o.value === v)?.label ?? String(v)).join(', ');
    } else content = raw === null || raw === undefined ? null : String(raw);
  }
  return <DetailValue label={field.label} wide={field.wide}>{content}</DetailValue>;
}

export function FieldEditor<R>({ field, record, draft, required, error, onChange }: {
  field: FieldDef<R>; record: R | null; draft: Draft; required: boolean; error?: string; onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const lockReason = field.lock?.(record, draft);
  if (lockReason) return <FieldView field={field} record={record} draft={draft} editing />;
  const value = draft[field.key];
  const id = `f-${field.key}`;
  const kind = field.kind ?? 'text';
  let input: ReactNode;
  if (field.editor) {
    input = field.editor({ id, value, onChange, label: field.label, draft, record });
  } else if (kind === 'select') {
    input = (
      <SearchableSelect value={(value as string | null) ?? ''} onChange={(v) => onChange(v || null)}
        options={optionsOf(field, draft, record)} clearable={!required} placeholder={t('dp.selectPlaceholder')} ariaLabel={field.label} />
    );
  } else if (kind === 'radio') {
    input = (
      <div className="dp-radios" role="radiogroup" aria-label={field.label}>
        {optionsOf(field, draft, record).map((o) => (
          <label key={o.value}>
            <input type="radio" name={id} value={o.value} checked={value === o.value} disabled={o.disabled}
              onChange={() => onChange(o.value)} />
            {field.optionView ? field.optionView(o) : o.label}
          </label>
        ))}
      </div>
    );
  } else if (kind === 'textarea') {
    input = <textarea id={id} rows={3} value={(value as string | null) ?? ''} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />;
  } else if (kind === 'checkboxes') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    input = (
      <div className="dp-checks" role="group" aria-label={field.label}>
        {optionsOf(field, draft, record).map((o) => (
          <label key={o.value}>
            <input type="checkbox" checked={list.includes(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((v) => v !== o.value))} />
            {o.label}
          </label>
        ))}
      </div>
    );
  } else if (kind === 'boolean') {
    input = (
      <label className="dp-switch">
        <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {value ? t('common.yes') : t('common.no')}
      </label>
    );
  } else if (kind === 'number') {
    input = (
      <input id={id} type="number" inputMode="numeric" min={field.min} max={field.max}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    );
  } else {
    input = (
      <input id={id} type={kind === 'date' ? 'date' : kind === 'password' ? 'password' : 'text'}
        autoComplete={kind === 'password' ? 'new-password' : 'off'} maxLength={field.maxLength}
        value={(value as string | null) ?? ''} onChange={(e) => onChange(e.target.value)} />
    );
  }
  return (
    <div className="dp-field" data-wide={field.wide || kind === 'textarea' || kind === 'checkboxes' || kind === 'radio' || undefined} data-invalid={!!error || undefined}>
      <label className="dp-label" htmlFor={id}>{field.label}{required && <RequiredMark />}</label>
      <div className="dp-input">{input}</div>
      {error && <span className="dp-error" role="alert">{error}</span>}
    </div>
  );
}

/**
 * Ô nhập ngoài form của khung (màn hình thao tác, Account settings) — cùng kiểu với ô của form.
 * `htmlFor`: nhãn thật gắn với ô nhập (bắt buộc cho input / textarea); `wide: false`: nửa hàng.
 */
export function ActionField({ label, required, children, error, htmlFor, wide = true }: {
  label: string; required?: boolean; children: ReactNode; hint?: ReactNode; error?: string; htmlFor?: string; wide?: boolean;
}) {
  const text = <>{label}{required && <RequiredMark />}</>;
  return (
    <div className="dp-field" data-wide={wide || undefined} data-invalid={!!error || undefined}>
      {htmlFor ? <label className="dp-label" htmlFor={htmlFor}>{text}</label> : <span className="dp-label">{text}</span>}
      <div className="dp-input">{children}</div>
      {error && <span className="dp-error" role="alert">{error}</span>}
    </div>
  );
}
