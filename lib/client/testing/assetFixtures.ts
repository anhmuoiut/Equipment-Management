/**
 * Dữ liệu mẫu cho test giao diện của ba module tài sản và Overview: một cây nhỏ (TESTER-01 ⊃ BASE-01 ⊃ FIXTURE-01,
 * sub-equipment DMM-1 / DMM-2, golden board GB-1) + danh sách chọn + bảng thẻ của Overview.
 */
import type {
  EquipmentRow, EquipmentTree, GoldenRow, OverviewBoard, OverviewCard, OverviewColumn, Options, SubEquipmentRow, TreeNode,
} from '@/lib/types';

export const audit = {
  created_at: '2026-10-01T01:00:00Z', created_by: 'u1', created_by_name: 'Admin',
  updated_at: '2026-10-01T02:00:00Z', updated_by: 'u1', updated_by_name: 'Admin',
};

const opt = (id: string, name: string, active = true) => ({ id, display_name: name, sort_order: 0, is_active: active });

export const options: Options = {
  part_numbers: [
    { ...opt('pn-t', 'P12316'), type_id: 't-tester', kind: 'tester', level_id: null, manufacturer: null, description: null },
    // P20001 carries the Level "EOL": the Add equipment form offers it.
    { ...opt('pn-b', 'P20001'), type_id: 't-base', kind: 'base', level_id: 'lv1', manufacturer: null, description: 'Base fixture assembly' },
    { ...opt('pn-f', 'P30005'), type_id: 't-fixture', kind: 'fixture', level_id: null, manufacturer: null, description: null },
    { ...opt('pn-s', 'DMM-100'), type_id: 't-dmm', kind: 'sub_equipment', level_id: null, manufacturer: 'Keysight', description: 'Digital multimeter' },
  ],
  locations: [opt('l1', 'B3F1'), opt('l2', 'B3F2')],
  types: [
    { ...opt('t-tester', 'Tester'), kind: 'tester', group_id: 'g-tester' }, { ...opt('t-base', 'Base'), kind: 'base', group_id: 'g-base' },
    { ...opt('t-fixture', 'Fixture'), kind: 'fixture', group_id: 'g-fixture' }, { ...opt('t-dmm', 'DMM'), kind: 'sub_equipment', group_id: 'g-sub' },
  ],
  type_groups: [
    { ...opt('g-tester', 'Tester'), kind: 'tester' }, { ...opt('g-base', 'Base'), kind: 'base' },
    { ...opt('g-fixture', 'Fixture'), kind: 'fixture' }, { ...opt('g-sub', 'Sub-equipment'), kind: 'sub_equipment' },
  ],
  levels: [opt('lv1', 'EOL')], departments: [opt('d1', 'TE')], calibration_vendors: [opt('v1', 'Internal')],
  tags: [{ id: 'tg1', display_name: 'Spare', sort_order: 1, color: 'gray' }],
};

export const equipment = (over: Partial<EquipmentRow> & { id: string; serial_number: string }): EquipmentRow => ({
  jabil_id: null, part_number_id: 'pn-b', part_number: 'P20001', asset: null, type_id: 't-base', type: 'Base', kind: 'base',
  usage: 'not_in_use', level_id: null, level: null, location_id: 'l1', location: 'B3F1', remark: null, tag_ids: [], tags: [],
  parent_id: null, parent_serial: null, has_children: false, ...audit, ...over,
});

export const tester = equipment({
  id: 'e-tester', serial_number: 'TESTER-01', part_number_id: 'pn-t', part_number: 'P12316', type_id: 't-tester', type: 'Tester', kind: 'tester',
  usage: 'in_use', has_children: true,
});
export const base = equipment({
  id: 'e-base', serial_number: 'BASE-01', usage: 'in_use', parent_id: 'e-tester', parent_serial: 'TESTER-01', has_children: true,
});
export const fixture = equipment({
  id: 'e-fixture', serial_number: 'FIXTURE-01', part_number_id: 'pn-f', part_number: 'P30005', type_id: 't-fixture', type: 'Fixture', kind: 'fixture',
  usage: 'in_use', parent_id: 'e-base', parent_serial: 'BASE-01', has_children: true,
});
export const spare = equipment({ id: 'e-spare', serial_number: 'BASE-02', location: 'B3F2', location_id: 'l2' });
export const equipmentRows = [tester, base, fixture, spare];

export const sub = (over: Partial<SubEquipmentRow> & { id: string; serial_number: string }): SubEquipmentRow => ({
  jabil_id: null, part_number_id: 'pn-s', part_number: 'DMM-100', asset: null, type_id: 't-dmm', type: 'DMM', manufacturer: 'Keysight', description: 'Digital multimeter',
  tester_id: 'e-tester', tester_serial: 'TESTER-01', location_id: 'l1', location: 'B3F1', usage: 'in_use', remark: null, tag_ids: [], tags: [],
  status: 'valid', calibration_id: 'c1', calibrated_at: '2026-06-01', due_date: '2027-06-01', result: 'pass', vendor_id: 'v1', vendor: 'Internal',
  cert_no: 'C-1', cert_file_url: null, interval_months: 12, warning_days: 30, ...audit, ...over,
});
export const dmm1 = sub({ id: 's1', serial_number: 'DMM-1' });
export const dmm2 = sub({ id: 's2', serial_number: 'DMM-2', status: 'overdue', due_date: '2026-09-01' });
export const dmmNew = sub({
  id: 's3', serial_number: 'DMM-3', status: 'not_calibrated', calibration_id: null, calibrated_at: null, due_date: null, result: null,
  vendor_id: null, vendor: null, cert_no: null, tester_id: null, tester_serial: null, usage: 'not_in_use',
  // Part number chưa có Setup hiệu chuẩn: không có chu kỳ.
  interval_months: null, warning_days: null,
});
export const subRows = [dmm1, dmm2, dmmNew];

