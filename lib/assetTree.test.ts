import { describe, expect, it } from 'vitest';
import { parentAllowed, type AssetKind } from './assetTree';

/** docs/DATABASE.md "Cây tài sản": ai được nằm dưới ai. */
describe('parentAllowed — cùng bảng quy tắc với database (asset_parent_allowed)', () => {
  const kinds: AssetKind[] = ['tester', 'base', 'fixture', 'sub_equipment', 'golden_board'];
  const allowed: Record<string, AssetKind[]> = {
    tester: ['base', 'fixture', 'sub_equipment', 'golden_board'],
    base: ['fixture'],
    fixture: ['golden_board'],
  };

  it.each(['tester', 'base', 'fixture'])('under a %s only the allowed kinds', (parent) => {
    for (const child of kinds) expect(parentAllowed(child, parent)).toBe(allowed[parent]!.includes(child));
  });

  it('a Tester never has a parent; sub-equipment and golden boards are leaves; unknown or empty parents allow nothing', () => {
    for (const parent of kinds) expect(parentAllowed('tester', parent)).toBe(false);
    for (const parent of ['sub_equipment', 'golden_board', 'wat', '', null, undefined]) {
      for (const child of kinds) expect(parentAllowed(child, parent)).toBe(false);
    }
  });
});
