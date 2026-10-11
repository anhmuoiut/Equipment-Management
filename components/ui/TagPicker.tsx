'use client';

/**
 * Chọn thẻ cho phần Remark (Equipment / Calibration / Golden sample): mỗi thẻ là một nút tô màu admin chọn
 * ở Configuration › Tag, bấm để gắn / bỏ; chọn được nhiều thẻ.
 */
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TagOption } from '@/lib/types';

export function TagPicker({ id, value, onChange, tags, label }: {
  id: string; value: unknown; onChange: (ids: string[]) => void; tags: TagOption[] | undefined; label: string;
}) {
  const { t } = useTranslation();
  const selected = Array.isArray(value) ? (value as string[]) : [];
  if (!tags) return <span className="dp-hint">{t('common.loadingEllipsis')}</span>;
  if (tags.length === 0) return <span className="dp-empty">{t('tag.none')}</span>;
  const toggle = (tagId: string) => onChange(selected.includes(tagId) ? selected.filter((x) => x !== tagId) : [...selected, tagId]);
  return (
    <div id={id} className="tag-picker" role="group" aria-label={label}>
      {tags.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button key={tag.id} type="button" className="tag tag-status tag-pick" data-status-color={tag.color}
            aria-pressed={on} onClick={() => toggle(tag.id)}>
            {on && <Check size={12} aria-hidden="true" />}{tag.display_name}
          </button>
        );
      })}
    </div>
  );
}
