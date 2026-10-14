// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  return render(<AppSidebar role={role} expanded={false} onToggleCollapse={() => {}} onNavigate={() => {}} />);
}
const links = () => within(screen.getByRole('navigation', { name: 'nav.mainNavigation' })).getAllByRole('link');

beforeEach(() => { nav.pathname = '/'; });

describe('AppSidebar — docs/UI.md', () => {
  it('offers an accessible footer control with right chevrons to expand and left chevrons to collapse', () => {
    const onToggle = vi.fn();
    const view = render(<AppSidebar role="admin" expanded={false} onToggleCollapse={onToggle} onNavigate={() => {}} />);
    const expand = screen.getByRole('button', { name: 'nav.expandMenu' });
    expect(screen.queryByRole('img', { name: 'SolarEdge' })).toBeNull();
    expect(screen.getByText('nav.developerCredit').closest('.sidebar-credit-slot')?.getAttribute('aria-hidden')).toBe('true');
    expect(expand.closest('.sidebar-footer')).toBeTruthy();
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(expand.querySelector('.lucide-chevrons-right')).toBeTruthy();
    fireEvent.click(expand);
    expect(onToggle).toHaveBeenCalledTimes(1);
    view.rerender(<AppSidebar role="admin" expanded onToggleCollapse={onToggle} onNavigate={() => {}} />);
    const collapse = screen.getByRole('button', { name: 'nav.collapseMenu' });
    expect(within(collapse.closest('.sidebar-footer') as HTMLElement).getByText('nav.developerCredit')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'SolarEdge' }).getAttribute('src')).toBe('/Icon/solaredge-logo.svg');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.querySelector('.lucide-chevrons-right')).toBeTruthy(); // The same icon rotates smoothly in CSS.
    expect(screen.getByText('nav.developerCredit').closest('.sidebar-credit-slot')?.getAttribute('aria-hidden')).toBe('false');
  });

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
