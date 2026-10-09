'use client';

/** Trang User Management (chỉ Admin): Masterlist + modal tài khoản; lọc nhanh "Đã khóa". */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UserStatusTag, ToneTag } from '@/components/ui/tags';
import { ModuleWorkspace, useList } from '@/components/ui/workspace/ModuleWorkspace';
import { RowCard, type Column } from '@/components/ui/masterlist/Masterlist';
import { UserModal } from './UserModal';
import type { UserRow } from '@/lib/types';

export function UsersWorkspace() {
  const { t } = useTranslation();
  const list = useList<UserRow>('/api/users');

  // useMemo / useCallback: Masterlist memo theo identity của các prop này (xem EquipmentWorkspace).
  const columns = useMemo<Column<UserRow>[]>(() => [
    { key: 'full_name', label: t('fields.full_name'), value: (r) => r.full_name, render: (r) => <strong>{r.full_name}</strong> },
    { key: 'username', label: t('fields.username'), value: (r) => r.username },
    { key: 'employee_id', label: t('fields.employee_id'), value: (r) => r.employee_id },
    { key: 'department', label: t('fields.department'), value: (r) => r.department, filter: true },
    { key: 'role', label: t('fields.role'), value: (r) => t(`values.${r.role}`), render: (r) => <ToneTag text={t(`values.${r.role}`)} tone="info" />, filter: true },
    { key: 'is_active', label: t('fields.account_status'), value: (r) => t(r.is_active ? 'values.active' : 'values.locked'),
      render: (r) => <UserStatusTag active={r.is_active} />, filter: true },
    { key: 'must_change_password', label: t('fields.must_change_password'), value: (r) => t(r.must_change_password ? 'common.yes' : 'common.no') },
  ], [t]);

  const mobileCard = useCallback((r: UserRow) => (
    <RowCard
      title={r.full_name}
      tag={<UserStatusTag active={r.is_active} />}
      lines={[[r.username, t(`values.${r.role}`)].join(' · '), [r.department, r.employee_id].filter(Boolean).join(' · ')]}
    />
  ), [t]);

  // Nhãn có số tài khoản đã khóa → chỉ tạo mảng mới khi số đó đổi.
  const lockedCount = useMemo(() => list.rows.filter((r) => !r.is_active).length, [list.rows]);
  const quickFilters = useMemo(() => [
    { key: 'locked', label: t('usr.lockedFilter', { count: lockedCount }), test: (r: UserRow) => !r.is_active },
  ], [t, lockedCount]);

  return (
    <ModuleWorkspace<UserRow>
      title={t('nav.users')}
      list={list}
      columns={columns}
      mobileCard={mobileCard}
      storageKey="users"
      exportName="users"
      canAdd
      addLabel={t('usr.add')}
      recordUrl={(id) => `/api/users/${id}`}
      quickFilters={quickFilters}
      renderDetail={(ctx) => <UserModal ctx={ctx} />}
    />
  );
}
