'use client';

/**
 * Màn hình thao tác chung của ba module tài sản (docs/DETAIL_MODEL.md 4.1): Đổi vị trí, Gắn vào / Đổi cha (Move),
 * Tách khỏi cha (Detach), Swap, Xóa, Check-out / Check-in. Mỗi màn hình xem trước bằng `dry_run` (mục "Kết quả")
 * — lỗi của database hiện ngay, trước khi bấm nút chính — rồi gọi lại thật và quay về chi tiết.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toSelect, useOptions } from '@/lib/client/options';
import { Notice } from '@/components/ui';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ActionScreen } from '@/components/ui/record/ActionScreen';
import { ActionField } from '@/components/ui/record/fields';
import type { ActionCtx } from '@/components/ui/record/RecordModal';
import { UsageTag } from '@/components/ui/tags';
import { deleteAsset, parentOf, runOp, setUsage, useDryRun, type AssetRecord } from './api';
import { OpResult } from './OpResult';
import { ParentPicker, SwapPicker } from './pickers';
import type { AssetType, EquipmentRow, SwapCandidate, Usage } from '@/lib/types';

type ScreenProps = { type: AssetType; ctx: ActionCtx<AssetRecord> };

const hasKids = (r: AssetRecord) => 'has_children' in r && !!(r as EquipmentRow).has_children;

export function ChangeLocationScreen({ type, ctx }: ScreenProps) {
  const { t } = useTranslation();
  const options = useOptions();
  const record = ctx.record;
  const [locationId, setLocationId] = useState('');
  const valid = locationId !== '' && locationId !== record.location_id;
  const preview = useDryRun(valid ? () => runOp(type, record.id, 'change-location', { location_id: locationId }, true) : null, locationId);
  return (
    <ActionScreen
      description={t('asset.changeLocationDesc')} onCancel={ctx.cancel} dirty={locationId !== ''}
      confirmLabel={t('eq.changeLocation')} confirmDisabled={!valid || preview.loading || !!preview.error}
      onConfirm={async () => {
        await runOp(type, record.id, 'change-location', { location_id: locationId }, false);
        ctx.reload();
        ctx.done(undefined, t('eq.locationChanged'));
      }}
    >
      {hasKids(record) && <Notice tone="info">{t('asset.childrenFollow')}</Notice>}
      <ActionField label={t('eq.currentLocation')}><span className="dp-value">{record.location}</span></ActionField>
      <ActionField label={t('eq.newLocation')} required>
        <SearchableSelect value={locationId} onChange={setLocationId} placeholder={t('dp.selectPlaceholder')} ariaLabel={t('eq.newLocation')}
          options={toSelect(options?.locations).filter((o) => o.value !== record.location_id)} />
      </ActionField>
      <OpResult state={preview} hint={t('asset.pickLocationHint')} />
    </ActionScreen>
  );
}

/** Gắn vào cha (chưa có cha) hoặc Đổi cha (đã có) — Move luôn được theo quy tắc cây, kể cả khi đang In use. */
export function MoveScreen({ type, ctx }: ScreenProps) {
  const { t } = useTranslation();
  const record = ctx.record;
  const current = parentOf(type, record);
  const [parentId, setParentId] = useState<string | null>(null);
  const preview = useDryRun(parentId ? () => runOp(type, record.id, 'move', { parent_id: parentId }, true) : null, parentId ?? '');
  return (
    <ActionScreen
      description={t(`asset.moveDesc.${type}`)} onCancel={ctx.cancel} dirty={parentId !== null}
      confirmLabel={current ? t('eq.moveConfirm') : t('eq.attachConfirm')} confirmDisabled={!parentId || preview.loading || !!preview.error}
      onConfirm={async () => {
        await runOp(type, record.id, 'move', { parent_id: parentId }, false);
        ctx.reload();
        ctx.done(undefined, t('eq.moved'));
      }}
    >
      {hasKids(record) && <Notice tone="info">{t('asset.childrenFollow')}</Notice>}
      <ActionField label={t('eq.currentParent')}><span className="dp-value">{current ? current.serial : t('eq.noParent')}</span></ActionField>
      <ActionField label={t('eq.newParent')} required>
        <ParentPicker type={type} assetId={record.id} value={parentId} onChange={setParentId} showUsageAfter
          ariaLabel={t('eq.newParent')} placeholder={t('dp.selectPlaceholder')} />
      </ActionField>
      <OpResult state={preview} hint={t('asset.pickParentHint')} />
    </ActionScreen>
  );
}

