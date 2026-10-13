'use client';

/**
 * Modal Equipment — Tester, Base, Fixture (docs/DETAIL_MODEL.md 4.1). Dùng khung RecordModal; riêng module này:
 * nhóm trường, quan hệ cha – con (dòng SN · Type bấm để mở), nhóm Hiệu chuẩn chỉ đọc của Tester (từ module Calibration),
 * tab Cây thiết bị, cảnh báo serial trùng trước khi lưu. Overview dùng lại đúng component này.
 */
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus } from 'lucide-react';
import { api, formatRelativeTime } from '@/lib/client/api';
import { useFetch } from '@/lib/client/useFetch';
import { usePhone } from '@/lib/client/usePhone';
import { toSelect, useOptions } from '@/lib/client/options';
import { parentAllowed } from '@/lib/assetTree';
import { useCan } from '@/components/ViewerContext';
import { TagChips, UsageTag } from '@/components/ui/tags';
import { TagPicker } from '@/components/ui/TagPicker';
import { RecordModal, type ActionDef } from '@/components/ui/record/RecordModal';
import { DetailValue, type Draft, type SectionDef } from '@/components/ui/record/fields';
import type { DetailCtx } from '@/components/ui/workspace/ModuleWorkspace';
import { assetActions } from '@/components/assets/actions';
import { fetchSerialMatches } from '@/components/assets/api';
import { ParentPicker } from '@/components/assets/pickers';
import { ActionLink, ParentRelation, RelationChip, RelationList, useOpenAsset } from '@/components/assets/Relations';
import { SerialWarning } from '@/components/assets/SerialWarning';
import { TreeTab } from '@/components/assets/TreeTab';
import type { EquipmentKind, EquipmentRow, EquipmentTree, ParentCandidate, TreeNode } from '@/lib/types';