export const golden = (over: Partial<GoldenRow> & { id: string; serial_number: string }): GoldenRow => ({
  part_number: 'PCBA-7781', utd_part_number: 'UTD-7781', origin: null, purpose: 'ICT check', parent_id: 'e-fixture', parent_serial: 'FIXTURE-01',
  location_id: 'l1', location: 'B3F1', usage: 'in_use', remark: null, tag_ids: [], tags: [], ...audit, ...over,
});
export const gb1 = golden({ id: 'g1', serial_number: 'GB-1' });
export const gbFree = golden({ id: 'g2', serial_number: 'GB-2', parent_id: null, parent_serial: null, usage: 'not_in_use' });
export const goldenRows = [gb1, gbFree];

export const treeNodes: TreeNode[] = [
  { asset_type: 'equipment', id: 'e-tester', kind: 'tester', type_name: 'Tester', usage: 'in_use', cal_status: null, parent_id: null, part_number: 'P12316', serial_number: 'TESTER-01' },
  { asset_type: 'equipment', id: 'e-base', kind: 'base', type_name: 'Base', usage: 'in_use', cal_status: null, parent_id: 'e-tester', part_number: 'P20001', serial_number: 'BASE-01' },
  { asset_type: 'equipment', id: 'e-fixture', kind: 'fixture', type_name: 'Fixture', usage: 'in_use', cal_status: null, parent_id: 'e-base', part_number: 'P30005', serial_number: 'FIXTURE-01' },
  { asset_type: 'sub_equipment', id: 's1', kind: 'sub_equipment', type_name: 'DMM', usage: 'in_use', cal_status: 'valid', parent_id: 'e-tester', part_number: 'DMM-100', serial_number: 'DMM-1' },
  { asset_type: 'sub_equipment', id: 's2', kind: 'sub_equipment', type_name: 'DMM', usage: 'in_use', cal_status: 'overdue', parent_id: 'e-tester', part_number: 'DMM-100', serial_number: 'DMM-2' },
  { asset_type: 'golden_board', id: 'g1', kind: 'golden_board', type_name: null, usage: 'in_use', cal_status: null, parent_id: 'e-fixture', part_number: 'PCBA-7781', serial_number: 'GB-1' },
];
/** Đúng dạng `GET /api/equipment/{id}/tree` (kiểu dùng chung với service): không phải mảng trần. */
export const treeResponse: EquipmentTree = { root_id: 'e-tester', nodes: treeNodes };

// ------------------------------------------------------------------ Overview: bảng thẻ (đúng dạng `GET /api/overview`)
export const card = (over: Partial<OverviewCard> & { id: string; serial_number: string }): OverviewCard => ({
  asset_type: 'equipment', kind: 'base', type_name: 'Base', part_number: 'P20001', usage: 'not_in_use', cal_alert: null, parent_id: null, depth: 0, matched: false, ...over,
});
/** Cột TESTER-01: tối đa 3 thẻ — thẻ gốc, BASE-01 và DMM-2 (quá hạn, được chọn trước vì có cảnh báo); còn lại "+4 thiết bị". */
export const testerColumn: OverviewColumn = {
  root_id: 'e-tester', more: 4, alerts: 1,
  cards: [
    card({ id: 'e-tester', serial_number: 'TESTER-01', kind: 'tester', type_name: 'Tester', part_number: 'P12316', usage: 'in_use', cal_alert: 'overdue' }),
    card({ id: 'e-base', serial_number: 'BASE-01', parent_id: 'e-tester', depth: 1, usage: 'in_use' }),
    card({ id: 's2', serial_number: 'DMM-2', asset_type: 'sub_equipment', kind: 'sub_equipment', type_name: 'DMM', part_number: 'DMM-100', parent_id: 'e-tester', depth: 1, usage: 'in_use', cal_alert: 'overdue' }),
  ],
};
/** Tài sản chưa gắn: một cột một thẻ. */
export const looseColumn: OverviewColumn = { root_id: 'e-spare', more: 0, alerts: 0, cards: [card({ id: 'e-spare', serial_number: 'BASE-02' })] };
export const boardResponse: OverviewBoard = {
  sections: [
    { location_id: 'l1', location: 'B3F1', columns: [testerColumn, looseColumn], testers: 1, in_use: 1, alerts: 1, worst: 'overdue' },
    {
      location_id: 'l2', location: 'B3F2', testers: 1, in_use: 0, alerts: 0, worst: null,
      columns: [{ root_id: 'e-t9', more: 0, alerts: 0, cards: [card({ id: 'e-t9', serial_number: 'TESTER-09', kind: 'tester', type_name: 'Tester', part_number: 'P12316' })] }],
    },
  ],
};
