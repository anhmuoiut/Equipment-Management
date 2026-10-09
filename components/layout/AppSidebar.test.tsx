// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { AppSidebar } from './AppSidebar';
import type { Role } from '@/lib/permissions';

function renderSidebar(role: Role) {
  return render(<AppSidebar role={role} pinned={false} onToggleCollapse={() => {}} onNavigate={() => {}} />);
}
const links = () => within(screen.getByRole('navigation', { name: 'nav.mainNavigation' })).getAllByRole('link');

beforeEach(() => { nav.pathname = '/'; });

describe('AppSidebar — docs/APP_SHELL.md', () => {
  it('gives an admin all seven items, one level, in menu order (Overview right after Dashboard)', () => {
    renderSidebar('admin');
    expect(links().map((a) => a.getAttribute('href'))).toEqual(['/', '/overview', '/equipment', '/calibration', '/golden', '/configuration', '/users']);
    expect(document.querySelector('.sidebar-divider')).not.toBeNull();
  });

  it.each<Role>(['user', 'readonly'])('gives %s only the first five items and no divider', (role) => {
    renderSidebar(role);
    expect(links().map((a) => a.getAttribute('href'))).toEqual(['/', '/overview', '/equipment', '/calibration', '/golden']);
    expect(document.querySelector('.sidebar-divider')).toBeNull();
  });

  it('has no decorative caption above the items and no static status line below', () => {
    renderSidebar('admin');
    expect(document.querySelector('.sidebar-caption, .sidebar-note, .sidebar-status')).toBeNull();
  });

  it('shows no count badges and no second level', () => {
    renderSidebar('admin');
    expect(document.querySelector('.sidebar-link-badge, .sidebar-group')).toBeNull();
  });

  it('keeps the parent item current on a detail route', () => {
    nav.pathname = '/equipment/6b0c7a3e-0000-4000-8000-000000000000';
    renderSidebar('user');
    expect(screen.getByRole('link', { name: 'nav.equipment' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'nav.dashboard' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks Configuration current on every configuration list', () => {
    nav.pathname = '/configuration/calibration-vendors';
    renderSidebar('admin');
    expect(screen.getByRole('link', { name: 'nav.configuration' }).getAttribute('aria-current')).toBe('page');
  });
});
