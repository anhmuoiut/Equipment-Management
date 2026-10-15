'use client';

/**
 * Shared pastel tags. Manual palettes stay separate from operating and
 * calibration states; every viewport keeps the status text visible.
 */
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/client/api';
import { CALIBRATION_STATUS_COLOR, manualTagColor } from '@/lib/status';
import type { CalibrationStatus, StatusColor, TagItem } from '@/lib/types';

export function StatusTag({ name, color }: { name: string | null; color: StatusColor | null | undefined }) {
  if (!name) return null;
  const palette = manualTagColor(name, color);
  return (
    <span className="tag tag-status" data-status-color={palette} data-manual-color={palette}>{name}</span>
  );
}

export function ToneTag({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'alert' | 'neutral' | 'info' }) {
  return <span className="tag" data-tone={tone}>{text}</span>;
}

/** Trạng thái tài khoản: Hoạt động / Đã khóa (user_profiles.is_active). */
export function UserStatusTag({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return <ToneTag text={t(active ? 'values.active' : 'values.locked')} tone={active ? 'ok' : 'alert'} />;
}

/**
 * Operating state, independent of calibration deadlines. Only this tag has a dot.
 */
export function UsageTag({ usage }: { usage: 'in_use' | 'not_in_use' }) {
  const { t } = useTranslation();
  const label = t(`values.${usage}`);
  return (
    <span className="tag tag-usage" data-usage={usage} title={label}>
      <span className="tag-dot" aria-hidden="true" /><span className="tag-usage-label">{label}</span>
    </span>
  );
}

/** Calibration Status: Not calibrated / Failed / Overdue / Due soon / Valid — hệ thống tự tính, không ai chọn. */
export function CalibrationStatusTag({ status }: { status: CalibrationStatus }) {
  const { t } = useTranslation();
  return <span className="tag tag-status" data-status-color={CALIBRATION_STATUS_COLOR[status]} data-cal-status={status}>{t(`cal.status.${status}`)}</span>;
}

/** Ngày đến hạn hiệu chuẩn có màu: đỏ = quá hạn, vàng = sắp đến hạn (theo Calibration Status). */
export function DueDate({ date, status }: { date: string | null; status: CalibrationStatus }) {
  if (!date) return null;
  const tone = status === 'overdue' ? 'alert' : status === 'due_soon' ? 'warn' : 'neutral';
  return (
    <span className="due" data-tone={tone}>
      {formatDate(date)}
      {(status === 'overdue' || status === 'due_soon') && <CalibrationStatusTag status={status} />}
    </span>
  );
}

/** Các thẻ đang gắn trên một bản ghi (tô màu admin chọn ở Configuration › Tag). */
export function TagChips({ items }: { items: TagItem[] }) {
  if (!items.length) return null;
  return (
    <span className="tag-chips">
      {items.map((tag) => <StatusTag key={tag.id} name={tag.display_name} color={tag.color} />)}
    </span>
  );
}

/** Ô Remark trong danh sách: thẻ rồi chữ ghi chú. */
export function RemarkCell({ tags, remark }: { tags: TagItem[]; remark: string | null }) {
  if (!tags.length && !remark) return null;
  return <span className="remark-cell"><TagChips items={tags} />{remark && <span>{remark}</span>}</span>;
}
