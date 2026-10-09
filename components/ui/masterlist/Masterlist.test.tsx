// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
// IntersectionObserver không có trong jsdom.
class IO { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO);

import { Masterlist, RowCard, type Column } from './Masterlist';

type Row = { id: string; serial: string; type: string | null; qty: number };
const rows: Row[] = [
  { id: 'a', serial: 'SN-10', type: 'Tester', qty: 3 },
  { id: 'b', serial: 'SN-2', type: 'Base', qty: 1 },
  { id: 'c', serial: 'SN-1', type: 'Tester', qty: 2 },
  { id: 'd', serial: 'XYZ', type: null, qty: 5 },
];
const columns: Column<Row>[] = [
  { key: 'serial', label: 'Serial', value: (r) => r.serial },
  { key: 'type', label: 'Type', value: (r) => r.type, filter: true },
  { key: 'qty', label: 'Qty', value: (r) => r.qty },
];

function setup(onViewChange = vi.fn(), onSelect = vi.fn()) {
  render(
    <Masterlist<Row> title="Test" rows={rows} loading={false} error={null} columns={columns} storageKey={`t-${Math.random()}`}
      selectedId={null} onSelect={onSelect} exportName="test" onViewChange={onViewChange} />,
  );
  return { onViewChange, onSelect };
}
const lastView = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0];
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('Masterlist — docs/DETAIL_MODEL.md mục 2', () => {
  it('shows every row with a running No column', () => {
    const { onViewChange } = setup();
    expect(bodyRows()).toHaveLength(4);
    expect(bodyRows().map((r) => r.querySelector('.ml-col-no')?.textContent)).toEqual(['1', '2', '3', '4']);
    expect(lastView(onViewChange)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('searches across columns (case-insensitive) and reports the visible order', () => {
    const { onViewChange } = setup();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tester' } });
    expect(lastView(onViewChange)).toEqual(['a', 'c']);
  });

  it('sorts naturally (SN-2 before SN-10), then descending, then back to original', () => {
    const { onViewChange } = setup();
    const header = screen.getByRole('button', { name: /Serial/ });
    fireEvent.click(header);
    expect(lastView(onViewChange)).toEqual(['c', 'b', 'a', 'd']);
    fireEvent.click(header);
    expect(lastView(onViewChange)).toEqual(['d', 'a', 'b', 'c']);
    fireEvent.click(header);
    expect(lastView(onViewChange)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by a column value, including empty', () => {
    const { onViewChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /ml.filters/ }));
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'Base' } });
    expect(lastView(onViewChange)).toEqual(['b']);
    fireEvent.change(select, { target: { value: '' } });
    expect(lastView(onViewChange)).toEqual(['d']);
  });

  it('opens a row by click and by keyboard', () => {
    const { onSelect } = setup();
    fireEvent.click(bodyRows()[1]!);
    expect(onSelect).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(bodyRows()[2]!, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('c');
  });

  it('keeps a name on the icon-only toolbar buttons (Columns, Export) for assistive tech and tooltips', () => {
    setup();
    for (const name of ['ml.columns', 'ml.export']) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('title')).toBe(name);
      expect(button.classList.contains('ml-btn--collapsible')).toBe(true);
    }
  });

  it('clamps a wrapping column to two lines so one long remark cannot make a row tall', () => {
    const wrapRows = [{ ...rows[0]!, note: 'x'.repeat(400) }];
    render(
      <Masterlist<Row & { note: string }> title="Wrap" rows={wrapRows} loading={false} error={null}
        columns={[...columns, { key: 'note', label: 'Note', value: (r) => r.note, wrap: true }] as Column<Row & { note: string }>[]}
        storageKey={`w-${Math.random()}`} selectedId={null} onSelect={() => {}} exportName="test" />,
    );
    const cell = document.querySelector('td[data-wrap]') as HTMLElement;
    expect(cell.querySelector('.ml-clamp')?.textContent).toHaveLength(400);
    expect(cell.title).toHaveLength(400); // the full text stays reachable
    expect(document.querySelector('td:not([data-wrap]) .ml-clamp')).toBeNull();
  });

  it('offers the add action when the list is genuinely empty — not when filters hide everything', () => {
    const onAdd = vi.fn();
    const { unmount } = render(
      <Masterlist<Row> title="Empty" rows={[]} loading={false} error={null} columns={columns} storageKey={`e-${Math.random()}`}
        selectedId={null} onSelect={() => {}} exportName="test" onAdd={onAdd} addLabel="Add thing" />,
    );
    expect(screen.getByText('ml.emptyTitle')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /Add thing/ });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    unmount();

    setup();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-such-row' } });
    expect(screen.getByText('ml.noMatch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ml.clearFilters' })).toBeTruthy();
  });

  it('defaultColumns: only those show, in that order; the rest are hidden but can be opened in Column settings', () => {
    render(
      <Masterlist<Row> title="Test" rows={rows} loading={false} error={null} columns={columns} storageKey={`t-${Math.random()}`}
        defaultColumns={['qty', 'serial']} selectedId={null} onSelect={vi.fn()} exportName="test" />,
    );
    const headers = () => within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers().some((h) => h.includes('Qty'))).toBe(true);
    expect(headers().some((h) => h.includes('Type'))).toBe(false);
    expect(headers().findIndex((h) => h.includes('Qty'))).toBeLessThan(headers().findIndex((h) => h.includes('Serial')));
    fireEvent.click(screen.getByRole('button', { name: /ml.columns|Columns/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Type/ }));
    expect(headers().some((h) => h.includes('Type'))).toBe(true);
  });

  it('hides a column from Column settings and keeps the others', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /ml.columns/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Type' }));
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['ml.no', 'Serial', 'Qty']);
  });
});

