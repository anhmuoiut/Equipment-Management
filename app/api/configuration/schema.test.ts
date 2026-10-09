import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { configList } from '@/lib/configuration';
import { schemaFor } from './schema';

const UUID = '3f0c2a4e-6b1d-4c58-9a57-0d8f2b6e7a11';
const parse = (key: string, mode: 'create' | 'update', body: unknown) => schemaFor(configList(key)!, mode).safeParse(body);

describe('configuration payloads — Group of a Type and Level of a part number', () => {
  it('a new Type must name its Group; the kind is never sent (the database derives it from the Group)', () => {
    expect(parse('types', 'create', { display_name: 'Scope', sort_order: 0, is_active: true }).success).toBe(false);
    expect(parse('types', 'create', { display_name: 'Scope', sort_order: 0, is_active: true, group_id: UUID }).success).toBe(true);
    expect(parse('types', 'create', { display_name: 'Scope', sort_order: 0, is_active: true, group_id: UUID, kind: 'tester' }).success).toBe(false);
    expect(parse('types', 'update', { group_id: UUID }).success).toBe(true);
    expect(parse('types', 'update', { group_id: null }).success).toBe(false);
    expect(parse('types', 'update', { kind: 'tester' }).success).toBe(false);
  });

  it('a Group is just a name, an order and "in use" — no kind, no Type fields', () => {
    expect(parse('type-groups', 'create', { display_name: 'Meters', sort_order: 1, is_active: true }).success).toBe(true);
    expect(parse('type-groups', 'create', { display_name: 'Meters', sort_order: 1, is_active: true, kind: 'tester' }).success).toBe(false);
    expect(parse('type-groups', 'create', { display_name: 'Meters', sort_order: 1, is_active: true, group_id: UUID }).success).toBe(false);
    expect(parse('type-groups', 'update', { is_active: false }).success).toBe(true);
  });

  it('a part number may carry a Level (a Level id, or null to clear it) but a Level is not required', () => {
    const base = { display_name: 'P1', sort_order: 0, is_active: true, type_id: UUID };
    expect(parse('part-numbers', 'create', base).success).toBe(true);
    expect(parse('part-numbers', 'create', { ...base, level_id: UUID }).success).toBe(true);
    expect(parse('part-numbers', 'create', { ...base, level_id: null }).success).toBe(true);
    expect(parse('part-numbers', 'create', { ...base, level_id: 'not-an-id' }).success).toBe(false);
    expect(parse('part-numbers', 'update', { level_id: null }).success).toBe(true);
  });

  it('other lists did not gain these fields', () => {
    expect(parse('locations', 'create', { display_name: 'B3F1', sort_order: 0, is_active: true, level_id: UUID }).success).toBe(false);
    expect(parse('levels', 'create', { display_name: '1', sort_order: 0, is_active: true, group_id: UUID }).success).toBe(false);
  });
});
