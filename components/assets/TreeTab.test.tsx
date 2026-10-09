// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${key}:${o.count}` : key), i18n: { language: 'en' } }),
}));
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '@/lib/client/api';
import { treeResponse } from '@/lib/client/testing/assetFixtures';
import { TreeTab } from './TreeTab';
import type { EquipmentTree, TreeNode } from '@/lib/types';

const onOpen = vi.fn();
const onRetry = vi.fn();
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

async function mount(tree: EquipmentTree = treeResponse, current = { type: 'equipment' as const, id: 'e-fixture' }) {
  await act(async () => { render(<TreeTab tree={tree} onRetry={onRetry} current={current} onOpen={onOpen} />); });
  await waitFor(() => expect(screen.getByRole('tree')).toBeTruthy());
}

beforeEach(() => { onOpen.mockReset(); onRetry.mockReset(); });

describe('TreeTab — consumes the real tree response { root_id, nodes }', () => {
  it('draws the tree from the root with PN and SN per row, "Sub" / "Golden" badges, and marks the current device', async () => {
    await mount();
    const rows = within(screen.getByRole('tree')).getAllByRole('treeitem');
    expect(rows).toHaveLength(6);
    expect(rows[0]!.textContent).toContain('TESTER-01');
    expect(within(screen.getByRole('tree')).getAllByText('asset.kindSub')).toHaveLength(2);
    expect(within(screen.getByRole('tree')).getByText('asset.kindGolden')).toBeTruthy();
    expect(screen.getByRole('tree').querySelector('[data-current]')!.textContent).toContain('FIXTURE-01');
    expect(screen.getByText('eq.treeCount:6')).toBeTruthy();
  });

  it('a big tree opens only the chain to the current device and one level below; a small one opens everything', async () => {
    const filler: TreeNode[] = Array.from({ length: 40 }, (_, i) => ({
      asset_type: 'sub_equipment', id: `f${i}`, kind: 'sub_equipment', type_name: 'DMM', usage: 'in_use', cal_status: 'valid',
      parent_id: 'e-tester', part_number: 'DMM-100', serial_number: `FILL-${i}`,
    }));
    await mount({ root_id: 'e-tester', nodes: [...treeResponse.nodes, ...filler] });
    // Tester → Base → Fixture đều mở; golden board (con của Fixture) hiện; mọi sub-equipment là lá nên hiện.
    expect(screen.getAllByRole('treeitem').length).toBe(46);
  });

  it('a tree that is only the device itself (Base / Fixture with no Tester) still renders', async () => {
    await mount({
      root_id: 'e-spare',
      nodes: [{ asset_type: 'equipment', id: 'e-spare', kind: 'base', type_name: 'Base', usage: 'not_in_use', cal_status: null, parent_id: null, part_number: 'P20001', serial_number: 'BASE-02' }],
    }, { type: 'equipment', id: 'e-spare' });
    expect(screen.getAllByRole('treeitem')).toHaveLength(1);
  });

  it('clicking an equipment row opens it; the row of the device already open does nothing; the ▸/▾ only toggles', async () => {
    await mount();
    await click(screen.getByText('BASE-01'));
    expect(onOpen).toHaveBeenCalledWith('equipment', 'e-base');
    onOpen.mockReset();
    await click(screen.getByText('FIXTURE-01'));
    expect(onOpen).not.toHaveBeenCalled();
    const baseRow = screen.getByText('BASE-01').closest('li') as HTMLElement;
    await click(within(baseRow).getByRole('button', { name: 'eq.collapse' }));
    expect(screen.queryByText('FIXTURE-01')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    await click(screen.getByText('DMM-2'));
    expect(onOpen).toHaveBeenCalledWith('sub_equipment', 's2');
  });

  it('search highlights matching rows and opens the branches that hold them', async () => {
    await mount();
    await click(screen.getByRole('button', { name: 'eq.collapseAll' }));
    expect(screen.getAllByRole('treeitem')).toHaveLength(1);
    await act(async () => { fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gb-1' } }); });
    expect(screen.getByText('GB-1').closest('li')!.hasAttribute('data-match')).toBe(true);
    expect(screen.getByText('FIXTURE-01')).toBeTruthy();
  });

  it('keyboard: ↓ moves, → opens, ← closes, Enter opens the detail', async () => {
    await mount();
    await click(screen.getByRole('button', { name: 'eq.collapseAll' }));
    const root = screen.getByText('TESTER-01').closest('.tree-row') as HTMLElement;
    root.focus();
    await act(async () => { fireEvent.keyDown(root, { key: 'ArrowRight' }); });
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(1);
    await act(async () => { fireEvent.keyDown(root, { key: 'ArrowLeft' }); });
    expect(screen.getAllByRole('treeitem')).toHaveLength(1);
    await act(async () => { fireEvent.keyDown(root, { key: 'Enter' }); });
    expect(onOpen).toHaveBeenCalledWith('equipment', 'e-tester');
  });

  it('a failed load shows the error; Retry asks the modal to load the tree again', async () => {
    await act(async () => { render(<TreeTab tree={null} error="boom" onRetry={onRetry} current={{ type: 'equipment', id: 'e1' }} onOpen={onOpen} />); });
    expect(screen.getByText('boom')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'common.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('while the modal is still loading the tree, a spinner — no tree, no error', async () => {
    await act(async () => { render(<TreeTab tree={null} onRetry={onRetry} current={{ type: 'equipment', id: 'e1' }} onOpen={onOpen} />); });
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
  });
});