/** Phone layout: matchMedia('(max-width: 767px)') reports a match. */
function phoneMode(on: boolean) {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: on, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
}

describe('Phone layout — a card per row instead of a squeezed table', () => {
  afterEach(() => phoneMode(false));
  const cards = () => screen.queryAllByRole('button').filter((b) => b.classList.contains('ml-card'));
  function setupPhone(extra: Partial<Parameters<typeof Masterlist<Row>>[0]> = {}) {
    phoneMode(true);
    const onSelect = vi.fn();
    const onViewChange = vi.fn();
    render(
      <Masterlist<Row> title="Phone" rows={rows} loading={false} error={null} columns={columns} storageKey={`p-${Math.random()}`}
        selectedId={null} onSelect={onSelect} exportName="test" onViewChange={onViewChange}
        mobileCard={(r) => <RowCard title={r.serial} tag={r.type} lines={[`qty ${r.qty}`]} />} {...extra} />,
    );
    return { onSelect, onViewChange };
  }

  it('renders one tappable card per row — no table, no column picker, no sort headers', () => {
    const { onSelect } = setupPhone();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /ml.columns/ })).toBeNull();
    expect(cards().map((c) => c.querySelector('.rc-title')?.textContent)).toEqual(['SN-10', 'SN-2', 'SN-1', 'XYZ']);
    fireEvent.click(cards()[1]!);
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('builds a card from the columns when the module gives none', () => {
    setupPhone({ mobileCard: undefined });
    const first = cards()[0]!;
    expect(first.querySelector('.rc-title')?.textContent).toBe('SN-10');
    expect(first.textContent).toContain('Tester');
    expect(first.textContent).toContain('3');
  });

  it('search narrows the cards and reports the visible order', () => {
    const { onViewChange } = setupPhone();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tester' } });
    expect(cards()).toHaveLength(2);
    expect(onViewChange).toHaveBeenLastCalledWith(['a', 'c']);
  });

  it('Filter & sort opens as a sheet: filter by a column, sort, see the result count, clear', () => {
    const { onViewChange } = setupPhone();
    fireEvent.click(screen.getByRole('button', { name: 'ml.filtersAndSort' }));
    const sheet = within(screen.getByRole('dialog'));
    fireEvent.change(sheet.getByRole('combobox', { name: /Type/ }), { target: { value: 'Tester' } });
    expect(onViewChange).toHaveBeenLastCalledWith(['a', 'c']);
    fireEvent.change(sheet.getByRole('combobox', { name: 'ml.sortBy' }), { target: { value: 'serial' } });
    expect(onViewChange).toHaveBeenLastCalledWith(['c', 'a']);
    fireEvent.click(sheet.getByRole('button', { name: /ml.sortDesc/ }));
    expect(onViewChange).toHaveBeenLastCalledWith(['a', 'c']);
    expect(sheet.getByRole('button', { name: /ml.showResults/ })).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'ml.clearFilters' }));
    expect(onViewChange).toHaveBeenLastCalledWith(['a', 'b', 'c', 'd']);
    fireEvent.click(sheet.getByRole('button', { name: /ml.showResults/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('active filter and sort show as removable chips when the sheet is closed', () => {
    const { onViewChange } = setupPhone();
    fireEvent.click(screen.getByRole('button', { name: 'ml.filtersAndSort' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: /Type/ }), { target: { value: 'Base' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /ml.showResults/ }));
    fireEvent.click(screen.getByRole('button', { name: /Type: Base/ }));
    expect(onViewChange).toHaveBeenLastCalledWith(['a', 'b', 'c', 'd']);
  });

  it('puts Export and module tools in one ⋮ menu; Add is the floating + of the workspace, not a toolbar button', () => {
    const open = vi.fn();
    setupPhone({ onAdd: vi.fn(), tools: [{ key: 'import', label: 'Import Excel', onClick: open }] });
    expect(screen.queryByRole('button', { name: /ml.add/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ml.moreActions' }));
    expect(screen.getByRole('menuitem', { name: /ml.export/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import Excel' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows quick filters as chips under the toolbar', () => {
    const { onViewChange } = setupPhone({ quickFilters: [{ key: 'many', label: 'Many', test: (r) => r.qty >= 3 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Many' }));
    expect(onViewChange).toHaveBeenLastCalledWith(['a', 'd']);
  });
});

describe('Masterlist — speed: search index and row memoization', () => {
  const mount = (over: Partial<Parameters<typeof Masterlist<Row>>[0]> = {}) => render(
    <Masterlist<Row> title="Test" rows={rows} loading={false} error={null} columns={columns} storageKey={`t-${Math.random()}`}
      selectedId={null} onSelect={vi.fn()} exportName="test" {...over} />,
  );

  it('search still reaches columns that are hidden from the table', () => {
    const onViewChange = vi.fn();
    mount({ defaultColumns: ['serial'], onViewChange });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'base' } }); // "Type" is not shown
    expect(lastView(onViewChange)).toEqual(['b']);
  });

  it('a search never matches across the border of two columns', () => {
    const onViewChange = vi.fn();
    mount({ onViewChange });
    // "SN-2" + "Base" would read "SN-2Base" if the columns were glued together without a separator
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sn-2base' } });
    expect(lastView(onViewChange)).toEqual([]);
  });

  it('a new set of rows is searched from scratch (the per-row search text is not reused for other data)', () => {
    const onViewChange = vi.fn();
    const { rerender } = mount({ onViewChange });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(lastView(onViewChange)).toEqual([]);
    const next: Row[] = [...rows, { id: 'e', serial: 'ZZZ-1', type: 'Fixture', qty: 9 }];
    rerender(
      <Masterlist<Row> title="Test" rows={next} loading={false} error={null} columns={columns} storageKey="t-x"
        selectedId={null} onSelect={vi.fn()} exportName="test" onViewChange={onViewChange} />,
    );
    expect(lastView(onViewChange)).toEqual(['e']);
  });

  it('selecting a row (or opening / closing a modal) redraws only the rows whose state changed — not every row', () => {
    let draws = 0;
    const counting: Column<Row>[] = [{ key: 'serial', label: 'Serial', value: (r) => r.serial, render: (r) => { draws++; return r.serial; } }];
    const props = { title: 'Test', rows, loading: false, error: null, columns: counting, storageKey: 't-memo', exportName: 'test' } as const;
    const { rerender } = render(<Masterlist<Row> {...props} selectedId={null} onSelect={vi.fn()} />);
    expect(draws).toBe(4);
    draws = 0;
    rerender(<Masterlist<Row> {...props} selectedId="b" onSelect={vi.fn()} />); // a new onSelect every render, as the workspace gives
    expect(draws).toBe(1); // only the newly selected row
    draws = 0;
    rerender(<Masterlist<Row> {...props} selectedId="c" onSelect={vi.fn()} />);
    expect(draws).toBe(2); // the row that lost the selection and the one that gained it
    draws = 0;
    rerender(<Masterlist<Row> {...props} selectedId="c" onSelect={vi.fn()} />);
    expect(draws).toBe(0); // nothing changed
  });

  it('a row click still reaches the CURRENT onSelect after re-renders', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = mount({ onSelect: first });
    rerender(
      <Masterlist<Row> title="Test" rows={rows} loading={false} error={null} columns={columns} storageKey="t-y"
        selectedId={null} onSelect={second} exportName="test" />,
    );
    fireEvent.click(screen.getByText('XYZ'));
    expect(second).toHaveBeenCalledWith('d');
    expect(first).not.toHaveBeenCalled();
  });
});
