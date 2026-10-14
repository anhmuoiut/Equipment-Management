'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { TopBar } from '@/components/TopBar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ToastViewport } from '@/components/ui';
import { usePhone } from '@/lib/client/usePhone';
import { seedOptions } from '@/lib/client/options';
import { useSidebarMotion } from '@/lib/client/useSidebarMotion';
import { ViewerProvider } from '@/components/ViewerContext';
import type { Role } from '@/lib/permissions';
import type { Options } from '@/lib/types';

const STORAGE_KEY = 'equipment-sidebar-pinned';
// Trang Masterlist + Detail Panel chiếm đủ chiều cao (chỉ thân bảng / panel
// cuộn) — các quy tắc data-page='masterlist' trong workspace.css.
const FULL_HEIGHT_LIST_PAGES = ['/overview', '/equipment', '/calibration', '/golden', '/configuration/', '/users'];
const isListPage = (pathname: string) =>
  FULL_HEIGHT_LIST_PAGES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));

export function AppShell({
  userId, username, fullName, role, options, children,
}: {
  userId: string; username: string; fullName: string; role: Role;
  /** Danh sách chọn (Configuration) do layout đọc sẵn ở server — xem `seedOptions`. */
  options?: Options; children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  // Layout effect: chạy trước effect của các form con, nên `useOptions()` thấy bản này ngay và không gọi /api/options.
  useLayoutEffect(() => { if (options) seedOptions(options); }, [options]);
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const isMobile = usePhone();
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarOpen = isMobile ? mobileOpen : desktopExpanded;
  useSidebarMotion(shellRef, sidebarOpen, isMobile);

  useEffect(() => {
    try { setDesktopExpanded(localStorage.getItem(STORAGE_KEY) === 'true'); } catch {}
  }, []);

  // Phone ↔ desktop: close the phone drawer; preserve the user's desktop choice.
  useEffect(() => {
    setMobileOpen(false);
    if (panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
  }, [isMobile]);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    toggleRef.current?.focus();
  }, []);

  function toggleSidebar() {
    if (isMobile) {
      if (mobileOpen) closeMobile();
      else setMobileOpen(true);
    } else {
      const next = !desktopExpanded;
      setDesktopExpanded(next);
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
    }
  }

  // The drawer panel stays mounted at all times on mobile now (see the JSX
  // below) so the slide/fade can animate on both open AND close — a node
  // that unmounts the instant `mobileOpen` flips false has no time to run
  // its exit transition. While off-screen it must not be reachable by tab
  // or a screen reader, so it's `inert` whenever mobile-and-closed; never
  // inert on desktop, where it's a real, always-interactive rail.
  useEffect(() => {
    if (!panelRef.current) return;
    panelRef.current.inert = isMobile && !mobileOpen;
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const content = contentRef.current;
    const actions = shellRef.current?.querySelector<HTMLElement>('.topbar-actions');
    const previousOverflow = document.body.style.overflow;
    if (content) content.inert = true;
    if (actions) actions.inert = true;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobile();
      } else if (event.key === 'Tab') {
        // Keep keyboard navigation in the open menu and its header toggle.
        // Links inside a closed sidebar group are inert (not focusable), so
        // they can't be the first/last stop.
        const items = [
          toggleRef.current,
          ...Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex="0"]',
          ) ?? []),
        ].filter((item): item is HTMLElement => item !== null && !item.closest('[inert]'));
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      if (content) content.inert = false;
      if (actions) actions.inert = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, mobileOpen, closeMobile]);

  return (
    <ViewerProvider viewer={{ userId, username, fullName, role }}>
    <div ref={shellRef} className="app-shell" data-page={isListPage(pathname) ? 'masterlist' : undefined} data-sidebar-pinned={desktopExpanded} data-mobile-open={mobileOpen} data-sidebar-open={sidebarOpen}>
      {/* Visible only on keyboard focus — the
          first focusable element on every page, so Tab from the address
          bar reaches main content without tabbing through the whole header
          and sidebar first. */}
      <a href="#main-content" className="skip-link">{t('nav.skipToContent')}</a>
      <TopBar username={username} fullName={fullName} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} toggleRef={toggleRef} />
      <div className="app-body">
        {/* Mounted for the whole time the viewport is mobile-sized (not just
            while open) so its opacity fade can play on close, not just open —
            see the panel note below for why the same applies there. Visuals
            (opacity/pointer-events) are driven by .app-shell[data-mobile-open]
            in CSS, not by conditional rendering. */}
        {isMobile && <button
          type="button" className="sidebar-backdrop" tabIndex={-1}
          aria-label={t('nav.closeMenu')} onClick={closeMobile}
        />}
        {/* Desktop collapse narrows to an icon-and-name rail (styled off data-sidebar-open
            on .app-shell). On mobile this now always stays mounted and slides
            off-screen via transform (CSS) instead of unmounting via `hidden` —
            unmounting on close would skip the close transition entirely. The
            `inert` effect above keeps it out of the tab order/AT while closed. */}
        <div id="app-sidebar-panel" ref={panelRef} className="sidebar-region">

          <AppSidebar
            role={role} expanded={isMobile || desktopExpanded} onToggleCollapse={toggleSidebar}
            onNavigate={() => { if (isMobile) closeMobile(); }}
          />
        </div>
        <main id="main-content" ref={contentRef} className="app-content" tabIndex={-1}>{children}</main>
      </div>
      <ToastViewport />
    </div>
    </ViewerProvider>
  );
}