export function DetachScreen({ type, ctx }: ScreenProps) {
  const { t } = useTranslation();
  const record = ctx.record;
  const parent = parentOf(type, record);
  const preview = useDryRun(() => runOp(type, record.id, 'detach', {}, true), 'detach');
  return (
    <ActionScreen
      description={t('eq.detachDesc', { serial: parent?.serial ?? '', location: record.location ?? '' })} onCancel={ctx.cancel}
      confirmLabel={t('asset.detachConfirm')} confirmDisabled={preview.loading || !!preview.error}
      onConfirm={async () => {
        await runOp(type, record.id, 'detach', {}, false);
        ctx.reload();
        ctx.done(undefined, t('eq.detached'));
      }}
    >
      {record.usage === 'in_use' && <Notice tone="warn">{t('eq.detachInUseNote')}</Notice>}
      {hasKids(record) && <Notice tone="info">{t('asset.childrenFollow')}</Notice>}
      <OpResult state={preview} />
    </ActionScreen>
  );
}

export function SwapScreen({ type, ctx }: ScreenProps) {
  const { t } = useTranslation();
  const record = ctx.record;
  const [otherId, setOtherId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<SwapCandidate | null>(null);
  const preview = useDryRun(otherId ? () => runOp(type, record.id, 'swap', { other_id: otherId }, true) : null, otherId ?? '');
  const typeName = 'type' in record ? record.type : null;
  return (
    <ActionScreen
      description={<>{t('eq.swapDesc')} {type === 'golden_board' ? t('asset.swapAnyGolden') : t('eq.swapSameType', { type: typeName ?? '' })}</>}
      onCancel={ctx.cancel} dirty={otherId !== null}
      confirmLabel={t('eq.swap')} confirmDisabled={!otherId || !!candidate?.same_place || preview.loading || !!preview.error}
      onConfirm={async () => {
        await runOp(type, record.id, 'swap', { other_id: otherId }, false);
        ctx.reload();
        ctx.done(undefined, t('eq.swapped'));
      }}
    >
      {hasKids(record) && <Notice tone="info">{t('asset.childrenFollow')}</Notice>}
      <ActionField label={t('eq.swapWith')} required>
        <SwapPicker type={type} assetId={record.id} value={otherId} onChange={setOtherId} onPick={setCandidate}
          ariaLabel={t('eq.swapWith')} placeholder={t('dp.selectPlaceholder')} />
      </ActionField>
      {candidate?.same_place && <Notice tone="warn">{t('eq.swapNoChange')}</Notice>}
      <OpResult state={preview} hint={t('asset.pickSwapHint')} />
    </ActionScreen>
  );
}

export function DeleteAssetScreen({ type, ctx }: ScreenProps) {
  const { t } = useTranslation();
  const record = ctx.record;
  const preview = useDryRun(() => deleteAsset(type, record.id, true), 'delete');
  return (
    <ActionScreen
      danger description={t('eq.deleteDesc')} onCancel={ctx.cancel}
      confirmLabel={t('common.delete')} confirmDisabled={preview.loading || !!preview.error}
      onConfirm={async () => {
        await deleteAsset(type, record.id, false);
        // Con trực tiếp (nếu có) thành chưa gắn: danh sách đổi nhiều dòng.
        ctx.reload();
        ctx.removed(t('dp.deleted'));
      }}
    >
      {hasKids(record) && <Notice tone="warn">{t('asset.deleteChildrenWarn', { serial: record.serial_number })}</Notice>}
      {type === 'sub_equipment' && <Notice tone="warn">{t('asset.deleteCalibrationsWarn')}</Notice>}
      <OpResult state={preview} />
    </ActionScreen>
  );
}

/** Check-out (→ In use) hoặc Check-in (→ Not in use): tài sản và toàn bộ con cháu đổi Status, kèm ghi chú. */
export function UsageScreen({ type, ctx }: ScreenProps) {
  const { t } = useTranslation();
  const record = ctx.record;
  const target: Usage = record.usage === 'in_use' ? 'not_in_use' : 'in_use';
  const out = target === 'in_use';
  const [note, setNote] = useState('');
  const preview = useDryRun(() => setUsage(type, record.id, target, null, true), 'usage');
  return (
    <ActionScreen
      description={t(out ? 'eq.checkOutDesc' : 'eq.checkInDesc')} onCancel={ctx.cancel} dirty={note.trim() !== ''}
      confirmLabel={t(out ? 'eq.checkOut' : 'eq.checkIn')} confirmDisabled={preview.loading || !!preview.error}
      onConfirm={async () => {
        const result = await setUsage(type, record.id, target, note.trim() || null, false);
        ctx.reload();
        ctx.done(undefined, t(out ? 'eq.checkedOut' : 'eq.checkedIn', { count: Math.max(1, result.usage_changes.length) }));
      }}
    >
      <ActionField label={t('fields.usage')}>
        <span className="dp-value"><UsageTag usage={record.usage} /> <span aria-hidden="true">→</span> <UsageTag usage={target} /></span>
      </ActionField>
      <ActionField label={t('eq.usageNote')} hint={t('eq.usageNoteHint')} htmlFor="usage-note">
        <textarea id="usage-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </ActionField>
      <OpResult state={preview} />
    </ActionScreen>
  );
}
