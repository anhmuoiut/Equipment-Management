import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * Service Calibration (sub-equipment + các lần hiệu chuẩn) với database giả. Calibration Status và due_date do database tính
 * (view sub_equipment_calibration, trigger calibration_compute_due) — kiểm tra service đọc đúng và ghi đúng, không tính lại.
 */
const m = vi.hoisted(() => ({ appWrite: vi.fn(), selectAll: vi.fn(), selectIn: vi.fn(), selectOne: vi.fn(), from: vi.fn() }));
vi.mock('./core/db', () => ({
  appWrite: m.appWrite, selectAll: m.selectAll, selectIn: m.selectIn, selectOne: m.selectOne, db: () => ({ from: m.from }),
}));
const assets = vi.hoisted(() => ({ applyTreeEdit: vi.fn(), previewTreeEdit: vi.fn(), assetLog: vi.fn() }));
vi.mock('./core/assets', () => assets);
vi.mock('./core/lookups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/lookups')>()),
  loadLookups: async () => (await import('./testing/fixtures')).makeLookups(),
}));

import { chain } from './testing/chain';
import { AppError } from '@/lib/errors';
import {
  addCalibration, createSubEquipment, deleteCalibration, getSubEquipment, listCalibrations, listSubEquipment, subEquipmentHistory,
  updateCalibration, updateSubEquipment,
} from './calibration';

const audit = { created_at: '2026-10-01T00:00:00Z', created_by: 'u1', updated_at: '2026-10-01T00:00:00Z', updated_by: null };
const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1', jabil_id: null, part_number_id: 'pn-4', serial_number: 'DMM-1', asset: null, type_id: 'type-3', tester_id: 'tester',
  tester: { serial_number: 'TESTER-01' } as { serial_number: string } | null, location_id: 'loc-0', usage: 'in_use', remark: null, tag_ids: [] as string[], ...audit, ...over,
});
const status = (over: Record<string, unknown> = {}) => ({
  sub_equipment_id: 's1', calibration_id: 'c1', calibrated_at: '2026-01-01', due_date: '2027-01-01', vendor_id: 'vendor-0',
  cert_no: 'C-1', cert_file_url: null, result: 'pass', interval_months: 12, warning_days: 30, status: 'valid', ...over,
});
const record = (over: Record<string, unknown> = {}) => ({
  id: 'c1', sub_equipment_id: 's1', calibrated_at: '2026-01-01', due_date: '2027-01-01', vendor_id: 'vendor-0', cert_no: null,
  cert_file_url: null, result: 'pass', remark: null, ...audit, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.selectOne.mockImplementation(async (table: string) => (table === 'equipment' ? { serial_number: 'TESTER-01' } : sub()));
  m.appWrite.mockResolvedValue({ id: 's1' });
  m.from.mockImplementation((table: string) => chain({
    data: table === 'sub_equipment_calibration' ? status() : [record()],
  }).proxy);
});