export function EquipmentModal({ ctx, initialTab }: {
  ctx: DetailCtx<EquipmentRow>;
  /** Tab mở sẵn (Overview: `tree`). */
  initialTab?: string;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const router = useRouter();
  const options = useOptions();
  const can = useCan();
  const hidden = ` (${t('cfg.hidden')})`;
  const record = ctx.creating ? null : ctx.record;
  const phone = usePhone();
  // Desktop tree/detail is one workspace: selecting a node replaces the current record.
  const openAsset = useOpenAsset('equipment', (id) => record && ctx.open(id, record.serial_number, { trackTrail: phone }));

  // "Thêm thiết bị con": cha cố định (Thao tác › Thêm thiết bị con). Chọn cha ở form: vị trí theo cha.
  const fixedParentId = ctx.creating && typeof ctx.defaults?.parent_id === 'string' ? ctx.defaults.parent_id : null;
  const fixedParent = useFetch<EquipmentRow>(fixedParentId ? `/api/equipment/${fixedParentId}` : null).data;
  const [picked, setPicked] = useState<ParentCandidate | null>(null);
  // Cha chọn trong ô: danh sách tìm chỉ có vị trí, nên Level của cha lấy từ chính thiết bị đó.
  const pickedRow = useFetch<EquipmentRow>(picked ? `/api/equipment/${picked.id}` : null).data;

  // Cây chứa thiết bị này: MỘT lần tải cho cả tab Cây thiết bị, chip thiết bị con và nhóm Hiệu chuẩn của Tester.
  // Mở thiết bị khác trong cùng cây thì dùng lại cây đã có (không tải lại); sang cây khác thì chờ cây mới.
  const tree = useFetch<EquipmentTree>(record ? `/api/equipment/${record.id}/tree?_v=${ctx.version}` : null);
  const loaded = record && tree.data?.nodes.some((n) => n.id === record.id) ? tree.data : null;
  // Con trực tiếp (equipment, sub-equipment, golden board); null = đang tải.
  const family = record && loaded ? loaded.nodes.filter((n) => n.parent_id === record.id) : null;
  const relationType = (node: TreeNode) => node.type_name ?? t(`ov.kinds.${node.kind}`);
  // Cây chưa về: đang tải, hoặc tải lỗi (kèm Thử lại) — không để "Đang tải…" mãi khi lỗi.
  const treePending = () => (tree.error && family === null ? (
    <span className="dp-empty">{tree.error} <button type="button" className="link" onClick={tree.reload}>{t('common.retry')}</button></span>
  ) : t('common.loadingEllipsis'));

  const partOption = (id: unknown) => (typeof id === 'string' ? options?.part_numbers.find((p) => p.id === id) : undefined);
  const kindOf = (d: Draft, r: EquipmentRow | null): EquipmentKind | null => {
    const kind = r?.kind ?? partOption(d.part_number_id)?.kind ?? null;
    return kind === 'tester' || kind === 'base' || kind === 'fixture' ? kind : null;
  };
  const typeName = (pnId: unknown) => {
    const typeId = partOption(pnId)?.type_id;
    return typeId ? options?.types.find((x) => x.id === typeId)?.display_name ?? null : null;
  };
  /** Vị trí / Level theo cha đang chọn: cha vừa chọn trong ô, cha cố định, hoặc cha hiện tại của thiết bị. */
  const parentLocation = (d: Draft) => {
    if (!d.parent_id) return null;
    if (picked && picked.id === d.parent_id) return picked.location;
    if (fixedParent && fixedParent.id === d.parent_id) return fixedParent.location;
    return record && d.parent_id === record.parent_id ? record.location : null;
  };
  const parentLevel = (d: Draft) => {
    if (!d.parent_id) return null;
    if (pickedRow && pickedRow.id === d.parent_id) return pickedRow.level;
    if (fixedParent && fixedParent.id === d.parent_id) return fixedParent.level;
    return record && d.parent_id === record.parent_id ? record.level : null;
  };
  const partChoices = (current: string | undefined) => toSelect(
    options?.part_numbers.filter((p) => p.kind !== 'sub_equipment' && (p.id === current || !fixedParent || parentAllowed(p.kind, fixedParent.kind))),
    current, hidden,
  );

  const sections: SectionDef<EquipmentRow>[] = [
    {
      key: 'identity', title: t('eq.groupIdentity'), fields: [
        { key: 'serial_number', label: t('fields.serial_number'), required: true, maxLength: 200 },
        { key: 'part_number_id', label: t('fields.part_number'), kind: 'select', required: true, view: (r) => r.part_number,
          options: (_d, r) => partChoices(r?.part_number_id ?? undefined),
          // Thêm mới: chọn part number thì Level của nó (Configuration › Part Number) được điền sẵn — sửa tay được. Level đã chọn tay
          // (khác Level của part number trước đó) và thiết bị có cha (Level theo cha) thì giữ nguyên.
          afterChange: (value, d, r) => {
            if (r || d.parent_id) return undefined;
            const levelOf = (id: unknown) => partOption(id)?.level_id ?? null;
            const current = (d.level_id as string | null | undefined) ?? null;
            if (current && current !== levelOf(d.part_number_id)) return undefined;
            return { level_id: levelOf(value) };
          } },
        { key: 'jabil_id', label: t('fields.jabil_id'), maxLength: 200 },
        { key: 'asset', label: t('fields.asset'), maxLength: 200 },
      ],
    },
    {
      key: 'classification', title: t('eq.groupClassification'), fields: [
        // Type luôn theo part number: ô chỉ hiển thị, không chọn tay.
        { key: 'type_id', label: t('fields.type'), readOnly: true,
          view: (r) => r.type, draftView: (d) => typeName(d.part_number_id) ?? '—' },
        // Level theo thiết bị cha (database giữ cả cây cùng Level).
        // Level bắt buộc khi không có cha (cùng Location); có cha thì theo cha và ô khóa.
        { key: 'level_id', label: t('fields.level'), kind: 'select', required: (d) => !d.parent_id,
          view: (r) => r.level,
          options: (_d, r) => toSelect(options?.levels, r?.level_id, hidden),
          lock: (_r, d) => (d.parent_id ? t(fixedParentId ? 'eq.followsFixedParent' : 'eq.levelFromParent') : null),
          draftView: (d) => parentLevel(d) },
        // Status không sửa trong form: đổi bằng Check-out / Check-in (và đổi theo chỗ khi Swap, Move, Detach).
        { key: 'usage', label: t('fields.usage'), readOnly: true, hideInCreate: true,
          view: (r) => <UsageTag usage={r.usage} /> },
      ],
    },
    {
      key: 'location', title: t('eq.groupLocationRelation'),
      fields: [
        { key: 'location_id', label: t('fields.location'), kind: 'select', required: (d) => !d.parent_id,
          view: (r) => r.location,
          options: (_d, r) => toSelect(options?.locations, r?.location_id, hidden),
          lock: (_r, d) => (d.parent_id ? t(fixedParentId ? 'eq.followsFixedParent' : 'eq.locationFromParent') : null),
          draftView: (d) => parentLocation(d) },
        { key: 'parent_id', label: t('fields.parent'), wide: true,
          lock: (r, d) => {
            if (fixedParentId) return t('eq.parentFixed', { serial: fixedParent?.serial_number ?? '' });
            const kind = kindOf(d, r);
            if (!r && !kind) return t('asset.pickPartFirst');
            return kind === 'tester' ? t('asset.testerNoParent') : null;
          },
          draftView: (d) => {
            if (!d.parent_id) return <span className="dp-empty">{t('eq.noParent')}</span>;
            const p = picked && picked.id === d.parent_id ? picked : null;
            return p?.serial_number ?? fixedParent?.serial_number ?? record?.parent_serial ?? '—';
          },
          view: (r) => (r.parent_id ? (
            <RelationList key={r.id} empty="">
              {[<ParentRelation key={r.parent_id} id={r.parent_id} serial={r.parent_serial ?? '—'} version={ctx.version}
                typeName={loaded?.nodes.find((node) => node.id === r.parent_id)?.type_name}
                onClick={() => openAsset('equipment', r.parent_id!)} />]}
            </RelationList>
          ) : (
            <>
              <span className="dp-empty">{t('eq.noParent')}</span>
              {can.edit && r.kind !== 'tester' && <> <ActionLink action="attach">{t('eq.attachParent')}</ActionLink></>}
            </>
          )),
          editor: ({ id, value, onChange, label, draft, record: r }) => (
            <ParentPicker type="equipment" assetId={r?.id} kind={kindOf(draft, r)} value={(value as string | null) ?? null}
              valueLabel={r?.parent_serial ?? undefined} onChange={onChange} onPick={setPicked} clearable
              ariaLabel={label} placeholder={t('eq.noParent')} key={id} />
          ) },
      ],
      viewExtra: (r) => {
        const loading = family === null;
        const chip = (n: TreeNode) => (
          <RelationChip key={n.id} serial={n.serial_number} typeName={relationType(n)} status={n.asset_type === 'sub_equipment' ? n.cal_status : null}
            onClick={() => openAsset(n.asset_type, n.id)} />
        );
        return (
          <DetailValue label={t('fields.children')} wide>
            {loading ? treePending() : (
              <>
                <RelationList key={r.id} empty={t('eq.noChildren')}>{(family ?? []).map(chip)}</RelationList>
                {can.edit && (r.kind === 'tester' || r.kind === 'base') && <> <ActionLink action="add-child">{t('eq.addChild')}</ActionLink></>}
              </>
            )}
          </DetailValue>
        );
      },
    },
    {
      key: 'notes', title: t('eq.groupNotes'), fields: [
        // Thẻ (Configuration › Tag) chọn ngay trong phần Remark.
        { key: 'tag_ids', label: t('fields.tags'), wide: true,
          view: (r) => (r.tags.length ? <TagChips items={r.tags} /> : <span className="dp-empty">{t('tag.none')}</span>),
          editor: ({ id, value, onChange, label }) => <TagPicker id={id} value={value} onChange={onChange} tags={options?.tags} label={label} /> },
        { key: 'remark', label: t('fields.remark'), kind: 'textarea', wide: true, maxLength: 1000 },
      ],
    },
    // Nhóm chỉ đọc do module Calibration cung cấp (extension point, docs/DETAIL_MODEL.md 3.10): chỉ Tester.
    {
      key: 'calibration', title: t('cal.groupCalibration'), hideInCreate: true,
      render: (r) => {
        if (r.kind !== 'tester') return null;
        const subs = family?.filter((n) => n.asset_type === 'sub_equipment') ?? [];
        const count = (...s: string[]) => subs.filter((n) => n.cal_status && s.includes(n.cal_status)).length;
        return (
          <DetailValue label={t('cal.summary')} wide>
            {family === null ? treePending() : subs.length === 0 ? t('asset.noCalibrationEquipment') : (
              <>
                {t('asset.calibrationSummary', {
                  overdue: count('overdue'), dueSoon: count('due_soon'), attention: count('not_calibrated', 'failed'), valid: count('valid'),
                })}
                {' '}
                <button type="button" className="link" onClick={() => router.push(`/calibration?q=${encodeURIComponent(r.serial_number)}`)}>
                  {t('asset.viewInCalibration')}
                </button>
              </>
            )}
          </DetailValue>
        );
      },
    },
  ];

  const addChild: ActionDef<EquipmentRow> = {
    key: 'add-child', label: t('eq.addChild'), icon: <Plus size={14} aria-hidden="true" />,
    visible: (r) => (r.kind === 'tester' || r.kind === 'base') && !!ctx.create,
    onClick: (r) => ctx.create?.({ parent_id: r.id }),
  };
  const actions = assetActions<EquipmentRow>({ type: 'equipment', t, isAdmin: can.remove, extra: [addChild] });

  /** Serial đã có ở bản ghi khác (cả ba bảng): cảnh báo, vẫn lưu được. */
  async function checkSerial(payload: Draft, current: EquipmentRow | null): Promise<ReactNode | null> {
    const serial = typeof payload.serial_number === 'string' ? payload.serial_number : null;
    if (!serial) return null;
    const matches = await fetchSerialMatches(serial, current ? { type: 'equipment', id: current.id } : undefined);
    return matches.length ? <SerialWarning matches={matches} /> : null;
  }

  return (
    <RecordModal<EquipmentRow>
      {...ctx}
      trail={phone ? ctx.trail : []}
      record={record}
      size="l"
      canEdit={can.edit}
      createTitle={fixedParentId ? t('eq.addChildTitle', { serial: fixedParent?.serial_number ?? '' }) : t('eq.addTitle')}
      heading={(r) => ({
        title: r.serial_number,
        tags: <><UsageTag usage={r.usage} /><TagChips items={r.tags} /></>,
        subtitle: [r.part_number, r.type].filter(Boolean).join(' · ') || undefined,
        meta: (
          <>
            {r.location && <span data-primary><MapPin size={12} aria-hidden="true" /> {r.location}</span>}
            {r.parent_serial && <span>{t('eq.parentShort')}: {r.parent_serial}</span>}
            <span>{t('dp.updated', { when: formatRelativeTime(r.updated_at, language), who: r.updated_by_name ?? '—' })}</span>
          </>
        ),
      })}
      sections={sections}
      initialTab={initialTab}
      detailAsideTab="tree"
      extraTabs={[{
        key: 'tree', label: t('eq.tabTree'),
        render: (r) => <TreeTab key={loaded?.root_id ?? r.id} tree={loaded} error={loaded ? null : tree.error} onRetry={tree.reload} current={{ type: 'equipment', id: r.id }} onOpen={openAsset} />,
      }]}
      historyUrl={(r) => `/api/equipment/${r.id}/history`}
      historyLabels={{ parent: t('fields.parent') }}
      beforeSave={checkSerial}
      onSave={async (payload, current) => {
        // Ô khóa không nằm trong payload — cha cố định của "Thêm thiết bị con" gửi kèm ở đây.
        const res = current
          ? await api.put<EquipmentRow>(`/api/equipment/${current.id}`, payload)
          : await api.post<EquipmentRow>('/api/equipment', fixedParentId ? { ...payload, parent_id: fixedParentId } : payload);
        return { row: res.data };
      }}
      actions={actions}
    />
  );
}
