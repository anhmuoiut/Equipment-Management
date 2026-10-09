// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { card } from '@/lib/client/testing/assetFixtures';
import { columnEntries } from './OverviewBoard';
import type { OverviewColumn } from '@/lib/types';

const column = (cards: ReturnType<typeof card>[], more = 0): OverviewColumn => ({ root_id: cards[0]!.id, cards, more, alerts: 0 });
const root = card({ id: 'r', serial_number: 'R', kind: 'tester' });
const child = (id: string, parent: string, depth: number) => card({ id, serial_number: id.toUpperCase(), parent_id: parent, depth });
const shape = (c: OverviewColumn) => columnEntries(c).map((e) => [e.card?.id ?? 'more', e.guides.join(' ')]);

describe('columnEntries — the tree lines of a column', () => {
  it('a column with only its root has no rows', () => {
    expect(columnEntries(column([root]))).toEqual([]);
  });

  it('children of the root: ├ for all but the last, └ for the last', () => {
    expect(shape(column([root, child('a', 'r', 1), child('b', 'r', 1), child('c', 'r', 1)]))).toEqual([['a', 'mid'], ['b', 'mid'], ['c', 'last']]);
  });

  it('a parent with more brothers after it keeps its vertical line next to its own children; the last parent leaves a blank', () => {
    const c = column([root, child('a', 'r', 1), child('a1', 'a', 2), child('a2', 'a', 2), child('b', 'r', 1), child('b1', 'b', 2)]);
    expect(shape(c)).toEqual([['a', 'mid'], ['a1', 'line mid'], ['a2', 'line last'], ['b', 'last'], ['b1', 'blank last']]);
  });

  it('"+N thiết bị" is the last branch of the root: every real child before it gets ├', () => {
    expect(shape(column([root, child('a', 'r', 1), child('a1', 'a', 2)], 4))).toEqual([['a', 'mid'], ['a1', 'line last'], ['more', 'last']]);
    expect(shape(column([root], 3))).toEqual([['more', 'last']]);
  });

  it('a chain Base → Fixture → Golden (parents pulled in to keep the tree whole) is drawn one level deeper each time', () => {
    const c = column([root, child('b', 'r', 1), child('f', 'b', 2), child('g', 'f', 3)]);
    expect(shape(c)).toEqual([['b', 'last'], ['f', 'blank last'], ['g', 'blank blank last']]);
  });
});
