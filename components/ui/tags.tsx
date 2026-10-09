'use client';

/**
 * Tag hiển thị dùng chung. Tag trạng thái tô bằng màu admin chọn ở
 * Configuration › Tag (tags.color, 5 màu hệ thống); hạn hiệu chuẩn và
 * trạng thái tài khoản có màu theo ý nghĩa — luôn kèm chữ, không chỉ màu.
 */
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/client/api';
import { CALIBRATION_STATUS_COLOR } from '@/lib/status';
import type { CalibrationStatus, StatusColor, TagItem } from '@/lib/types';

export function StatusTag({ name, color }: { name: string | null; color: StatusColor | null | undefined }) {
  if (!name) return null;
  return (
    <span className="tag tag-status" data-status-color={color ?? 'gray'}>{name}</span>
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
 * Usage của thiết bị: In use (xanh đặc, chấm sáng) / Not in use (xám, chấm rỗng) — khác Status.
 * Chấm tròn chỉ có ở tag Usage; tag Status không có chấm.
 */
export function UsageTag({ usage }: { usage: 'in_use' | 'not_in_use' }) {
  const { t } = useTranslation();
  return (
    <span className="tag tag-usage" data-usage={usage}>
      <span className="tag-dot" aria-hidden="true" />{t(`values.${usage}`)}
    </span>
  );
}

/** Calibration Status: Not calibrated / Failed / Overdue / Due soon / Valid — hệ thống tự tính, không ai chọn. */
export function CalibrationStatusTag({ status }: { status: CalibrationStatus }) {
  const { t } = useTranslation();
  return <StatusTag name={t(`cal.status.${status}`)} color={CALIBRATION_STATUS_COLOR[status]} />;
}

/** Ngày đến hạn hiệu chuẩn có màu: đỏ = quá hạn, vàng = sắp đến hạn (theo Calibration Status). */
export function DueDate({ date, status }: { date: string | null; status: CalibrationStatus }) {
  const { t } = useTranslation();
  if (!date) return null;
  const tone = status === 'overdue' ? 'alert' : status === 'due_soon' ? 'warn' : 'neutral';
  return (
    <span className="due" data-tone={tone}>
      {formatDate(date)}
      {(status === 'overdue' || status === 'due_soon') && <span className="due-label">{t(`cal.status.${status}`)}</span>}
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
