// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(async () => ({ data: [], meta: {} })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { ApiError } from '@/lib/client/api';
import { RecordModal, type ActionDef, type RecordModalProps } from './RecordModal';
import { ActionScreen } from './ActionScreen';
import { useRecordContext } from './context';

type Rec = {
  id: string; name: string; note: string | null;
  created_at: string; created_by: string | null; created_by_name: string | null;
  updated_at: string; updated_by: string | null; updated_by_name: string | null;
};
const rec = (over: Partial<Rec> = {}): Rec => ({
  id: 'r1', name: 'SN-001', note: 'hello',
  created_at: '2026-10-01T01:00:00Z', created_by: 'u1', created_by_name: 'Admin',
  updated_at: '2026-10-01T02:00:00Z', updated_by: 'u1', updated_by_name: 'Admin', ...over,
});

function phone(on: boolean) {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: on, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
}
afterEach(() => phone(false));

function setup(over: Partial<RecordModalProps<Rec>> = {}) {
  const props: RecordModalProps<Rec> = {
    size: 'l',
    record: rec(),
    heading: (r) => ({ title: r.name, tags: <span>TAG</span>, subtitle: 'sub line', meta: <span>meta line</span> }),
    sections: [{
      key: 'main', title: 'Main', fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'note', label: 'Note', kind: 'textarea' },
      ],
    }],
    canEdit: true,
    onSave: vi.fn(async (payload, current) => ({ row: { ...(current ?? rec({ id: 'new' })), ...payload } as Rec })),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onDeleted: vi.fn(),
    reload: vi.fn(),
    ...over,
  };
  render(<RecordModal<Rec> {...props} />);
  return props;
}
const dialog = () => screen.getByRole('dialog');
const footer = () => dialog().querySelector('.modal-footer') as HTMLElement;
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const footerButtons = () => within(footer()).queryAllByRole('button').map((b) => b.textContent);

