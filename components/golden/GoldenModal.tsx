'use client';

/**
 * Modal Golden — golden board (docs/DETAIL_MODEL.md 4.3). Footer chung của ba module tài sản. Golden board chỉ In use
 * khi đã gắn vào tester / fixture đang In use: Check-out báo lỗi ngay ở mục Kết quả (USAGE_NEEDS_PARENT / PARENT_NOT_IN_USE).
 * Overview dùng lại đúng component này cho `type=golden_board`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { api, formatRelativeTime } from '@/lib/client/api';
import { toSelect, useOptions } from '@/lib/client/options';
import { useCan } from '@/components/ViewerContext';
import { TagChips, UsageTag } from '@/components/ui/tags';
import { TagPicker } from '@/components/ui/TagPicker';
import { RecordModal } from '@/components/ui/record/RecordModal';
import type { SectionDef } from '@/components/ui/record/fields';
import type { DetailCtx } from '@/components/ui/workspace/ModuleWorkspace';
import { assetActions } from '@/components/assets/actions';
import { fetchSerialMatches } from '@/components/assets/api';
import { ParentPicker } from '@/components/assets/pickers';
import { ActionLink, ParentRelation, RelationList, useOpenAsset } from '@/components/assets/Relations';
import { SerialWarning } from '@/components/assets/SerialWarning';
import type { GoldenRow, ParentCandidate } from '@/lib/types';

export function GoldenModal({ ctx }: { ctx: DetailCtx<GoldenRow> }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const options = useOptions();
  const can = useCan();
  const record = ctx.creating ? null : ctx.record;
  const openAsset = useOpenAsset('golden_board');
  const [picked, setPicked] = useState<ParentCandidate | null>(null);

  const parentLocation = (parentId: unknown) =>
    (typeof parentId === 'string' && picked?.id === parentId ? picked.location : record && parentId === record.parent_id ? record.location : null);

  const sections: SectionDef<GoldenRow>[] = [
    {
      key: 'identity', title: t('eq.groupIdentity'), fields: [
        { key: 'part_number', label: t('fields.part_number'), required: true, maxLength: 200 },
        { key: 'serial_number', label: t('fields.serial_number'), required: true, maxLength: 200 },
        { key: 'utd_part_number', label: t('fields.utd_part_number'), maxLength: 200 },
      ],
    },
    {
      key: 'location', title: t('eq.groupLocationRelation'), fields: [
        { key: 'location_id', label: t('fields.location'), kind: 'select', required: (d) => !d.parent_id,
          view: (r) => r.location,
          options: (_d, r) => toSelect(options?.locations, r?.location_id, ` (${t('cfg.hidden')})`),
          lock: (_r, d) => (d.parent_id ? t('eq.locationFromParent') : null),
          draftView: (d) => parentLocation(d.parent_id) },
        { key: 'parent_id', label: t('asset.attachedTo'), wide: true,
          view: (r) => (r.parent_id ? (
            <RelationList key={r.id} empty="">
              {[<ParentRelation key={r.parent_id} id={r.parent_id} serial={r.parent_serial ?? '—'} version={ctx.version}
                onClick={() => openAsset('equipment', r.parent_id!)} />]}
            </RelationList>
          ) : (
            <>
              <span className="dp-empty">{t('asset.notAttached')}</span>
              {can.edit && <> <ActionLink action="attach">{t('asset.attach.golden_board')}</ActionLink></>}
            </>
          )),
          draftView: (d) => (d.parent_id ? (picked?.id === d.parent_id ? picked.serial_number : record?.parent_serial ?? '—') : <span className="dp-empty">{t('asset.notAttached')}</span>),
          editor: ({ value, onChange, label, record: r }) => (
            <ParentPicker type="golden_board" assetId={r?.id} value={(value as string | null) ?? null} valueLabel={r?.parent_serial ?? undefined}
              onChange={onChange} onPick={setPicked} clearable ariaLabel={label} placeholder={t('asset.notAttached')} />
          ) },
      ],
    },
    {
      key: 'status', title: t('asset.groupStatus'), hideInCreate: true, fields: [
        { key: 'usage', label: t('fields.usage'), readOnly: true, view: (r) => <UsageTag usage={r.usage} /> },
      ],
    },
    {
      key: 'more', title: t('gs.groupMore'), fields: [
        { key: 'origin', label: t('fields.origin'), maxLength: 200 },
        { key: 'purpose', label: t('fields.purpose'), maxLength: 500 },
      ],
    },
    {
      key: 'notes', title: t('eq.groupNotes'), fields: [
        { key: 'tag_ids', label: t('fields.tags'), wide: true,
          view: (r) => (r.tags.length ? <TagChips items={r.tags} /> : <span className="dp-empty">{t('tag.none')}</span>),
          editor: ({ id, value, onChange, label }) => <TagPicker id={id} value={value} onChange={onChange} tags={options?.tags} label={label} /> },
        { key: 'remark', label: t('fields.remark'), kind: 'textarea', wide: true, maxLength: 1000 },
      ],
    },
  ];

  const actions = assetActions<GoldenRow>({ type: 'golden_board', t, isAdmin: can.remove });

  return (
    <RecordModal<GoldenRow>
      {...ctx}
      record={record}
      size="l"
      canEdit={can.edit}
      createTitle={t('gs.addTitle')}
      heading={(r) => ({
        title: r.serial_number,
        tags: <><UsageTag usage={r.usage} /><TagChips items={r.tags} /></>,
        subtitle: [r.part_number, r.utd_part_number].filter(Boolean).join(' · ') || undefined,
        meta: (
          <>
            {r.location && <span data-primary><MapPin size={12} aria-hidden="true" /> {r.location}</span>}
            {r.parent_serial && <span>{t('asset.attachedTo')}: {r.parent_serial}</span>}
            <span>{t('dp.updated', { when: formatRelativeTime(r.updated_at, language), who: r.updated_by_name ?? '—' })}</span>
          </>
        ),
      })}
      sections={sections}
      historyUrl={(r) => `/api/golden/${r.id}/history`}
      historyLabels={{ parent: t('asset.attachedTo') }}
      beforeSave={async (payload, current) => {
        const serial = typeof payload.serial_number === 'string' ? payload.serial_number : null;
        if (!serial) return null;
        const matches = await fetchSerialMatches(serial, current ? { type: 'golden_board', id: current.id } : undefined);
        return matches.length ? <SerialWarning matches={matches} /> : null;
      }}
      onSave={async (payload, current) => {
        const res = current
          ? await api.put<GoldenRow>(`/api/golden/${current.id}`, payload)
          : await api.post<GoldenRow>('/api/golden', payload);
        return { row: res.data };
      }}
      actions={actions}
    />
  );
}
