// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/ui', () => ({ ToastViewport: () => null }));
vi.mock('@/components/ViewerContext', () => ({ ViewerProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/layout/AppSidebar', () => ({ AppSidebar: ({ expanded, onToggleCollapse }: { expanded: boolean; onToggleCollapse: () => void }) => <button aria-expanded={expanded} onClick={onToggleCollapse}>{expanded ? 'Collapse' : 'Expand'}</button> }));
import { AppShell } from './AppShell';
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanup(); });
function setup() {
  const view = render(<AppShell userId="1" username="user" fullName="User" role="user">Content</AppShell>);
  return { ...view, shell: view.container.querySelector('.app-shell')!, panel: view.container.querySelector('.sidebar-region')! };
}
it('keeps the sidebar collapsed when the pointer or keyboard focus enters or leaves', () => {
  const { shell, panel, getByText } = setup();
  expect(shell.getAttribute('data-sidebar-open')).toBe('false');
  fireEvent.pointerEnter(panel);
  fireEvent.focus(getByText('Expand'));
  expect(shell.getAttribute('data-sidebar-open')).toBe('false');
  fireEvent.pointerLeave(panel);
  fireEvent.blur(getByText('Expand'));
  expect(shell.getAttribute('data-sidebar-open')).toBe('false');
});
it('expands and collapses only by click, and remembers both choices after remounting', () => {
  const { shell, panel, getByText, unmount } = setup();
  fireEvent.click(getByText('Expand'));
  expect(shell.getAttribute('data-sidebar-open')).toBe('true');
  fireEvent.pointerEnter(panel);
  fireEvent.pointerLeave(panel);
  expect(shell.getAttribute('data-sidebar-open')).toBe('true');
  expect(localStorage.getItem('equipment-sidebar-pinned')).toBe('true');
  unmount();
  const reopened = setup();
  expect(reopened.shell.getAttribute('data-sidebar-open')).toBe('true');
  fireEvent.click(reopened.getByText('Collapse'));
  expect(reopened.shell.getAttribute('data-sidebar-open')).toBe('false');
  expect(localStorage.getItem('equipment-sidebar-pinned')).toBe('false');
  reopened.unmount();
  expect(setup().shell.getAttribute('data-sidebar-open')).toBe('false');
});
