// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(async () => ({ data: [], meta: {} })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '@/lib/client/api';
import { treeResponse } from '@/lib/client/testing/assetFixtures';
import { TreeTab } from '@/components/assets/TreeTab';
import { RecordModal, type RecordModalProps } from './RecordModal';

type Rec = {
  id: string; name: string; note: string;
  created_at: string; created_by: string | null; created_by_name: string | null;
  updated_at: string; updated_by: string | null; updated_by_name: string | null;
};
const rec = (over: Partial<Rec> = {}): Rec => ({
  id: 'r1', name: 'SN-001', note: 'record details',
  created_at: '2026-10-01T01:00:00Z', created_by: null, created_by_name: null,
  updated_at: '2026-10-01T02:00:00Z', updated_by: null, updated_by_name: null, ...over,
});

function phone(on: boolean) {
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: on, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}

function props(over: Partial<RecordModalProps<Rec>> = {}): RecordModalProps<Rec> {
  return {
    size: 'l', record: rec(), heading: (r) => ({ title: r.name }),
    sections: [{ key: 'main', title: 'Main', fields: [{ key: 'note', label: 'Note', kind: 'textarea' }] }],
    detailAsideTab: 'tree',
    extraTabs: [{ key: 'tree', label: 'Equipment tree', render: (r) => <p>Tree for {r.name}</p> }],
    historyUrl: (r) => `/api/records/${r.id}/history`,
    canEdit: true,
    onSave: vi.fn(async (payload, current) => ({ row: { ...(current ?? rec()), ...payload } as Rec })),
    onClose: vi.fn(), onSaved: vi.fn(), ...over,
  };
}

const dialog = () => screen.getByRole('dialog');
const footer = () => dialog().querySelector('.modal-footer') as HTMLElement;
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); };

beforeEach(() => { phone(false); vi.mocked(api.get).mockClear(); });

describe('RecordModal — equipment split detail', () => {
  it('shows the details on the left and the equipment tree on the right on desktop without a separate tree tab', () => {
    render(<RecordModal {...props()} />);
    const regions = within(dialog()).getAllByRole('region');
    expect(regions.map((region) => region.getAttribute('aria-label'))).toEqual(['dp.tabInfo', 'Equipment tree']);
    expect(within(regions[1]!).getByText('Tree for SN-001')).toBeTruthy();
    expect(within(regions[0]!).getByText('record details')).toBeTruthy();
    expect(within(regions[0]!).getByText('dp.systemInfo')).toBeTruthy();
    expect(within(dialog()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['dp.tabInfo', 'dp.tabHistory']);
    expect(within(dialog()).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens a desktop tree deep link as the combined detail view', () => {
    render(<RecordModal {...props({ initialTab: 'tree' })} />);
    expect(within(dialog()).queryByRole('tab', { name: 'Equipment tree' })).toBeNull();
    expect(within(dialog()).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true');
    expect(within(dialog()).getByText('Tree for SN-001')).toBeTruthy();
    expect(within(dialog()).getByText('record details')).toBeTruthy();
  });

  it('keeps separate information and tree tabs on a phone, including a tree deep link', async () => {
    phone(true);
    render(<RecordModal {...props({ initialTab: 'tree' })} />);
    expect(within(dialog()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['dp.tabInfo', 'Equipment tree', 'dp.tabHistory']);
    expect(within(dialog()).getByRole('tab', { name: 'Equipment tree' }).getAttribute('aria-selected')).toBe('true');
    expect(within(dialog()).getByText('Tree for SN-001')).toBeTruthy();
    expect(within(dialog()).queryByText('record details')).toBeNull();
    await click(within(dialog()).getByRole('tab', { name: 'dp.tabInfo' }));
    expect(within(dialog()).getByText('record details')).toBeTruthy();
    expect(within(dialog()).queryByText('Tree for SN-001')).toBeNull();
  });

  it('shows history separately and restores both panes when returning to information', async () => {
    render(<RecordModal {...props()} />);
    await click(within(dialog()).getByRole('tab', { name: 'dp.tabHistory' }));
    await waitFor(() => expect(within(dialog()).getByText('hist.empty')).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith('/api/records/r1/history');
    expect(within(dialog()).queryByText('Tree for SN-001')).toBeNull();
    expect(within(dialog()).queryByText('record details')).toBeNull();
    await click(within(dialog()).getByRole('tab', { name: 'dp.tabInfo' }));
    expect(within(dialog()).getByText('Tree for SN-001')).toBeTruthy();
    expect(within(dialog()).getByText('record details')).toBeTruthy();
  });

  it('shows the edit form on its own and returns to both panes after cancel or save', async () => {
    const modalProps = props();
    render(<RecordModal {...modalProps} />);
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    expect(within(dialog()).queryByText('Tree for SN-001')).toBeNull();
    expect(screen.getByLabelText('Note')).toBeTruthy();
    await click(within(footer()).getByRole('button', { name: 'common.cancel' }));
    expect(within(dialog()).getByText('Tree for SN-001')).toBeTruthy();
    expect(within(dialog()).getByText('record details')).toBeTruthy();
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    await act(async () => { fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'changed details' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(modalProps.onSaved).toHaveBeenCalledWith(expect.objectContaining({ note: 'changed details' }), false);
    expect(within(dialog()).getByText('Tree for SN-001')).toBeTruthy();
    expect(within(dialog()).getByText('record details')).toBeTruthy();
  });

  it('tree selection updates the current record and its details inside the same desktop modal', async () => {
    const onOpen = vi.fn();
    function EquipmentDetail() {
      const [record, setRecord] = useState(rec({ id: 'e-fixture', name: 'FIXTURE-01', note: 'fixture details' }));
      return <RecordModal {...props({
        record,
        extraTabs: [{ key: 'tree', label: 'Equipment tree', render: (r) => (
          <TreeTab tree={treeResponse} onRetry={vi.fn()} current={{ type: 'equipment', id: r.id }}
            onOpen={(type, id) => {
              onOpen(type, id);
              setRecord(rec({ id, name: 'BASE-01', note: 'base details' }));
            }} />
        ) }],
      })} />;
    }
    render(<EquipmentDetail />);
    await click(within(screen.getByRole('tree')).getByText('BASE-01'));
    expect(onOpen).toHaveBeenCalledWith('equipment', 'e-base');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('BASE-01');
    expect(within(dialog()).getByText('base details')).toBeTruthy();
    expect(within(dialog()).queryByText('fixture details')).toBeNull();
    expect(screen.getByRole('tree').querySelector('[data-current]')!.textContent).toContain('BASE-01');
  });
});
