import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('./db', () => ({ db: () => ({ from: m.from }) }));

import { fakeListDb } from '../testing/listBuilder';
import { EMPTY_FILTER, parseListParams, runList, searchClause, type ListSpec } from './listQuery';

const SPEC: ListSpec = {
  view: 'thing_list',
  select: 'id, serial_number',
  sort: { serial_number: 'serial_nk', status: 'status' },
  defaultOrder: [['created_at', 'desc']],
  filters: {
    usage: { column: 'usage', kind: 'enum', values: ['in_use', 'not_in_use'] },
    location: { column: 'location_id', kind: 'id' },
    parent: { column: 'parent_serial', kind: 'text', allowEmpty: true },
    level: { column: 'level_id', kind: 'id', allowEmpty: true },
    tags: { column: 'tag_ids', kind: 'tag' },
  },
  quick: { attention: { column: 'status', values: ['not_calibrated', 'failed'] } },
  searchEnums: { usage: ['in_use', 'not_in_use'], status: ['valid', 'overdue'] },
};
const UUID = '3f0c2a4e-6b1d-4c58-9a57-0d8f2b6e7a11';
const parse = (query: string) => parseListParams(new URLSearchParams(query), SPEC);
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, serial_number: `S${i}` }));

describe('parseListParams', () => {
  it('defaults: page 1, 50 per page, no search / filter / sort', () => {
    expect(parse('')).toEqual({ page: 1, pageSize: 50, q: '', sort: null, dir: 'asc', filters: {}, quick: null, enums: {} });
  });

  it('reads page, page size, search, sort, filters, quick filter and enum matches', () => {
    expect(parse(`page=3&pageSize=25&q=%20dmm%20&sort=serial_number&dir=desc&f.usage=in_use&f.location=${UUID}&quick=attention&qe=usage:in_use,status:overdue`))
      .toEqual({
        page: 3, pageSize: 25, q: 'dmm', sort: 'serial_number', dir: 'desc', quick: 'attention',
        filters: { usage: 'in_use', location: UUID }, enums: { usage: ['in_use'], status: ['overdue'] },
      });
    expect(parse('pageSize=all').pageSize).toBe('all');
  });

  it('a bad page number falls back to page 1; the search text is cut to 100 characters', () => {
    expect(parse('page=0').page).toBe(1);
    expect(parse('page=abc').page).toBe(1);
    expect(parse('page=2.5').page).toBe(1);
    expect(parse(`q=${'x'.repeat(300)}`).q).toHaveLength(100);
  });

  it.each([
    ['a page size that is not offered', 'pageSize=10'],
    ['a sort column that does not exist', 'sort=password'],
    ['an unknown filter', 'f.secret=1'],
    ['an enum filter with another value', 'f.usage=maybe'],
    ['an id filter that is not an id', 'f.location=B3F1'],
    ['an empty marker on a filter that does not allow it', `f.location=${EMPTY_FILTER}`],
    ['an empty text filter', 'f.parent='],
    ['an unknown quick filter', 'quick=everything'],
    ['an enum match for a column that is not searchable', 'qe=remark:x'],
    ['an enum match with a value outside the list', 'qe=usage:broken'],
  ])('refuses %s (VALIDATION_ERROR, not silently ignored)', (_name, query) => {
    expect(() => parse(query)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('the "empty" marker is accepted where it makes sense (no parent, no level, no tag)', () => {
    expect(parse(`f.parent=${EMPTY_FILTER}&f.level=${EMPTY_FILTER}&f.tags=${EMPTY_FILTER}`).filters)
      .toEqual({ parent: EMPTY_FILTER, level: EMPTY_FILTER, tags: EMPTY_FILTER });
  });
});

describe('searchClause', () => {
  it('searches search_text with a case-insensitive pattern and ORs the enum columns', () => {
    expect(searchClause('DMM', {})).toBe('search_text.ilike."%dmm%"');
    expect(searchClause('use', { usage: ['in_use', 'not_in_use'], status: ['valid'] }))
      .toBe('search_text.ilike."%use%",usage.in.(in_use,not_in_use),status.in.(valid)');
  });

  it('characters that mean something to PostgREST or LIKE cannot break out of the value', () => {
    // , ( ) " \ stay inside the quoted value (quote and backslash escaped); % and _ are literal for LIKE
    expect(searchClause('a,b)', {})).toBe('search_text.ilike."%a,b)%"');
    expect(searchClause('say "hi"', {})).toBe('search_text.ilike."%say \\"hi\\"%"');
    expect(searchClause('50%_off', {})).toBe('search_text.ilike."%50\\\\%\\\\_off%"');
    expect(searchClause('a\\b', {})).toBe('search_text.ilike."%a\\\\\\\\b%"');
    expect(searchClause('x),usage.eq.in_use', {})).toBe('search_text.ilike."%x),usage.eq.in\\\\_use%"');
  });
});

describe('runList', () => {
  let fake: ReturnType<typeof fakeListDb>;
  const setup = (data = rows(120)) => { fake = fakeListDb(data); m.from.mockImplementation(fake.from); };
  beforeEach(() => { m.from.mockReset(); setup(); });

  it('reads ONE page: the view, the listed columns, an exact count and the range of that page', async () => {
    const page = await runList(SPEC, parse('page=2&pageSize=25'));
    expect(m.from).toHaveBeenCalledWith('thing_list');
    expect(fake.calls('select')).toEqual([['id, serial_number', { count: 'exact' }]]);
    expect(fake.calls('range')).toEqual([[25, 49]]);
    expect(page).toMatchObject({ total: 120, page: 2, pageSize: 25 });
    expect(page.rows).toHaveLength(25);
    expect(m.from).toHaveBeenCalledTimes(1); // one request for the page — no second count query
  });

  it('never reads the whole table for the first page', async () => {
    const page = await runList(SPEC, parse(''));
    expect(fake.calls('range')).toEqual([[0, 49]]);
    expect(page.rows).toHaveLength(50);
    expect(page.total).toBe(120);
  });

  it('orders by the default order or the chosen column, always ending with id so pages never overlap', async () => {
    await runList(SPEC, parse(''));
    expect(fake.calls('order')).toEqual([['created_at', { ascending: false }], ['id', { ascending: true }]]);
    await runList(SPEC, parse('sort=serial_number&dir=desc'));
    expect(fake.calls('order')).toEqual([['serial_nk', { ascending: false }], ['id', { ascending: true }]]);
  });

  it('applies filters, the quick filter and the search BEFORE the range (so they cover the whole table)', async () => {
    await runList(SPEC, parse(`f.usage=in_use&f.location=${UUID}&f.parent=${EMPTY_FILTER}&f.tags=${UUID}&quick=attention&q=abc&qe=usage:in_use`));
    const names = fake.last().calls.map(([name]) => name);
    expect(names.indexOf('range')).toBe(names.length - 1);
    expect(fake.calls('eq')).toEqual([['usage', 'in_use'], ['location_id', UUID]]);
    expect(fake.calls('is')).toEqual([['parent_serial', null]]);
    expect(fake.calls('contains')).toEqual([['tag_ids', [UUID]]]);
    expect(fake.calls('in')).toEqual([['status', ['not_calibrated', 'failed']]]);
    expect(fake.calls('or')).toEqual([['search_text.ilike."%abc%",usage.in.(in_use)']]);
  });

  it('"no tag" filters on an empty tag list; an enum match without search text filters on the enum alone', async () => {
    await runList(SPEC, parse(`f.tags=${EMPTY_FILTER}&qe=status:overdue`));
    expect(fake.calls('eq')).toEqual([['tag_ids', '{}']]);
    expect(fake.calls('or')).toEqual([['status.in.(overdue)']]);
  });

  it('a page past the end returns the LAST page instead of an error', async () => {
    const page = await runList(SPEC, parse('page=9&pageSize=50'));
    expect(page).toMatchObject({ page: 3, total: 120, pageSize: 50 });
    expect(page.rows).toHaveLength(20);
    expect(fake.queries).toHaveLength(3); // the failed range, a one-row probe for the total, the last page
  });

  it('an empty result is page 1 with no rows (not an error)', async () => {
    setup([]);
    expect(await runList(SPEC, parse('page=4'))).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
  });

  it('"all" (Excel export) reads every matching row in pages of 1000', async () => {
    setup(rows(2300));
    const result = await runList(SPEC, parse('pageSize=all'));
    expect(result.rows).toHaveLength(2300);
    expect(result).toMatchObject({ total: 2300, page: 1, pageSize: 2300 });
    expect(fake.queries.map((q) => q.calls.find(([n]) => n === 'range')![1])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('a database error is mapped, not leaked', async () => {
    m.from.mockImplementation(() => ({ select: () => ({ order: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, count: null, error: { code: '42P01', message: 'relation "x" does not exist' } }) }) }) }) }));
    await expect(runList(SPEC, parse(''))).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });
});