describe('RecordModal — detail view', () => {
  it('shows header (title, tag, sub line, quick facts), the field groups and the system information; the size is the prop', () => {
    setup();
    expect(dialog().classList.contains('modal-dialog--l')).toBe(true);
    const h2 = within(dialog()).getByRole('heading', { level: 2 });
    expect(h2.textContent).toBe('SN-001');
    expect(within(dialog()).getByText('TAG')).toBeTruthy();
    expect(within(dialog()).getByText('sub line')).toBeTruthy();
    expect(within(dialog()).getByText('meta line')).toBeTruthy();
    expect(within(dialog()).getByText('Main')).toBeTruthy();
    expect(within(dialog()).getByText('hello')).toBeTruthy();
    expect(within(dialog()).getByText('dp.systemInfo')).toBeTruthy();
  });

  it('footer: [Thao tác ▾] on the left, [Sửa] then the module buttons on the right, the last one is the primary', async () => {
    const actions: ActionDef<Rec>[] = [
      { key: 'extra', label: 'Extra', screen: () => null },
      { key: 'record', label: 'Record', primary: true, screen: () => null },
      { key: 'usage', label: 'Check-out', primary: true, screen: () => null },
    ];
    setup({ actions });
    expect(footerButtons()).toEqual(['dp.actionsMenu', 'common.edit', 'Record', 'Check-out']);
    const rightmost = within(footer()).getByRole('button', { name: 'Check-out' });
    expect(rightmost.className).toContain('ui-button--primary');
    expect(within(footer()).getByRole('button', { name: 'common.edit' }).className).toContain('ui-button--quiet');
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    // Menu: chỉ thao tác không phải nút chính.
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Extra']);
  });

  it('on a phone only the primary button stays in the footer; [Sửa] and the other buttons move into the menu', async () => {
    phone(true);
    setup({ actions: [{ key: 'record', label: 'Record', primary: true, screen: () => null }, { key: 'usage', label: 'Check-out', primary: true, screen: () => null }] });
    expect(footerButtons()).toEqual(['dp.actionsMenu', 'Check-out']);
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['common.edit', 'Record']);
  });

  it('read-only viewers get only [Đóng]', async () => {
    const props = setup({ canEdit: false, actions: [{ key: 'a', label: 'Act', screen: () => null }] });
    expect(footerButtons()).toEqual(['common.close']);
    await click(within(footer()).getByRole('button', { name: 'common.close' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('a record that is still loading shows a skeleton; a failed load shows the error with Retry and Close', async () => {
    const onRetry = vi.fn();
    const { unmount } = render(<RecordModal<Rec> {...{ size: 'l', record: null, loading: true, heading: () => ({ title: 'x' }), sections: [], canEdit: true,
      onSave: vi.fn(), onClose: vi.fn(), onSaved: vi.fn() } as RecordModalProps<Rec>} />);
    expect(document.querySelector('.dp-skeleton')).toBeTruthy();
    unmount();
    render(<RecordModal<Rec> {...{ size: 'l', record: null, error: 'It failed', onRetry, heading: () => ({ title: 'x' }), sections: [], canEdit: true,
      onSave: vi.fn(), onClose: vi.fn(), onSaved: vi.fn() } as RecordModalProps<Rec>} />);
    expect(screen.getByText('It failed')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'common.retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(within(footer()).getByRole('button', { name: 'common.close' })).toBeTruthy();
  });

  it('a background reload (loading on, record still there) keeps the detail on screen', () => {
    setup({ loading: true });
    expect(within(dialog()).getByText('hello')).toBeTruthy();
    expect(document.querySelector('.dp-skeleton')).toBeNull();
  });

  it('tabs: Information, module tabs, History; the tab row appears only with more than one', async () => {
    setup({ extraTabs: [{ key: 'tree', label: 'Tree', render: () => <p>tree content</p> }], historyUrl: (r) => `/api/x/${r.id}/history` });
    const tabs = within(dialog()).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['dp.tabInfo', 'Tree', 'dp.tabHistory']);
    await click(within(dialog()).getByRole('tab', { name: 'Tree' }));
    expect(within(dialog()).getByText('tree content')).toBeTruthy();
  });

  it('initialTab opens that module tab; an unknown one falls back to Information; another record starts on the tab again', async () => {
    const extraTabs = [{ key: 'tree', label: 'Tree', render: () => <p>tree content</p> }];
    const view = (record: Rec, initialTab?: string) => (
      <RecordModal<Rec> size="l" record={record} heading={(r) => ({ title: r.name })} sections={[]} canEdit={false} extraTabs={extraTabs} initialTab={initialTab}
        onSave={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    const { rerender } = render(view(rec(), 'tree'));
    expect(within(dialog()).getByRole('tab', { name: 'Tree' }).getAttribute('aria-selected')).toBe('true');
    expect(within(dialog()).getByText('tree content')).toBeTruthy();
    await click(within(dialog()).getByRole('tab', { name: 'dp.tabInfo' }));
    expect(within(dialog()).queryByText('tree content')).toBeNull();
    rerender(view(rec({ id: 'r2', name: 'SN-002' }), 'tree'));
    expect(within(dialog()).getByRole('tab', { name: 'Tree' }).getAttribute('aria-selected')).toBe('true');
    rerender(view(rec({ id: 'r3', name: 'SN-003' }), undefined));
    expect(within(dialog()).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true');
    rerender(view(rec({ id: 'r4', name: 'SN-004' }), 'nope'));
    expect(within(dialog()).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('RecordModal — browsing', () => {
  it('‹ › and the ← → keys call the neighbours; the keys do nothing inside an input or with a modifier', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    setup({ nav: { onPrev, onNext } });
    await click(within(dialog()).getByRole('button', { name: 'dp.prev' }));
    await click(within(dialog()).getByRole('button', { name: 'dp.next' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(onPrev).toHaveBeenCalledTimes(2);
    expect(onNext).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true }); });
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it('at the ends the missing arrow is disabled; with no neighbours at all there are no arrows', () => {
    setup({ nav: { onNext: vi.fn() } });
    expect((within(dialog()).getByRole('button', { name: 'dp.prev' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the arrows are not in the edit view, and ← → do not browse there', async () => {
    const onNext = vi.fn();
    setup({ nav: { onNext } });
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    expect(within(dialog()).queryByRole('button', { name: 'dp.next' })).toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(onNext).not.toHaveBeenCalled();
  });

  it('opening a related record shows a breadcrumb ← SN-001 › SN-002; the arrows give way to it', async () => {
    const back = vi.fn();
    setup({ record: rec({ id: 'r2', name: 'SN-002' }), trail: [{ label: 'SN-001', onClick: back }], nav: { onNext: vi.fn() } });
    expect(within(dialog()).getByRole('button', { name: 'SN-001' })).toBeTruthy();
    expect(within(dialog()).queryByRole('button', { name: 'dp.next' })).toBeNull();
    await click(within(dialog()).getByRole('button', { name: 'dp.back' }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('RecordModal — edit and create', () => {
  const edit = async () => click(within(footer()).getByRole('button', { name: 'common.edit' }));
  const type = async (label: string | RegExp, value: string) => { await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }); };

  it('Edit shows breadcrumb ← SN-001 › Sửa; Save sends only what changed, returns to the detail and reports the saved row', async () => {
    const props = setup();
    await edit();
    expect(within(dialog()).getByRole('button', { name: 'SN-001' })).toBeTruthy();
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('common.edit');
    // Chưa đổi gì: nút Lưu khóa.
    expect((within(footer()).getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
    await type('Note', 'changed');
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(props.onSave).toHaveBeenCalledWith({ note: 'changed' }, expect.objectContaining({ id: 'r1' }));
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ note: 'changed' }), false);
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('SN-001');
  });

  it('required fields show * and an error under the field; nothing is sent until they are filled', async () => {
    const props = setup();
    await edit();
    await type(/^Name/, '');
    await type('Note', 'x');
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText(/^Name/).closest('.dp-field') as HTMLElement).getByRole('alert').textContent).toBe('dp.required');
  });

  it('a server error is shown on the form (and under the field it names) without leaving it', async () => {
    const onSave = vi.fn(async () => { throw new ApiError('VALIDATION_ERROR', 'bad', { fields: { note: 'too_long' } }, 'req', 400); });
    setup({ onSave });
    await edit();
    await type('Note', 'x');
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(within(dialog()).getAllByRole('alert').length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText('Note').closest('.dp-field') as HTMLElement).getByText('dp.fieldError.too_long')).toBeTruthy();
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('common.edit');
  });

  it('Create is always an M modal titled by createTitle; Save reports the created row', async () => {
    const props = setup({ record: null, creating: true, createTitle: 'Add thing', defaults: { note: 'pre' } });
    expect(dialog().classList.contains('modal-dialog--m')).toBe(true);
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('Add thing');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('pre');
    await type(/^Name/, 'SN-NEW');
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(props.onSave).toHaveBeenCalledWith({ name: 'SN-NEW', note: 'pre' }, null);
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'SN-NEW' }), true);
  });

  it('beforeSave: a warning is shown first and the button becomes "Save anyway"; pressing it again saves; changing a field asks again', async () => {
    const beforeSave = vi.fn(async () => <span>serial exists</span>);
    const props = setup({ beforeSave });
    await edit();
    await type('Note', 'x');
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(within(dialog()).getByText('serial exists')).toBeTruthy();
    await type('Note', 'xy');
    expect(within(dialog()).queryByText('serial exists')).toBeNull();
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    await click(within(footer()).getByRole('button', { name: 'dp.saveAnyway' }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(beforeSave).toHaveBeenCalledTimes(2);
  });

  it('savedScreen: after a successful Add the list is updated at once but the modal stays on the extra screen until Done', async () => {
    const onSave = vi.fn(async () => ({ row: rec({ id: 'new', name: 'SN-NEW' }), extra: 'secret' }));
    const props = setup({
      record: null, creating: true, createTitle: 'Add thing', onSave,
      savedScreen: ({ extra, done }) => <div><span>{String(extra)}</span><button type="button" onClick={done}>Done</button></div>,
    });
    await type(/^Name/, 'SN-NEW');
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(screen.getByText('secret')).toBeTruthy();
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }), true, false);
    await click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'new' }), true);
  });
});

describe('RecordModal — leaving with unsaved changes', () => {
  const edit = async () => click(within(footer()).getByRole('button', { name: 'common.edit' }));
  const type = async (value: string) => { await act(async () => { fireEvent.change(screen.getByLabelText('Note'), { target: { value } }); }); };

  it('with no changes Esc closes the modal at once', async () => {
    const props = setup();
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('✕, Esc and the backdrop ask "Hủy bỏ thay đổi?" inside the same modal; Esc there means Stay', async () => {
    const props = setup();
    await edit();
    await type('x');
    await click(within(dialog()).getByRole('button', { name: 'common.close' }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText('dp.discardTitle')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.queryByText('dp.discardTitle')).toBeNull();
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('x');
    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    await act(async () => { fireEvent.mouseDown(overlay); fireEvent.click(overlay); });
    expect(screen.getByText('dp.discardTitle')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'dp.discard' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('the footer buttons of the covered form are hidden while the question shows, and come back with Stay', async () => {
    setup();
    await edit();
    await type('x');
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(footerButtons()).toEqual(['dp.stay', 'dp.discard']);
    await click(within(footer()).getByRole('button', { name: 'dp.stay' }));
    expect(footerButtons()).toContain('common.save');
  });

  it('the breadcrumb ← asks the same question and then goes back to the detail view, dropping the changes', async () => {
    const props = setup();
    await edit();
    await type('x');
    await click(within(dialog()).getByRole('button', { name: 'dp.back' }));
    await click(screen.getByRole('button', { name: 'dp.discard' }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByText('hello')).toBeTruthy();
  });
});

describe('RecordModal — action screens', () => {
  function Screen({ done, cancel }: { done: () => void; cancel: () => void }) {
    const [pick, setPick] = useState('');
    return (
      <ActionScreen onCancel={cancel} dirty={pick !== ''} confirmLabel="Do it" confirmDisabled={pick === ''} onConfirm={async () => done()}>
        <input aria-label="Pick" value={pick} onChange={(e) => setPick(e.target.value)} />
      </ActionScreen>
    );
  }
  const actions = (over: Partial<ActionDef<Rec>> = {}): ActionDef<Rec>[] => [{
    key: 'do', label: 'Do thing',
    screen: (c) => <Screen done={() => c.done(rec({ note: 'after' }), 'Done msg')} cancel={c.cancel} />, ...over,
  }];
  const openDo = async () => {
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    await click(screen.getByRole('menuitem', { name: 'Do thing' }));
  };

  it('replaces the body inside the same modal (same size), with breadcrumb ← SN-001 › Do thing and [Hủy] [Do it] in the footer', async () => {
    setup({ actions: actions() });
    await openDo();
    expect(dialog().classList.contains('modal-dialog--l')).toBe(true);
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('Do thing');
    expect(footerButtons()).toEqual(['common.cancel', 'Do it']);
    expect((within(footer()).getByRole('button', { name: 'Do it' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('done → back to the detail and the updated row is reported; cancel → back with nothing reported', async () => {
    const props = setup({ actions: actions() });
    await openDo();
    await act(async () => { fireEvent.change(screen.getByLabelText('Pick'), { target: { value: 'x' } }); });
    await click(within(footer()).getByRole('button', { name: 'Do it' }));
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ note: 'after' }), false);
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('SN-001');
    await openDo();
    await click(within(footer()).getByRole('button', { name: 'common.cancel' }));
    expect(props.onSaved).toHaveBeenCalledTimes(1);
  });

  it('a choice made on an action screen counts as an unsaved change', async () => {
    const props = setup({ actions: actions() });
    await openDo();
    await act(async () => { fireEvent.change(screen.getByLabelText('Pick'), { target: { value: 'x' } }); });
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.getByText('dp.discardTitle')).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('removed → the record is gone: onDeleted is called', async () => {
    const props = setup({ actions: actions({ screen: (c) => <ActionScreen onCancel={c.cancel} danger confirmLabel="Delete it" onConfirm={async () => c.removed('Deleted msg')} /> }) });
    await openDo();
    await click(within(footer()).getByRole('button', { name: 'Delete it' }));
    expect(props.onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  it('while an action runs the modal cannot be closed', async () => {
    let finish!: () => void;
    const props = setup({ actions: actions({ screen: (c) => (
      <ActionScreen onCancel={c.cancel} confirmLabel="Run" onConfirm={() => new Promise<void>((resolve) => { finish = resolve; })} />
    ) }) });
    await openDo();
    await click(within(footer()).getByRole('button', { name: 'Run' }));
    expect((within(dialog()).getByRole('button', { name: 'common.close' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect((within(dialog()).getByRole('button', { name: 'common.close' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a hidden action is in neither the footer nor the menu but opens from a link inside the detail (openAction)', async () => {
    function Link() { const rc = useRecordContext(); return <button type="button" onClick={() => rc?.openAction('secret')}>open secret</button>; }
    setup({
      actions: [{ key: 'secret', label: 'Secret screen', hidden: true, screen: (c) => <ActionScreen onCancel={c.cancel} confirmLabel="Go" onConfirm={async () => {}} /> }],
      sections: [{ key: 'main', title: 'Main', fields: [{ key: 'name', label: 'Name', view: () => <Link /> }] }],
    });
    expect(footerButtons()).toEqual(['common.edit']);
    await click(screen.getByRole('button', { name: 'open secret' }));
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('Secret screen');
  });

  it('the dry-run style "run" action (no screen) executes at once and reports the updated row', async () => {
    const run = vi.fn(async () => rec({ note: 'ran' }));
    const props = setup({ actions: [{ key: 'run', label: 'Run now', run, runMessage: 'ok' }] });
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    await click(screen.getByRole('menuitem', { name: 'Run now' }));
    expect(run).toHaveBeenCalled();
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ note: 'ran' }), false);
  });
});

describe('RecordModal — generic delete', () => {
  it('canDelete + onDelete adds a red Delete item that asks for confirmation on its own screen', async () => {
    const onDelete = vi.fn(async () => {});
    const props = setup({ canDelete: true, onDelete, deleteWarning: () => 'Really?' });
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    const item = screen.getByRole('menuitem', { name: 'common.delete' });
    expect(item.getAttribute('data-danger')).toBe('true');
    await click(item);
    expect(within(dialog()).getByText('Really?')).toBeTruthy();
    await click(within(footer()).getByRole('button', { name: 'common.delete' }));
    expect(onDelete).toHaveBeenCalled();
    expect(props.onDeleted).toHaveBeenCalled();
  });
});

beforeEach(() => phone(false));
