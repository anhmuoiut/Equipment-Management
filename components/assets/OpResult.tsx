'use client';

/**
 * Mục "Kết quả" của mọi màn hình thao tác (docs/UI.md): những gì thao tác SẼ làm, lấy từ
 * `dry_run` của hàm database — tài sản nào đổi Status, vị trí mới, ghi chú ("Theo thiết bị cha X"…). Lỗi của
 * database (đang In use, cùng cha và vị trí…) hiện ngay đây, trước khi bấm nút chính.
 */
import { useTranslation } from 'react-i18next';
import { Notice, Spinner } from '@/components/ui';
import { UsageTag } from '@/components/ui/tags';
import { useFormatNote } from '@/components/ui/detail/DetailHistory';
import type { AssetOpResult } from '@/lib/types';

/** CHECK_OUT / CHECK_IN đã được nói bởi dòng Status. */
const HIDDEN_ACTIONS = new Set(['CHECK_OUT', 'CHECK_IN']);

export function OpResult({ state }: {
  state: { result: AssetOpResult | null; loading: boolean; error: string | null };
}) {
  const { t } = useTranslation();
  const formatNote = useFormatNote();
  const { result, loading, error } = state;

  const changes = (result?.changes ?? []).filter((c) => !HIDDEN_ACTIONS.has(c.action));
  const seen = new Set<string>();
  const rows = changes.filter((c) => {
    const key = `${c.asset_id}:${c.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!result && !loading && !error) return null;

  return (
    <section className="op-result" aria-live="polite" aria-busy={loading || undefined}>
      <h3 className="dp-section-title">{t('asset.result')}</h3>
      {loading && <Spinner size="sm" label={t('asset.resultLoading')} />}
      {error && <Notice tone="alert">{error}</Notice>}
      {result && (
        <>
          {result.usage_changes.length === 0 && rows.length === 0 && <p className="dp-hint">{t('asset.nothingChanges')}</p>}
          {result.usage_changes.length > 0 && (
            <ul className="op-list" aria-label={t('asset.usageChanges')}>
              {result.usage_changes.map((u) => (
                <li key={`${u.asset_type}:${u.asset_id}`}>
                  <strong>{u.label}</strong><UsageTag usage={u.from} /><span aria-hidden="true">→</span><UsageTag usage={u.to} />
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <ul className="op-list" aria-label={t('asset.changes')}>
              {rows.map((c) => (
                <li key={`${c.asset_id}:${c.action}:${c.reason ?? ''}`}>
                  <strong>{c.label}</strong>
                  <span>{t(`hist.action.${c.action}`, { defaultValue: c.action })}</span>
                  {c.from_location && c.to_location && c.from_location !== c.to_location && (
                    <span className="op-loc">{c.from_location} → {c.to_location}</span>
                  )}
                  {c.reason && <span className="op-note">{formatNote(c.reason)}</span>}
                </li>
              ))}
            </ul>
          )}
          {result.count > 1 && <p className="dp-hint">{t('asset.affected', { count: result.count })}</p>}
        </>
      )}
    </section>
  );
}
