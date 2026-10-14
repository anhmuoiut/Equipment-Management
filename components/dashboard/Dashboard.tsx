'use client';

/**
 * Dashboard (docs/DATABASE.md): số liệu tổng, Status (In use / Not in use) của Equipment, Sub-equipment và
 * Golden board, Calibration Status (tự tính), sub-equipment quá hạn / sắp đến hạn hiệu chuẩn, phân bố theo thẻ / vị trí /
 * loại, và "Thay đổi gần đây" (view recent_actions: một thao tác của người dùng = một dòng) có bộ lọc.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CalendarDays, Cpu, Gauge, CircuitBoard, Search, TriangleAlert } from 'lucide-react';
import { useFetch } from '@/lib/client/useFetch';
import { usePhone } from '@/lib/client/usePhone';
import { useCan } from '@/components/ViewerContext';
import { Button, ErrorState, Notice, Skeleton, Spinner } from '@/components/ui';
import { PageHeading } from '@/components/layout/PageHeading';
import { DueDate } from '@/components/ui/tags';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { RecentActionsTable } from './RecentActions';
import type { CalibrationStatus, CountItem, DashboardData, HistoryModule, RecentAction, StatusCountItem } from '@/lib/types';

/** Các khối Status: ba loại tài sản (In use / Not in use) và Calibration Status. */
type StatusBlock = 'equipment' | 'sub_equipment' | 'golden_board' | 'calibration';
const STATUS_BLOCKS: { block: StatusBlock; href: string }[] = [
  { block: 'equipment', href: '/equipment' },
  { block: 'sub_equipment', href: '/calibration' },
  { block: 'golden_board', href: '/golden' },
  { block: 'calibration', href: '/calibration' },
];

