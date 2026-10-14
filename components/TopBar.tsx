'use client';

import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Menu } from 'lucide-react';
import { PreferenceControls } from '@/components/Preferences';
import { JabilLogo } from '@/components/JabilLogo';
import { UserMenu } from '@/components/UserMenu';

type TopBarProps = {
  username: string;
  fullName: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
};

export function TopBar({ username, fullName, sidebarOpen, onToggleSidebar, toggleRef }: TopBarProps) {
  const { t } = useTranslation();
  const toggleLabel = sidebarOpen ? t('nav.hideMenu') : t('nav.openMenu');
  return (
    <header className="app-topbar">
      <div className="app-brand">
        <div className="app-brand-row">
          <JabilLogo />
          <span className="app-brand-title" title="Equipment Management">Equipment Management</span>
          {/* Hamburger — mobile only (CSS-hidden from 768px). The sidebar's
              own collapse toggle handles the desktop case; see AppSidebar. */}
          <button ref={toggleRef} type="button" className="sidebar-toggle"
            onClick={onToggleSidebar} aria-expanded={sidebarOpen} aria-controls="app-sidebar-panel"
            aria-label={toggleLabel} title={toggleLabel}>
            {sidebarOpen ? <ChevronLeft size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {/* The current page's own name lives in its PageHeading (the <h1> in
          the page body), so the header doesn't repeat it. */}
      <div className="topbar-actions">
        {/* Phones: language and theme live in the account menu instead (UserMenu). */}
        <div className="topbar-preferences"><PreferenceControls /></div>
        <UserMenu username={username} fullName={fullName} />
      </div>
    </header>
  );
}
