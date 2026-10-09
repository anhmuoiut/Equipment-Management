// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { Modal, ModalFooter, ModalSuspend, useInModal } from './index';

describe('Modal', () => {
  it('size is a prop (S by default) and is shown on the dialog; a sheet is only for phones', () => {
    const { rerender } = render(<Modal title="A" onClose={() => {}}>body</Modal>);
    expect(screen.getByRole('dialog').classList.contains('modal-dialog--s')).toBe(true);
    rerender(<Modal title="A" size="l" onClose={() => {}}>body</Modal>);
    expect(screen.getByRole('dialog').classList.contains('modal-dialog--l')).toBe(true);
    rerender(<Modal sheet title="Filters" onClose={() => {}}>body</Modal>);
    expect(document.querySelector('.modal-overlay--sheet')).toBeTruthy();
    expect(screen.getByRole('dialog').classList.contains('modal-dialog--sheet')).toBe(true);
  });

  it('is drawn on document.body, outside the page content, and locks the page while open', () => {
    document.body.innerHTML = '<div class="app-shell"><div id="host"></div></div>';
    const host = document.getElementById('host')!;
    const { unmount } = render(<Modal title="A" onClose={() => {}}>body</Modal>, { container: host });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector(':scope > .modal-overlay')).toBeTruthy();
    expect(document.querySelector('.app-shell')!.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.querySelector('.app-shell')!.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('a click on the backdrop closes the dialog; a press that started inside it (text selection) does not', () => {
    const onClose = vi.fn();
    render(<Modal title="Account" onClose={onClose}><input aria-label="field" /></Modal>);
    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    // Select text in the field, release over the backdrop: the browser sends a click to the backdrop.
    fireEvent.mouseDown(screen.getByLabelText('field'));
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
    // A real click on the backdrop.
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('while busy nothing closes it: not ✕, not Escape, not the backdrop', () => {
    const onClose = vi.fn();
    render(<Modal title="Saving" busy onClose={onClose}>body</Modal>);
    expect((screen.getByRole('button', { name: 'common.close' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes only the newest dialog (a picker sheet over another dialog)', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(<><Modal title="Outer" onClose={outer}>a</Modal><Modal sheet title="Inner" onClose={inner}>b</Modal></>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('once the newest dialog is gone, Escape reaches the one underneath', () => {
    const outer = vi.fn();
    const { rerender } = render(<><Modal title="Outer" onClose={outer}>a</Modal><Modal title="Inner" onClose={() => {}}>b</Modal></>);
    rerender(<Modal title="Outer" onClose={outer}>a</Modal>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('a custom header replaces the title; tabs sit between the header and the body', () => {
    render(<Modal title="aria title" header={<h2>Custom</h2>} tabs={<div role="tablist">tabs</div>} onClose={() => {}}>body</Modal>);
    const dialog = screen.getByRole('dialog', { name: 'aria title' });
    expect(within(dialog).getByRole('heading', { name: 'Custom' })).toBeTruthy();
    const order = Array.from(dialog.children).map((el) => el.className.split(' ')[0] || el.getAttribute('role'));
    expect(order).toEqual(['modal-header', 'tablist', 'modal-body', 'modal-footer']);
  });
});

describe('ModalFooter', () => {
  function Screen({ label }: { label: string }) {
    return <ModalFooter><button type="button">{label}</button></ModalFooter>;
  }

  it('puts a screen\'s buttons into the footer of the modal that contains it', () => {
    render(<Modal title="A" onClose={() => {}}><Screen label="Save" /></Modal>);
    const footer = document.querySelector('.modal-footer') as HTMLElement;
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(document.querySelector('.modal-body') as HTMLElement).queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('a screen that is covered (ModalSuspend) shows no footer buttons; they come back when it is uncovered', () => {
    const { rerender } = render(<Modal title="A" onClose={() => {}}><ModalSuspend suspended><Screen label="Save" /></ModalSuspend></Modal>);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    rerender(<Modal title="A" onClose={() => {}}><ModalSuspend suspended={false}><Screen label="Save" /></ModalSuspend></Modal>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('a footer prop is used as is (no slot), and useInModal says whether a component is inside a modal', () => {
    function Probe() { return <span data-testid="probe">{String(useInModal())}</span>; }
    const { rerender } = render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
    rerender(<Modal title="A" footer={<button type="button">Done</button>} onClose={() => {}}><Probe /></Modal>);
    expect(screen.getByTestId('probe').textContent).toBe('true');
    expect(within(document.querySelector('.modal-footer') as HTMLElement).getByRole('button', { name: 'Done' })).toBeTruthy();
  });
});
