'use client';

/**
 * Thanh phân trang dưới Masterlist ở chế độ server: "1–50 / 874", cỡ trang (25 / 50 / 100), Trước / Sau và "Trang 3 / 18".
 * Không có dòng nào thì không hiện. Chỉ có một trang thì chỉ hiện số dòng (và cỡ trang khi còn thêm được).
 */
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { PAGE_SIZE_OPTIONS } from '@/lib/client/listState';

export function Pager({ page, pageSize, total, shown, busy, onPage, onPageSize }: {
  page: number;
  pageSize: number;
  total: number;
  /** Số dòng đang hiện ở trang này. */
  shown: number;
  /** Đang tải một trang khác: nút chuyển trang tạm khóa. */
  busy: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { t } = useTranslation();
  if (total === 0 || shown === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = from + shown - 1;
  return (
    <nav className="ml-pager" aria-label={t('ml.pagination')}>
      <span className="ml-pager-range" aria-live="polite">{t('ml.range', { from, to, total })}</span>
      <div className="ml-pager-end">
        {total > PAGE_SIZE_OPTIONS[0] && (
          <SearchableSelect value={String(pageSize)} onChange={(value) => onPageSize(Number(value))} ariaLabel={t('ml.perPageLabel')}
            className="ml-pager-size" options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: t('ml.perPage', { count: size }) }))} />
        )}
        {pages > 1 && (
          <>
            <Button size="sm" aria-label={t('ml.prevPage')} disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
              <ChevronLeft size={14} aria-hidden="true" />
            </Button>
            <span className="ml-pager-page">{t('ml.pageOf', { page, pages })}</span>
            <Button size="sm" aria-label={t('ml.nextPage')} disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </nav>
  );
}
