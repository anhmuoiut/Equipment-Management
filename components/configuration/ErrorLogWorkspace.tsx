'use client';

/** Configuration › HỆ THỐNG › Error log — chỉ xem; cùng Masterlist, bản ghi mở trong một modal chỉ đọc. */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatTime } from '@/lib/client/api';
import { Button, ErrorState, Modal, ModalFooter, Skeleton } from '@/components/ui';
import { DetailSection, DetailValue } from '@/components/ui/record/fields';
import { ModuleWorkspace, useList, type DetailCtx } from '@/components/ui/workspace/ModuleWorkspace';
import { RowCard, type Column } from '@/components/ui/masterlist/Masterlist';
import type { ErrorLogRow } from '@/lib/types';

function ErrorLogModal({ ctx }: { ctx: DetailCtx<ErrorLogRow> }) {
  const { t } = useTranslation();
  const row = ctx.record;
  const title = row?.request_id ?? '…';
  const header = (
    <div className="rm-head">
      {(ctx.nav.onPrev || ctx.nav.onNext) && (
        <div className="rm-nav">
          <button type="button" className="dp-icon-btn" onClick={ctx.nav.onPrev} disabled={!ctx.nav.onPrev} aria-label={t('dp.prev')} title={t('dp.prev')}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="dp-icon-btn" onClick={ctx.nav.onNext} disabled={!ctx.nav.onNext} aria-label={t('dp.next')} title={t('dp.next')}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="rm-titles">
        <div className="rm-line1"><h2>{row ? title : <Skeleton className="h-5" style={{ width: 160 }} />}</h2></div>
        {row && <div className="rm-sub"><div className="rm-subtitle">{formatTime(row.created_at)}</div></div>}
      </div>
    </div>
  );
  return (
    <Modal size="l" title={title} header={header} onClose={ctx.onClose}>
      {ctx.error ? <ErrorState message={ctx.error} onRetry={ctx.onRetry} /> : !row ? (
        <div className="dp-skeleton">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : (
        <DetailSection title={t('err.group')}>
          <DetailValue label={t('err.requestId')}>{row.request_id}</DetailValue>
          <DetailValue label={t('err.code')}>{row.error_code}</DetailValue>
          <DetailValue label={t('err.route')} wide>{row.route}</DetailValue>
          <DetailValue label={t('err.user')}>{row.user_name}</DetailValue>
          <DetailValue label={t('fields.created_at')}>{formatTime(row.created_at)}</DetailValue>
          <DetailValue label={t('err.message')} wide>{row.message}</DetailValue>
          <DetailValue label={t('err.stack')} wide>{row.stack && <pre className="dp-pre">{row.stack}</pre>}</DetailValue>
        </DetailSection>
      )}
      <ModalFooter><Button onClick={ctx.onClose}>{t('common.close')}</Button></ModalFooter>
    </Modal>
  );
}

export function ErrorLogWorkspace() {
  const { t } = useTranslation();
  const list = useList<ErrorLogRow>('/api/configuration/error-log');

  // useMemo / useCallback: Masterlist memo theo identity của các prop này (xem EquipmentWorkspace).
  const columns = useMemo<Column<ErrorLogRow>[]>(() => [
    { key: 'created_at', label: t('fields.created_at'), value: (r) => r.created_at, render: (r) => formatTime(r.created_at) },
    { key: 'request_id', label: t('err.requestId'), value: (r) => r.request_id },
    { key: 'error_code', label: t('err.code'), value: (r) => r.error_code, filter: true },
    { key: 'route', label: t('err.route'), value: (r) => r.route, filter: true },
    { key: 'user_name', label: t('err.user'), value: (r) => r.user_name, filter: true },
    { key: 'message', label: t('err.message'), value: (r) => r.message, wrap: true, width: 260 },
  ], [t]);

  const mobileCard = useCallback((r: ErrorLogRow) => (
    <RowCard title={r.error_code ?? '—'} tag={formatTime(r.created_at)} lines={[r.route, r.message]} />
  ), []);

  return (
    <ModuleWorkspace<ErrorLogRow>
      title={t('cfg.list.error-log')}
      list={list}
      columns={columns}
      mobileCard={mobileCard}
      storageKey="configuration-error-log"
      exportName="error-log"
      canAdd={false}
      renderDetail={(ctx) => <ErrorLogModal ctx={ctx} />}
    />
  );
}
