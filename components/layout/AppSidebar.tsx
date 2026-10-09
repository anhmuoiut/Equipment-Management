'use client';

/**
 * Menu chính (docs/APP_SHELL.md mục 1–2): bảy mục, một cấp duy nhất.
 * Nền Prussian, mục đang chọn Picton, thu gọn còn icon, ngăn kéo trên
 * điện thoại. Configuration và User Management chỉ Admin
 * thấy, ngăn với năm mục trên bằng một đường kẻ. Không có số đếm cạnh menu,
 * không có chữ chú thích hay dòng trạng thái ở đầu / cuối menu.
 */
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Pin, PinOff, Gauge, LayoutDashboard, LayoutList, CircuitBoard, Network, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
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

export function AppSidebar({ role, pinned, onToggleCollapse, onNavigate }: {
  role: Role;
  /** Chỉ desktop: thu gọn còn icon (điện thoại luôn là ngăn kéo đầy đủ). */
  pinned: boolean;
  onToggleCollapse: () => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const collapseLabel = pinned ? t('nav.unpinMenu') : t('nav.pinMenu');
  const workspace = MAIN_MENU.filter((m) => !m.adminOnly);
  const admin = role === 'admin' ? MAIN_MENU.filter((m) => m.adminOnly) : [];

  const link = (item: MenuItem) => {
    const label = t(item.labelKey);
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} className="sidebar-link" aria-current={isCurrent(item.href, pathname) ? 'page' : undefined}
        aria-label={label} title={label} onClick={onNavigate}>
        <span className="sidebar-link-icon"><Icon size={18} aria-hidden="true" /></span>
        <span className="sidebar-link-label">{label}</span>
      </Link>
    );
  };

  return (
    <aside className="app-sidebar" aria-label={t('nav.sidebarMenu')}>
      <button type="button" className="sidebar-toggle sidebar-collapse-toggle"
        onClick={onToggleCollapse} aria-pressed={pinned} aria-label={collapseLabel} title={collapseLabel}>
        {pinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
      </button>
      <nav aria-label={t('nav.mainNavigation')}>
        {workspace.map(link)}
        {admin.length > 0 && <div className="sidebar-divider" aria-hidden="true" />}
        {admin.map(link)}
      </nav>
    </aside>
  );
}