export function Dashboard() {
  const { t } = useTranslation();
  const denied = useSearchParams().get('denied') === '1';
  const { data, error, reload } = useFetch<DashboardData>('/api/dashboard');
  const assetTotal = data ? data.equipment_total + data.sub_equipment_total + data.golden_total : undefined;
  // Mọi con số Quá hạn / Sắp đến hạn (KPI, tiêu đề danh sách, chú thích Status) đọc từ MỘT nơi: by_calibration_status.
  const calCount = (status: CalibrationStatus) => (data ? data.by_calibration_status.find((i) => i.id === status)?.count ?? 0 : undefined);

  return (
    <div className="dash">
      <PageHeading title={t('nav.dashboard')} />
      {denied && <Notice tone="warn">{t('dash.denied')}</Notice>}
      {error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          <div className="dash-kpis">
            <Kpi icon={<Cpu size={16} />} label={t('dash.equipment')} scope={t('dash.scope.kpiEquipment')} value={data?.equipment_total} href="/equipment" />
            <Kpi icon={<Gauge size={16} />} label={t('dash.subEquipment')} scope={t('dash.scope.kpiSub')} value={data?.sub_equipment_total} href="/calibration" />
            <Kpi icon={<TriangleAlert size={16} />} label={t('cal.status.overdue')} scope={t('dash.scope.kpiOverdue')} value={calCount('overdue')} tone="alert" href="/calibration" />
            <Kpi icon={<CalendarClock size={16} />} label={t('cal.status.due_soon')} scope={t('dash.scope.kpiDueSoon')} value={calCount('due_soon')} tone="warn" href="/calibration" />
            <Kpi icon={<CircuitBoard size={16} />} label={t('dash.golden')} scope={t('dash.scope.kpiGolden')} value={data?.golden_total} href="/golden" />
          </div>

          <StatusOverview data={data ?? undefined} />

          <div className="dash-grid">
            <DueList title={t('dash.overdueTitle')} scope={t('dash.scope.overdue')} rows={data?.overdue} count={calCount('overdue')} empty={t('dash.noneOverdue')} />
            <DueList title={t('dash.dueSoonTitle')} scope={t('dash.scope.dueSoon')} rows={data?.due_soon} count={calCount('due_soon')} empty={t('dash.noneDueSoon')} />
          </div>

          {/* Location / Type / Tag: cùng phạm vi (mọi tài sản), mỗi tài sản đếm một lần — tổng các dòng = tổng tài sản. */}
          <div className="dash-grid">
            <Bars title={t('dash.byLocation')} scope={t('dash.scope.location', { total: assetTotal ?? '…' })} items={data?.by_location} total={assetTotal} />
            <Bars title={t('dash.byType')} scope={t('dash.scope.type', { total: assetTotal ?? '…' })} items={data?.by_type} total={assetTotal} noneLabel={t('dash.noType')} />
          </div>
          <div className="dash-grid">
            <Bars title={t('dash.byTag')} scope={t('dash.scope.tag', { total: assetTotal ?? '…' })} items={data?.by_tag} total={assetTotal} noneLabel={t('dash.untagged')} />
          </div>

          <RecentActivities initial={data?.activities} />
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, scope, value, tone, href }: {
  icon: React.ReactNode; label: string; scope: string; value: number | undefined; tone?: 'alert' | 'warn'; href: string;
}) {
  return (
    <Link href={href} className="kpi" data-tone={value ? tone : undefined}>
      <span className="kpi-icon" aria-hidden="true">{icon}</span>
      <span className="kpi-value">{value === undefined ? <Skeleton className="h-7" style={{ width: 48 }} /> : value}</span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-scope">{scope}</span>
    </Link>
  );
}

function DueList({ title, scope, rows, count, empty }: {
  title: string; scope: string; rows: DashboardData['overdue'] | undefined; count: number | undefined; empty: string;
}) {
  const { t } = useTranslation();
  // A phone shows the five most urgent, then "View all" — a long list would make the page scroll forever.
  const shown = usePhone() ? 5 : 15;
  return (
    <section className="dash-card">
      <h2>{title}{rows && <span className="dash-card-count">{count ?? rows.length}</span>}</h2>
      <p className="dash-card-scope">{scope}</p>
      {!rows ? <Spinner label={t('common.loadingEllipsis')} size="sm" /> : rows.length === 0 ? <p className="dash-empty">{empty}</p> : (
        <ul className="dash-due">
          {rows.slice(0, shown).map((r) => (
            <li key={r.id}>
              <Link href={`/calibration?id=${r.id}`}>
                <strong>{r.serial_number}</strong>
                <span className="dash-due-meta">{[r.part_number, r.tester_serial, r.location].filter(Boolean).join(' · ')}</span>
                <DueDate date={r.due_date} status={r.status} />
              </Link>
            </li>
          ))}
          {rows.length > shown && <li className="dash-more"><Link href="/calibration">{t('dash.viewAll', { count: rows.length })}</Link></li>}
        </ul>
      )}
    </section>
  );
}

/** Mỗi khối Status: thanh xếp chồng tô màu + chú thích có số (đọc được không cần màu). */
function StatusOverview({ data }: { data: DashboardData | undefined }) {
  const { t } = useTranslation();
  const itemsOf = (block: StatusBlock): StatusCountItem[] | undefined => !data ? undefined
    : block === 'calibration' ? data.by_calibration_status : data.by_usage[block];
  return (
    <section className="dash-card">
      <h2>{t('dash.byStatus')}</h2>
      <p className="dash-card-scope">{t('dash.scope.status')}</p>
      {!data ? <Spinner label={t('common.loadingEllipsis')} size="sm" /> : (
        <div className="dash-status">
          {STATUS_BLOCKS.map(({ block, href }) => <StatusBreakdown key={block} block={block} href={href} items={itemsOf(block)!} />)}
        </div>
      )}
    </section>
  );
}

function StatusBreakdown({ block, href, items }: { block: StatusBlock; href: string; items: StatusCountItem[] }) {
  const { t } = useTranslation();
  const moduleName = t(`dash.moduleName.${block}`);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  // Status do hệ thống quản: server gửi khóa (id), màn hình dịch ra chữ.
  const label = (item: StatusCountItem) => (block === 'calibration' ? t(`cal.status.${item.id}`) : t(`values.${item.id}`));
  const percent = (count: number) => (total ? Math.round((count / total) * 100) : 0);
  return (
    <div className="dash-status-module">
      <div className="dash-status-head">
        <Link className="link" href={href}>{moduleName}</Link>
        <span className="dash-status-total">{total}</span>
      </div>
      {total === 0 ? <p className="dash-empty">{t('dash.noData')}</p> : (
        <>
          <div className="dash-stack" role="img"
            aria-label={t('dash.statusOf', { module: moduleName, summary: items.map((i) => `${label(i)} ${i.count}`).join(', ') })}>
            {items.map((item) => (
              <span key={item.id ?? 'none'} className="dash-stack-seg" data-status-color={item.color ?? undefined}
                style={{ flexGrow: item.count }} title={`${label(item)}: ${item.count} (${percent(item.count)}%)`} />
            ))}
          </div>
          <ul className="dash-legend">
            {items.map((item) => (
              <li key={item.id ?? 'none'}>
                <span className="status-dot" data-status-color={item.color ?? undefined} aria-hidden="true" />
                <span className="dash-legend-label">{label(item)}</span>
                <span className="dash-legend-count">{item.count}</span>
                <span className="dash-legend-pct">{percent(item.count)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** `noneLabel`: tên của dòng không có giá trị (id = null) — "No type" / "Untagged"; mặc định "(not set)". */
function Bars({ title, scope, items, total, noneLabel }: {
  title: string; scope: string; items: CountItem[] | undefined; total: number | undefined; noneLabel?: string;
}) {
  const { t } = useTranslation();
  // Tối đa 8 dòng; phần còn lại gộp thành "Others" để các dòng hiện ra luôn cộng đúng bằng tổng.
  const shownItems = items && items.length > 8
    ? [...items.slice(0, 8), { id: '__others', label: t('dash.others'), count: items.slice(8).reduce((sum, item) => sum + item.count, 0) }]
    : items;
  return (
    <section className="dash-card">
      <h2>{title}</h2>
      <p className="dash-card-scope">{scope}</p>
      {!shownItems ? <Spinner label={t('common.loadingEllipsis')} size="sm" /> : shownItems.length === 0 ? <p className="dash-empty">{t('dash.noData')}</p> : (
        <ul className="dash-bars">
          {shownItems.map((item) => (
            <li key={item.id ?? 'none'}>
              <span className="dash-bar-label">{item.label ?? noneLabel ?? t('dash.unset')}</span>
              <span className="dash-bar-track"><span className="dash-bar-fill" style={{ width: `${total ? (item.count / total) * 100 : 0}%` }} /></span>
              <span className="dash-bar-count">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** `initial`: trang đầu (không lọc, 50 thao tác) đi kèm `/api/dashboard` — dùng cho lần hiện đầu tiên, khỏi gọi thêm một request. */
function RecentActivities({ initial }: { initial: RecentAction[] | undefined }) {
  const { t } = useTranslation();
  const can = useCan();
  const [module, setModule] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Phones: the date range sits behind a "Dates" button (it is rarely needed and takes two rows).
  const phone = usePhone();
  const [datesOpen, setDatesOpen] = useState(false);
  const [limit, setLimit] = useState(50);
  // Gõ xong mới tìm (không gọi server mỗi phím).
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const params = new URLSearchParams({ limit: String(limit) });
  if (module) params.set('module', module);
  if (query) params.set('q', query);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  // Bộ lọc mặc định và chưa từng đổi → dùng `initial`. Đổi bộ lọc / Tải thêm (kể cả sau đó quay về mặc định) thì gọi server như cũ.
  const atDefault = !module && !query && !from && !to && limit === 50;
  const [leftDefault, setLeftDefault] = useState(false);
  useEffect(() => { if (!atDefault) setLeftDefault(true); }, [atDefault]);
  const useInitial = atDefault && !leftDefault;
  // Đổi bộ lọc / Tải thêm: giữ danh sách cũ (mờ đi) tới khi danh sách mới về; phản hồi cũ bị bỏ qua.
  const fetched = useFetch<RecentAction[]>(useInitial ? null : `/api/dashboard/activities?${params}`);
  const rows = useInitial ? initial : fetched.data;
  const loading = !useInitial && fetched.loading;
  const error = useInitial ? null : fetched.error;
  const reload = fetched.reload;

  const modules: HistoryModule[] = can.admin
    ? ['equipment', 'sub_equipment', 'golden_board', 'configuration', 'user']
    : ['equipment', 'sub_equipment', 'golden_board'];

  return (
    <section className="dash-card dash-activity">
      <div className="dash-activity-head">
        <h2>{t('dash.recent')}</h2>
        <div className="dash-activity-filters">
          <label className="dash-activity-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('dash.searchPlaceholder')} aria-label={t('common.search')} />
          </label>
          <SearchableSelect value={module} onChange={setModule} ariaLabel={t('dash.module')} className="dash-module-select"
            options={[
              { value: '', label: t('dash.allModules') },
              ...modules.map((m) => ({ value: m, label: t(`dash.moduleName.${m}`) })),
            ]} />
          {phone && (
            <Button size="sm" aria-expanded={datesOpen} data-active={!!(from || to)} onClick={() => setDatesOpen((o) => !o)}>
              <CalendarDays size={14} aria-hidden="true" />{t('dash.dates')}
            </Button>
          )}
          {(!phone || datesOpen) && (
            <div className="dash-activity-dates">
              <label className="dash-activity-date"><span>{t('dash.from')}</span>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="dash-activity-date"><span>{t('dash.to')}</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          )}
        </div>
      </div>
      <p className="dash-card-scope">{t('dash.scope.recent')}</p>
      {error ? <ErrorState message={error} onRetry={reload} />
        : !rows ? <Spinner label={t('common.loadingEllipsis')} size="sm" />
          : rows.length === 0 ? <p className="dash-empty">{query || module || from || to ? t('dash.noMatch') : t('hist.empty')}</p> : (
            <RecentActionsTable actions={rows} ariaLabel={t('dash.recent')} loading={loading} />
          )}
      {rows && rows.length >= limit && limit < 500 && (
        <Button size="sm" onClick={() => setLimit((l) => Math.min(l + 100, 500))}>{t('dash.loadMore')}</Button>
      )}
    </section>
  );
}