describe('rows', () => {
  it('lists every sub-equipment with its latest calibration and Calibration Status; no calibration yet = not_calibrated', async () => {
    m.selectAll.mockImplementation(async (table: string) => (table === 'sub_equipment'
      ? [sub(), sub({ id: 's2', serial_number: 'DMM-2', tester_id: null, tester: null, location_id: 'loc-1' })]
      : [status()]));
    const rows = await listSubEquipment();
    // The tester's serial comes in the same query (embedded) — no second round trip to read the testers.
    expect(m.selectAll).toHaveBeenCalledWith('sub_equipment', expect.stringContaining('tester:tester_id(serial_number)'));
    expect(m.selectIn).not.toHaveBeenCalled();
    expect(m.selectAll).toHaveBeenCalledWith('sub_equipment_calibration', '*', 'sub_equipment_id');
    expect(rows[0]).toMatchObject({
      serial_number: 'DMM-1', part_number: 'DMM-100', type: 'DMM', manufacturer: 'Keysight', tester_serial: 'TESTER-01', location: 'B3F1', usage: 'in_use',
      status: 'valid', calibrated_at: '2026-01-01', due_date: '2027-01-01', result: 'pass', vendor: 'Acme', cert_no: 'C-1', interval_months: 12,
    });
    expect(rows[1]).toMatchObject({
      serial_number: 'DMM-2', tester_serial: null, status: 'not_calibrated', calibration_id: null, due_date: null, result: null, vendor: null,
    });
  });

  it('a single sub-equipment reads its status row and its tester; unknown id is NOT_FOUND', async () => {
    expect(await getSubEquipment('s1')).toMatchObject({ tester_serial: 'TESTER-01', status: 'valid' });
    expect(m.selectOne).toHaveBeenCalledTimes(1); // one query for the row AND its tester
    expect(m.selectOne).toHaveBeenCalledWith('sub_equipment', 's1', expect.stringContaining('tester:tester_id(serial_number)'));
    m.selectOne.mockResolvedValue(null);
    await expect(getSubEquipment('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('carries the status the database computed, whatever it is (failed, overdue, due_soon)', async () => {
    for (const s of ['failed', 'overdue', 'due_soon'] as const) {
      m.from.mockImplementation(() => chain({ data: status({ status: s }) }).proxy);
      expect((await getSubEquipment('s1')).status).toBe(s);
    }
  });
});

describe('createSubEquipment / updateSubEquipment', () => {
  it('a sub-equipment inside a tester is saved without a location — the database takes the tester\'s', async () => {
    await createSubEquipment({ serial_number: 'DMM-9', part_number_id: 'pn-4', tester_id: 'tester', location_id: 'loc-1' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('sub_equipment', 'insert', null, { serial_number: 'DMM-9', part_number_id: 'pn-4', tester_id: 'tester' }, 'u1');
  });

  it('a loose one needs its own location; serial and part number are required; hidden values are refused', async () => {
    await createSubEquipment({ serial_number: 'DMM-9', part_number_id: 'pn-4', location_id: 'loc-1' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('sub_equipment', 'insert', null, { serial_number: 'DMM-9', part_number_id: 'pn-4', location_id: 'loc-1' }, 'u1');
    m.appWrite.mockClear();
    await expect(createSubEquipment({ part_number_id: 'pn-4', location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ details: { fields: { serial_number: 'required' } } });
    await expect(createSubEquipment({ serial_number: 'S', location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ details: { fields: { part_number_id: 'required' } } });
    await expect(createSubEquipment({ serial_number: 'S', part_number_id: 'pn-4' }, 'u1')).rejects.toMatchObject({ details: { fields: { location_id: 'required' } } });
    await expect(createSubEquipment({ serial_number: 'S', part_number_id: 'pn-5', location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    await expect(createSubEquipment({ serial_number: 'S', part_number_id: 'pn-4', location_id: 'loc-1', tag_ids: ['x'] }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });

  it('a new tester: dry run first, then the fields, then the real Move; a sent location is ignored', async () => {
    await updateSubEquipment('s1', { tester_id: 'other', location_id: 'loc-1', remark: 'r' }, 'u1');
    expect(assets.previewTreeEdit).toHaveBeenCalledWith('sub_equipment', 's1', { parentTo: 'other', location: undefined }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('sub_equipment', 'update', 's1', { remark: 'r' }, 'u1');
    expect(assets.applyTreeEdit).toHaveBeenCalledWith('sub_equipment', 's1', { parentTo: 'other', location: undefined }, 'u1');
    expect(assets.previewTreeEdit.mock.invocationCallOrder[0]).toBeLessThan(m.appWrite.mock.invocationCallOrder[0]!);
    expect(m.appWrite.mock.invocationCallOrder[0]).toBeLessThan(assets.applyTreeEdit.mock.invocationCallOrder[0]!);
  });

  it('clearing the tester detaches and then applies the new location', async () => {
    await updateSubEquipment('s1', { tester_id: null, location_id: 'loc-1' }, 'u1');
    expect(assets.applyTreeEdit).toHaveBeenCalledWith('sub_equipment', 's1', { parentTo: null, location: 'loc-1' }, 'u1');
  });

  it('writes nothing when the database refuses in the dry run; a sub-equipment keeping its tester cannot change location', async () => {
    assets.previewTreeEdit.mockRejectedValueOnce(new AppError('PARENT_TYPE_INVALID'));
    await expect(updateSubEquipment('s1', { tester_id: 'bad', remark: 'r' }, 'u1')).rejects.toMatchObject({ code: 'PARENT_TYPE_INVALID' });
    expect(m.appWrite).not.toHaveBeenCalled();
    await expect(updateSubEquipment('s1', { location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ code: 'LOCATION_INHERITED_READ_ONLY' });
    m.selectOne.mockResolvedValue(null);
    await expect(updateSubEquipment('nope', { remark: 'r' }, 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('lần hiệu chuẩn', () => {
  it('lists the calibrations of one sub-equipment, newest first, with vendor names', async () => {
    const [first] = await listCalibrations('s1');
    expect(first).toMatchObject({ id: 'c1', calibrated_at: '2026-01-01', due_date: '2027-01-01', vendor: 'Acme', result: 'pass' });
    m.selectOne.mockResolvedValue(null);
    await expect(listCalibrations('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('recording a calibration inserts ONE new row for the sub-equipment — the due date is the database\'s job', async () => {
    m.appWrite.mockResolvedValue(record({ id: 'c2' }));
    const result = await addCalibration('s1', { calibrated_at: '2026-10-08', vendor_id: 'vendor-0', result: 'fail', cert_no: 'C-2' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('calibrations', 'insert', null,
      { calibrated_at: '2026-10-08', vendor_id: 'vendor-0', result: 'fail', cert_no: 'C-2', sub_equipment_id: 's1' }, 'u1');
    expect(result.record).toMatchObject({ id: 'c2', vendor: 'Acme' });
    expect(result.sub_equipment).toMatchObject({ id: 's1', status: 'valid' });
  });

  it('needs a calibration date, an existing sub-equipment and a vendor that is still in use', async () => {
    await expect(addCalibration('s1', {}, 'u1')).rejects.toMatchObject({ details: { fields: { calibrated_at: 'required' } } });
    await expect(addCalibration('s1', { calibrated_at: '2026-10-08', vendor_id: 'vendor-1' }, 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    m.selectOne.mockResolvedValue(null);
    await expect(addCalibration('nope', { calibrated_at: '2026-10-08' }, 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });

  it('the database error for a part number without Setup and no due date is passed on', async () => {
    m.appWrite.mockRejectedValue(new AppError('CALIBRATION_INTERVAL_MISSING'));
    await expect(addCalibration('s1', { calibrated_at: '2026-10-08' }, 'u1')).rejects.toMatchObject({ code: 'CALIBRATION_INTERVAL_MISSING' });
  });

  it('editing a wrong entry writes only the changed fields; a vendor that was hidden since may stay', async () => {
    m.selectOne.mockResolvedValue(record({ vendor_id: 'vendor-1' }));
    m.appWrite.mockResolvedValue(record({ vendor_id: 'vendor-1', remark: 'fixed' }));
    const result = await updateCalibration('c1', { vendor_id: 'vendor-1', remark: 'fixed' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('calibrations', 'update', 'c1', { vendor_id: 'vendor-1', remark: 'fixed' }, 'u1');
    expect(result.record.remark).toBe('fixed');
    await expect(updateCalibration('c1', { vendor_id: 'gone' }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('deleting a calibration removes the row and returns the sub-equipment with its new status', async () => {
    m.selectOne.mockImplementation(async (table: string) => (table === 'calibrations' ? { id: 'c1', sub_equipment_id: 's1' } : sub()));
    const result = await deleteCalibration('c1', 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('calibrations', 'delete', 'c1', null, 'u1');
    expect(result.sub_equipment.id).toBe('s1');
    m.selectOne.mockResolvedValue(null);
    await expect(deleteCalibration('nope', 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Lịch sử', () => {
  it('reads asset_logs of the sub-equipment, optionally only the calibration actions', async () => {
    await subEquipmentHistory('s1');
    await subEquipmentHistory('s1', true);
    expect(assets.assetLog.mock.calls).toEqual([
      ['sub_equipment', 's1', undefined],
      ['sub_equipment', 's1', ['CALIBRATE', 'CALIBRATION_UPDATE', 'CALIBRATION_REMOVE']],
    ]);
  });
});
