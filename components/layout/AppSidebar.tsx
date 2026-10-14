'use client';

/**
 * Menu chính (docs/APP_SHELL.md mục 1–2): bảy mục, một cấp duy nhất.
 * Nền Prussian, mục đang chọn Picton, thu gọn hiện tên dưới icon, ngăn kéo trên
 * điện thoại. Configuration và User Management chỉ Admin
 * thấy, ngăn với năm mục trên bằng một đường kẻ. Không có số đếm cạnh menu,
 * không có dòng trạng thái; footer ghi tên người phát triển khi mở rộng.
 */
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsRight, Gauge, LayoutDashboard, LayoutList, CircuitBoard, Network, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import type { Role } from '@/lib/permissions';

type MenuItem = { href: string; labelKey: string; icon: LucideIcon; adminOnly?: boolean };

export const MAIN_MENU: readonly MenuItem[] = [
  { href: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/overview', labelKey: 'nav.overview', icon: Network },
  { href: '/equipment', labelKey: 'nav.equipment', icon: LayoutList },
  { href: '/calibration', labelKey: 'nav.calibration', icon: Gauge },
  { href: '/golden', labelKey: 'nav.golden', icon: CircuitBoard },
  { href: '/configuration', labelKey: 'nav.configuration', icon: SlidersHorizontal, adminOnly: true },
  { href: '/users', labelKey: 'nav.users', icon: Users, adminOnly: true },
];

/** Mục đang chọn — trang con (ví dụ /equipment/{id}) vẫn tô mục cha. */
export function isCurrent(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ role, expanded, onToggleCollapse, onNavigate }: {
  role: Role;
  /** Full sidebar content; the phone drawer always uses the expanded layout. */
  expanded: boolean;
  onToggleCollapse: () => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const collapseLabel = t(expanded ? 'nav.collapseMenu' : 'nav.expandMenu');
  const workspace = MAIN_MENU.filter((m) => !m.adminOnly);
  const admin = role === 'admin' ? MAIN_MENU.filter((m) => m.adminOnly) : [];

  const link = (item: MenuItem, index: number) => {
    const label = t(item.labelKey);
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} className="sidebar-link" aria-current={isCurrent(item.href, pathname) ? 'page' : undefined}
        style={{ '--sidebar-item-index': index } as CSSProperties}
        aria-label={label} title={label} onClick={onNavigate}>
        <span className="sidebar-link-icon"><Icon size={18} aria-hidden="true" /></span>
        <span className="sidebar-link-label" aria-hidden="true">{label}</span>
        <span className="sidebar-link-compact-label" aria-hidden="true">{label}</span>
      </Link>
    );
  };

  return (
    <aside className="app-sidebar" aria-label={t('nav.sidebarMenu')}>
      <div className="sidebar-brand-slot" aria-hidden={!expanded}>
        <div className="sidebar-reveal">
          <div className="sidebar-brand">
            <Image src="/Icon/solaredge-logo.svg" alt="SolarEdge" width={172} height={35} unoptimized />
          </div>
        </div>
      </div>
      <nav aria-label={t('nav.mainNavigation')}>
        {workspace.map(link)}
        {admin.length > 0 && <div className="sidebar-divider" aria-hidden="true" />}
        {admin.map((item, index) => link(item, workspace.length + index))}
      </nav>
      <footer className="sidebar-footer">
        <div className="sidebar-credit-slot" aria-hidden={!expanded}>
          <div className="sidebar-reveal"><p className="sidebar-credit">{t('nav.developerCredit')}</p></div>
        </div>
        <button type="button" className="sidebar-toggle sidebar-collapse-toggle"
          onClick={onToggleCollapse} aria-expanded={expanded} aria-controls="app-sidebar-panel" aria-label={collapseLabel} title={collapseLabel}>
          <ChevronsRight size={18} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}
