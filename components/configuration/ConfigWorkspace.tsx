'use client';

/**
 * Một danh sách của Configuration (Part Number, Location, …): Masterlist +
 * modal bản ghi như mọi module (docs/UI.md). Chỉ Admin.
 * Bảng có is_active: "Xóa" = Ẩn / Hiện lại. Tag (thẻ chọn trong Remark), Hiệu chuẩn › Setup: xóa thật.
 * Part Number: Type bắt buộc — thiết bị mang part number tự lấy Type đó (database); đổi Type chỉ được khi chưa thiết bị nào
 * dùng part number (PART_NUMBER_IN_USE). Level không bắt buộc (chọn trong Configuration › Level; form Thêm thiết bị điền sẵn).
 * Types: Group bắt buộc, chọn trong Configuration › Group; 3 loại hệ thống (Tester, Base, Fixture) không ẩn / xóa / đổi Group.
 * Group (type-groups): Admin tự thêm / sửa / ẩn; 3 nhóm hệ thống cùng tên 3 loại hệ thống khóa như chúng.
 * Setup hiệu chuẩn: part number loại sub_equipment + chu kỳ + báo trước; due_date của lần hiệu chuẩn tự tính theo chu kỳ.
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/client/api';
import { refreshOptions, toSelect, useOptions } from '@/lib/client/options';
import { toast } from '@/components/ui';
import { configList } from '@/lib/configuration';
import { manualTagColor } from '@/lib/status';
import { StatusTag, ToneTag } from '@/components/ui/tags';
import { ManualTagColorPicker } from '@/components/ui/TagPicker';
import { RecordModal, type ActionDef } from '@/components/ui/record/RecordModal';
import type { SectionDef } from '@/components/ui/record/fields';
import { ModuleWorkspace, useList } from '@/components/ui/workspace/ModuleWorkspace';
import type { Column } from '@/components/ui/masterlist/Masterlist';
import type { ConfigList, ConfigRow, StatusColor } from '@/lib/types';

export function ConfigWorkspace({ listKey }: { listKey: ConfigList }) {
  const { t } = useTranslation();
  const def = configList(listKey)!;
  const options = useOptions();
  const list = useList<ConfigRow>(`/api/configuration/${listKey}`);
  const listName = t(`cfg.list.${listKey}`);
  const colorLabel = useCallback((c: StatusColor | undefined, name: string | null = null) => (c ? t(`cfg.tagPalette.${manualTagColor(name, c)}`) : null), [t]);
  /** Chip màu: tag trạng thái tô đúng màu, chữ là tên màu. */
  const colorChip = useCallback((c: StatusColor | undefined, name: string | null = null) => (c ? <StatusTag name={colorLabel(c, name)} color={manualTagColor(name, c)} /> : null), [colorLabel]);

  // Hiệu chuẩn › Setup: part number chọn trong các PN loại sub_equipment, mỗi PN một dòng (bỏ PN đã có, trừ dòng đang xem).
  const taken = new Set(list.rows.map((r) => r.part_number_id));
  const partNumberChoices = (current: string | undefined) => toSelect(
    options?.part_numbers.filter((pn) => pn.id === current || (pn.kind === 'sub_equipment' && !taken.has(pn.id))),
    current, ` (${t('cfg.hidden')})`);

  // useMemo: Masterlist memo theo identity của columns (xem EquipmentWorkspace). `def` là object cố định trong CONFIG_LISTS.
  const columns = useMemo<Column<ConfigRow>[]>(() => (def.isCalibration ? [
    { key: 'display_name', label: t('fields.part_number'), value: (r) => r.display_name, render: (r) => <strong>{r.display_name}</strong> },
    { key: 'interval_months', label: t('fields.interval_months'), value: (r) => r.interval_months ?? null },
    { key: 'warning_days', label: t('fields.warning_days'), value: (r) => r.warning_days ?? null },
  ] : def.isTag ? [
    { key: 'display_name', label: t('fields.display_name'), value: (r) => r.display_name, render: (r) => <strong>{r.display_name}</strong> },
    { key: 'color', label: t('fields.color'), value: (r) => colorLabel(r.color, r.display_name), render: (r) => colorChip(r.color, r.display_name), filter: true },
    { key: 'sort_order', label: t('fields.sort_order'), value: (r) => r.sort_order },
  ] : [
    { key: 'display_name', label: t('fields.display_name'), value: (r) => r.display_name, render: (r) => <strong>{r.display_name}</strong> },
    ...(def.hasType ? [
      { key: 'type', label: t('fields.type'), value: (r: ConfigRow) => r.type ?? null, filter: true },
    ] : []),
    ...(def.hasManufacturer ? [{ key: 'manufacturer', label: t('fields.manufacturer'), value: (r: ConfigRow) => r.manufacturer ?? null, filter: true }] : []),
    ...(def.hasLevel ? [{ key: 'level', label: t('fields.level'), value: (r: ConfigRow) => r.level ?? null, filter: true }] : []),
    ...(def.hasGroup ? [{ key: 'group', label: t('fields.group'), value: (r: ConfigRow) => r.group ?? null, filter: true }] : []),
    ...(def.hasDescription ? [{ key: 'description', label: t('fields.description'), value: (r: ConfigRow) => r.description ?? null, wrap: true, width: 200 }] : []),
    { key: 'sort_order', label: t('fields.sort_order'), value: (r) => r.sort_order },
    { key: 'is_active', label: t('fields.is_active'), value: (r) => (r.is_active ? t('cfg.active') : t('cfg.hidden')),
      render: (r) => <ToneTag text={r.is_active ? t('cfg.active') : t('cfg.hidden')} tone={r.is_active ? 'ok' : 'neutral'} />, filter: true },
  ]), [t, def, colorLabel, colorChip]);

  const sections: SectionDef<ConfigRow>[] = [{
    key: 'info', title: t('cfg.groupInfo'),
    fields: def.isCalibration ? [
      { key: 'part_number_id', label: t('fields.part_number'), kind: 'select', required: true, view: (r) => r.display_name,
        options: (_d, r) => partNumberChoices(r?.part_number_id),
        lock: (r) => (r ? t('cfg.partNumberFixed') : null) },
      { key: 'interval_months', label: t('fields.interval_months'), kind: 'number', required: true, min: 1, max: 600,
        view: (r) => t('cal.months', { count: r.interval_months ?? 0 }) },
      { key: 'warning_days', label: t('fields.warning_days'), kind: 'number', required: true, min: 1, max: 3650,
        view: (r) => t('cal.days', { count: r.warning_days ?? 0 }) },
    ] : def.isTag ? [
      { key: 'display_name', label: t('fields.display_name'), required: true, maxLength: 100 },
      { key: 'sort_order', label: t('fields.sort_order'), kind: 'number', required: true, min: 0 },
      { key: 'color', label: t('fields.color'), required: true,
        editor: ({ id, value, onChange, label }) => <ManualTagColorPicker id={id} value={value} onChange={onChange} label={label} />,
        view: (r) => colorChip(r.color, r.display_name) },
    ] : [
      { key: 'display_name', label: t('fields.display_name'), required: true, maxLength: 200 },
      // Part Number → Type: equipment with this part number always gets this Type (the database keeps them in step).
      ...(def.hasType ? [{ key: 'type_id', label: t('fields.type'), kind: 'select' as const, required: true, view: (r: ConfigRow) => r.type,
        options: (_d: unknown, r: ConfigRow | null) => toSelect(options?.types, r?.type_id, ` (${t('cfg.hidden')})`) }] : []),
      // Part Number → Manufacturer (không bắt buộc): chữ tự do, tối đa 200 ký tự.
      ...(def.hasManufacturer ? [{ key: 'manufacturer', label: t('fields.manufacturer'), kind: 'text' as const, maxLength: 200 }] : []),
      // Part Number → Level (không bắt buộc): Level đang dùng; Level đã ẩn mà part number đang giữ thì vẫn hiện.
      ...(def.hasLevel ? [{ key: 'level_id', label: t('fields.level'), kind: 'select' as const, view: (r: ConfigRow) => r.level,
        options: (_d: unknown, r: ConfigRow | null) => toSelect(options?.levels, r?.level_id, ` (${t('cfg.hidden')})`) }] : []),
      // Types → Group (bắt buộc): chỉ các nhóm sub_equipment đang dùng; 3 Type hệ thống giữ nhóm hệ thống của chúng.
      ...(def.hasGroup ? [{ key: 'group_id', label: t('fields.group'), kind: 'select' as const, required: true, view: (r: ConfigRow) => r.group,
        options: (_d: unknown, r: ConfigRow | null) => toSelect(
          options?.type_groups.filter((g) => g.kind === 'sub_equipment' || g.id === r?.group_id), r?.group_id, ` (${t('cfg.hidden')})`),
        lock: (r: ConfigRow | null) => (r && r.kind !== 'sub_equipment' ? t('cfg.groupLocked') : null) }] : []),
      ...(def.hasDescription ? [{ key: 'description', label: t('fields.description'), kind: 'textarea' as const, wide: true, maxLength: 1000 }] : []),
      { key: 'sort_order', label: t('fields.sort_order'), kind: 'number', required: true, min: 0 },
      { key: 'is_active', label: t('fields.is_active'), kind: 'boolean',
        // 3 loại hệ thống (Tester, Base, Fixture) và 3 nhóm hệ thống cùng tên không ẩn được.
        lock: (r) => ((def.hasGroup || def.isTypeGroup) && r && r.kind !== 'sub_equipment' ? t(def.isTypeGroup ? 'cfg.systemGroupLocked' : 'cfg.systemTypeLocked') : null),
        view: (r) => <ToneTag text={r.is_active ? t('cfg.active') : t('cfg.hidden')} tone={r.is_active ? 'ok' : 'neutral'} /> },
    ],
  }];

  const defaults = def.isCalibration ? { warning_days: 30 } : def.isTag
    ? { sort_order: 0 }
    : { sort_order: 0, is_active: true };

  // Dữ liệu gốc vừa đổi → mọi form cần danh sách chọn mới. Thay đổi đã lưu; chỉ báo nếu chưa tải lại được.
  const refresh = () => { refreshOptions().catch(() => toast.warning(t('cfg.optionsStale'))); };

  // 3 loại hệ thống của Types (Tester, Base, Fixture) và 3 nhóm hệ thống của Group không ẩn được.
  const isSystemType = (r: ConfigRow) => (def.hasGroup || def.isTypeGroup) && r.kind !== undefined && r.kind !== 'sub_equipment';
  const actions: ActionDef<ConfigRow>[] = def.hideable ? [{
    key: 'toggle', label: t('cfg.hide'), icon: <EyeOff size={14} aria-hidden="true" />, visible: (r) => r.is_active && !isSystemType(r),
    runMessage: t('cfg.hiddenDone'),
    run: async (r) => (await api.put<ConfigRow>(`/api/configuration/${listKey}/${r.id}`, { is_active: false })).data,
  }, {
    key: 'show', label: t('cfg.show'), icon: <Eye size={14} aria-hidden="true" />, visible: (r) => !r.is_active,
    runMessage: t('cfg.shownDone'),
    run: async (r) => (await api.put<ConfigRow>(`/api/configuration/${listKey}/${r.id}`, { is_active: true })).data,
  }] : [];

  return (
    <ModuleWorkspace<ConfigRow>
      title={listName}
      list={list}
      columns={columns}
      storageKey={`configuration-${listKey}`}
      exportName={listKey}
      canAdd
      addLabel={t('ml.add')}
      recordUrl={(id) => `/api/configuration/${listKey}/${id}`}
      renderDetail={(ctx) => (
        <RecordModal<ConfigRow>
          {...ctx}
          size="l"
          createTitle={t('cfg.addTitle', { list: listName })}
          heading={(r) => ({
            title: r.display_name,
            tags: <>
              {def.isTag && <StatusTag name={r.display_name} color={r.color} />}
              {def.hideable && <ToneTag text={r.is_active ? t('cfg.active') : t('cfg.hidden')} tone={r.is_active ? 'ok' : 'neutral'} />}
              <ToneTag text={listName} tone="info" />
            </>,
          })}
          sections={sections}
          defaults={defaults}
          canEdit
          onSave={async (payload, record) => {
            if (def.isTag) payload = { ...payload, color: manualTagColor(payload.display_name as string, payload.color as StatusColor) };
            const res = record
              ? await api.put<ConfigRow>(`/api/configuration/${listKey}/${record.id}`, payload)
              : await api.post<ConfigRow>(`/api/configuration/${listKey}`, payload);
            return { row: res.data };
          }}
          actions={actions}
          canDelete={def.deletable}
          deleteWarning={def.isCalibration ? (r) => t('cfg.calibrationDeleteWarning', { name: r.display_name }) : undefined}
          onDelete={async (r) => { await api.delete(`/api/configuration/${listKey}/${r.id}`); refresh(); }}
          // Lưu và Ẩn / Hiện đều qua đây — tải lại danh sách chọn một lần.
          onSaved={(row, created, open) => { refresh(); ctx.onSaved(row, created, open); }}
        />
      )}
    />
  );
}
