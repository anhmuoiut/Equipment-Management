'use client';

/**
 * Màn hình thao tác chung của ba module tài sản (docs/DETAIL_MODEL.md 4.1): Đổi vị trí, Gắn vào / Đổi cha (Move),
 * Tách khỏi cha (Detach), Swap, Xóa, Check-out / Check-in. Mỗi màn hình xem trước bằng `dry_run` (mục "Kết quả")
 * — lỗi của database hiện ngay, trước khi bấm nút chính — rồi gọi lại thật và quay về chi tiết.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ArrowUpDown, Info } from 'lucide-react';
import { toSelect, useOptions } from '@/lib/client/options';
import { useFetch } from '@/lib/client/useFetch';
import { Button, Notice, Skeleton } from '@/components/ui';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ActionScreen } from '@/components/ui/record/ActionScreen';
import { ActionField } from '@/components/ui/record/fields';
import type { ActionCtx } from '@/components/ui/record/RecordModal';
import { UsageTag } from '@/components/ui/tags';
import { ASSET_API, deleteAsset, parentOf, runOp, setUsage, useDryRun, type AssetRecord } from './api';
import { OpResult } from './OpResult';
import { SwapPreview } from './SwapPreview';
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
      <OpResult state={preview} />
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
      <OpResult state={preview} />
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
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [candidate, setCandidate] = useState<SwapCandidate | null>(null);
  const validTarget = !!candidate && candidate.id === otherId && !candidate.same_place;
  const previewKey = `${otherId ?? ''}:${selectionVersion}`;
  const preview = useDryRun(validTarget ? () => runOp(type, record.id, 'swap', { other_id: otherId }, true) : null, previewKey);
  return (
    <ActionScreen
      className="swap-screen"
      onCancel={ctx.cancel} dirty={otherId !== null}
      confirmLabel={t('swap.title')} confirmIcon={<ArrowLeftRight size={16} aria-hidden="true" />}
      confirmDisabled={!validTarget || !preview.result || preview.loading || !!preview.error}
      onConfirm={async () => {
        await runOp(type, record.id, 'swap', { other_id: otherId }, false);
        ctx.reload();
        ctx.done(undefined, t('eq.swapped'));
      }}
    >
      <div className="swap-comparison">
        <section className="swap-equipment" aria-label={t('swap.current')}>
          <h3 className="swap-card-heading">{t('swap.current')}</h3>
          <div className="swap-card">
            <SwapEquipmentSummary item={record} showLevel={type === 'equipment'} level={'level' in record ? record.level : null} />
          </div>
        </section>
        <div className="swap-direction" role="img" aria-label={t('swap.exchange')}>
          <ArrowLeftRight className="swap-direction-horizontal" size={24} aria-hidden="true" />
          <ArrowUpDown className="swap-direction-vertical" size={24} aria-hidden="true" />
        </div>
        <section className="swap-equipment" aria-label={t('eq.swapWith')}>
          <h3 className="swap-card-heading">{t('eq.swapWith')}</h3>
          <div className="swap-card">
            <div className="swap-selector-row">
              <SwapPicker type={type} assetId={record.id} value={otherId} onChange={(id) => {
                setOtherId(id);
                setSelectionVersion((version) => version + 1);
              }} onPick={setCandidate}
                ariaLabel={t('eq.swapWith')} placeholder={t('swap.selectEquipment')} className="swap-selector" />
            </div>
            {candidate
              ? <SwapTargetSummary key={previewKey} type={type} candidate={candidate} />
              : <p className="swap-empty-target">{t('swap.noTarget')}</p>}
          </div>
        </section>
      </div>
      {candidate?.same_place && <Notice tone="warn">{t('eq.swapNoChange')}</Notice>}
      <SwapPreview state={preview} selected={[
        { type, id: record.id, label: record.serial_number },
        ...(candidate ? [{ type, id: candidate.id, label: candidate.serial_number }] : []),
      ]} />
      <p className="swap-info"><Info size={15} aria-hidden="true" /><span>{t(type === 'equipment' ? 'swap.noteEquipment' : 'swap.note')}</span></p>
    </ActionScreen>
  );
}

function SwapEquipmentSummary({ item, showLevel, level, levelLoading }: {
  item: Pick<AssetRecord, 'serial_number' | 'part_number' | 'location' | 'usage'>;
  showLevel: boolean;
  level?: string | null;
  levelLoading?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="swap-card-summary">
      <div className="swap-card-identity">
        <strong className="swap-card-serial">{item.serial_number}</strong>
        <span className="swap-card-part">{item.part_number || '—'}</span>
      </div>
      <dl className="swap-card-fields">
        <div className="swap-card-field"><dt>{t('fields.location')}</dt><dd className="swap-card-location">{item.location || '—'}</dd></div>
        {showLevel && <div className="swap-card-field"><dt>{t('fields.level')}</dt><dd>
          {levelLoading ? <span role="status" aria-label={t('common.loadingEllipsis')}><Skeleton className="h-4 w-20" /></span> : level || '—'}
        </dd></div>}
        <div className="swap-card-field"><dt>{t('fields.usage')}</dt><dd><UsageTag usage={item.usage} /></dd></div>
      </dl>
    </div>
  );
}

/** Candidate search supplies the comparison fields; the existing detail API supplies Equipment Level. */
function SwapTargetSummary({ type, candidate }: { type: AssetType; candidate: SwapCandidate }) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useFetch<EquipmentRow>(type === 'equipment' ? `${ASSET_API[type]}/${candidate.id}` : null);
  return (
    <>
      <SwapEquipmentSummary item={data ?? candidate} showLevel={type === 'equipment'} level={data?.level} levelLoading={loading && !data} />
      {error && <div className="swap-card-error"><Notice tone="alert">{error}</Notice><Button size="sm" onClick={reload}>{t('common.retry')}</Button></div>}
    </>
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
      <ActionField label={t('eq.usageNote')} htmlFor="usage-note">
        <textarea id="usage-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </ActionField>
      <OpResult state={preview} />
    </ActionScreen>
  );
}
