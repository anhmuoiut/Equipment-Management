'use client';

/**
 * Chọn thẻ cho phần Remark (Equipment / Calibration / Golden sample): mỗi thẻ là một nút tô màu admin chọn
 * ở Configuration › Tag. Mỗi lần chỉ MỘT thẻ: bấm thẻ khác thì thay thẻ đang chọn, bấm lại thẻ đang chọn thì bỏ chọn.
 * (Giá trị vẫn là mảng `tag_ids` — tối đa một phần tử; bản ghi cũ có nhiều thẻ vẫn hiện đủ, bấm một thẻ sẽ gộp về thẻ đó.)
 */
import { useTranslation } from 'react-i18next';
import { MANUAL_TAG_COLORS, manualTagColor } from '@/lib/status';
import { StatusTag } from './tags';
import type { StatusColor, TagOption } from '@/lib/types';

/** Six pastel palettes shared by the admin editor and tag displays. */
export function ManualTagColorPicker({ id, value, onChange, label }: {
  id: string; value: unknown; onChange: (color: StatusColor) => void; label: string;
}) {
  const { t } = useTranslation();
  const selected = typeof value === 'string' ? manualTagColor(null, value as StatusColor) : null;
  return (
    <div id={id} className="dp-radios" role="radiogroup" aria-label={label}>
      {MANUAL_TAG_COLORS.map((color) => (
        <label key={color}>
          <input type="radio" name={id} value={color} checked={selected === color} onChange={() => onChange(color)} />
          <StatusTag name={t(`cfg.tagPalette.${color}`)} color={color} />
        </label>
      ))}
    </div>
  );
}

export function TagPicker({ id, value, onChange, tags, label }: {
  id: string; value: unknown; onChange: (ids: string[]) => void; tags: TagOption[] | undefined; label: string;
}) {
  const { t } = useTranslation();
  const selected = Array.isArray(value) ? (value as string[]) : [];
  if (!tags) return <span className="dp-hint">{t('common.loadingEllipsis')}</span>;
  if (tags.length === 0) return <span className="dp-empty">{t('tag.none')}</span>;
  const toggle = (tagId: string) => onChange(selected.length === 1 && selected[0] === tagId ? [] : [tagId]);
  return (
    <div id={id} className="tag-picker" role="group" aria-label={label}>
      {tags.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button key={tag.id} type="button" className="tag-pick"
            aria-pressed={on} onClick={() => toggle(tag.id)}>
            <StatusTag name={tag.display_name} color={tag.color} />
          </button>
        );
      })}
    </div>
  );
}
