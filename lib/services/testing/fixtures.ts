/**
 * Dữ liệu gốc (Configuration) dùng chung cho các bài test service — không có database thật.
 *
 *   Group:        group-0 Tester (tester) · group-1 Base (base) · group-2 Fixture (fixture) · group-3 Sub-equipment (sub_equipment)
 *   Type:         type-0 Tester (tester) · type-1 Fixture (fixture) · type-2 Base (base) · type-3 DMM (sub_equipment)
 *   Part number:  pn-0 P12316 → Tester · pn-1 P20001 → Fixture · pn-2 OLD-PN (đã ẩn) → Tester · pn-3 B-100 → Base ·
 *                 pn-4 DMM-100 → DMM · pn-5 DMM-OLD (đã ẩn) → DMM
 *   Level:        level-0..4 = 1..5          Location: loc-0 B3F1 · loc-1 B3F2 · loc-2 Closed (đã ẩn)
 */
import type { Lookups } from '../core/lookups';
import type { TypeKind } from '@/lib/types';

export type Named = { id: string; display_name: string; sort_order: number; is_active: boolean };

export const named = (prefix: string, names: [string, boolean?][]): Map<string, Named> =>
  new Map(names.map(([name, active = true], i) => [`${prefix}-${i}`, { id: `${prefix}-${i}`, display_name: name, sort_order: i, is_active: active }]));

const GROUPS: [string, TypeKind][] = [['Tester', 'tester'], ['Base', 'base'], ['Fixture', 'fixture'], ['Sub-equipment', 'sub_equipment']];
/** type → [tên, kind, group id] */
const TYPES: [string, TypeKind, string][] = [['Tester', 'tester', 'group-0'], ['Fixture', 'fixture', 'group-2'], ['Base', 'base', 'group-1'], ['DMM', 'sub_equipment', 'group-3']];

/** part number → [tên, type id, đang dùng] */
const PART_NUMBERS: [string, string, boolean][] = [
  ['P12316', 'type-0', true], ['P20001', 'type-1', true], ['OLD-PN', 'type-0', false],
  ['B-100', 'type-2', true], ['DMM-100', 'type-3', true], ['DMM-OLD', 'type-3', false],
];

/** Type của từng part number (để dựng equipment có sẵn). */
export const TYPE_OF_PART: Record<string, string> = Object.fromEntries(PART_NUMBERS.map(([, type], i) => [`pn-${i}`, type]));

export function makeLookups(over: Partial<Lookups> = {}): Lookups {
  return {
    part_numbers: new Map(PART_NUMBERS.map(([name, type_id, active], i) => [
      `pn-${i}`, { id: `pn-${i}`, display_name: name, sort_order: i, is_active: active, type_id, level_id: null },
    ])),
    types: new Map(TYPES.map(([name, kind, group_id], i) => [
      `type-${i}`, { id: `type-${i}`, display_name: name, sort_order: i, is_active: true, kind, group_id },
    ])),
    type_groups: new Map(GROUPS.map(([name, kind], i) => [
      `group-${i}`, { id: `group-${i}`, display_name: name, sort_order: i, is_active: true, kind },
    ])),
    levels: named('level', [['1'], ['2'], ['3'], ['4'], ['5']]),
    locations: named('loc', [['B3F1'], ['B3F2'], ['Closed', false]]),
    departments: named('dep', [['TE'], ['PE']]),
    calibration_vendors: named('vendor', [['Acme'], ['Old Lab', false]]),
    tags: new Map([
      ['tg1', { id: 'tg1', display_name: 'Repair', sort_order: 1, color: 'yellow' as const }],
      ['tg2', { id: 'tg2', display_name: 'Spare', sort_order: 2, color: 'gray' as const }],
    ]),
    users: new Map([['u1', 'Ann Admin']]),
    ...over,
  };
}
