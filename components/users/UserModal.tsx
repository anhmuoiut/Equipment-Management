'use client';

/**
 * Modal tài khoản (docs/UI.md). Đúng bốn thao tác Admin: Thêm, Sửa (form), Đặt lại mật
 * khẩu và Khóa / Mở khóa (trong [Thao tác ▾]). Mật khẩu tạm chỉ hiện một lần, ngay trong modal (TempPasswordView).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Lock, LockOpen } from 'lucide-react';
import { api, formatTime } from '@/lib/client/api';
import { toSelect, useOptions } from '@/lib/client/options';
import { useViewer } from '@/components/ViewerContext';
import { UserStatusTag, ToneTag } from '@/components/ui/tags';
import { ActionScreen } from '@/components/ui/record/ActionScreen';
import { RecordModal, type ActionCtx } from '@/components/ui/record/RecordModal';
import type { SectionDef } from '@/components/ui/record/fields';
import type { DetailCtx } from '@/components/ui/workspace/ModuleWorkspace';
import { TempPasswordView } from './TempPasswordView';
import { ROLES } from '@/lib/permissions';
import type { UserRow, UserWithTempPassword } from '@/lib/types';

export function UserModal({ ctx }: { ctx: DetailCtx<UserRow> }) {
  const { t } = useTranslation();
  const options = useOptions();
  const viewer = useViewer();
  const roleOptions = ROLES.map((r) => ({ value: r, label: t(`values.${r}`) }));

  const sections: SectionDef<UserRow>[] = [
    {
      key: 'account', title: t('usr.groupAccount'), fields: [
        { key: 'username', label: t('fields.username'), required: true, maxLength: 64,
          lock: (r) => (r ? t('usr.usernameLocked') : null) },
        { key: 'full_name', label: t('fields.full_name'), required: true, maxLength: 200 },
        { key: 'employee_id', label: t('fields.employee_id'), maxLength: 100 },
        { key: 'department_id', label: t('fields.department'), kind: 'select', view: (r) => r.department,
          options: (_d, r) => toSelect(options?.departments, r?.department_id, ` (${t('cfg.hidden')})`) },
      ],
    },
    {
      key: 'permission', title: t('usr.groupPermission'), fields: [
        { key: 'role', label: t('fields.role'), kind: 'select', required: true, options: roleOptions,
          view: (r) => <ToneTag text={t(`values.${r.role}`)} tone="info" />,
          lock: (r) => (r?.id === viewer.userId ? t('usr.ownRoleLocked') : null) },
      ],
    },
    {
      key: 'status', title: t('usr.groupStatus'), hideInCreate: true, fields: [
        { key: 'is_active', label: t('fields.account_status'), readOnly: true, view: (r) => <UserStatusTag active={r.is_active} /> },
        { key: 'must_change_password', label: t('fields.must_change_password'), readOnly: true,
          view: (r) => (r.must_change_password ? t('common.yes') : t('common.no')) },
      ],
    },
  ];

  return (
    <RecordModal<UserRow>
      {...ctx}
      size="l"
      canEdit
      createTitle={t('usr.addTitle')}
      heading={(r) => ({
        title: r.full_name,
        tags: <><UserStatusTag active={r.is_active} /><ToneTag text={t(`values.${r.role}`)} tone="info" /></>,
        subtitle: [r.username, r.department].filter(Boolean).join(' · '),
        meta: <span>{t('usr.createdAt', { when: formatTime(r.created_at) })}</span>,
      })}
      sections={sections}
      defaults={{ role: 'readonly' }}
      historyUrl={(r) => `/api/users/${r.id}/history`}
      historyLabels={{ department_id: t('fields.department'), is_active: t('fields.account_status') }}
      onSave={async (payload, record) => {
        if (record) return { row: (await api.put<UserRow>(`/api/users/${record.id}`, payload)).data };
        const res = await api.post<UserWithTempPassword>('/api/users', payload);
        return { row: res.data.user, extra: res.data.temp_password };
      }}
      savedScreen={({ row, extra, done }) => (
        <TempPasswordView info={{ username: row.username, fullName: row.full_name, password: String(extra), created: true }} onDone={done} />
      )}
      actions={[
        { key: 'password', label: t('usr.resetPassword'), icon: <KeyRound size={14} aria-hidden="true" />,
          visible: (r) => r.id !== viewer.userId, screen: (a) => <ResetPasswordScreen ctx={a} /> },
        { key: 'disable', label: t('usr.disable'), icon: <Lock size={14} aria-hidden="true" />,
          visible: (r) => r.id !== viewer.userId && r.is_active, screen: (a) => <DisableScreen ctx={a} /> },
        { key: 'enable', label: t('usr.enable'), icon: <LockOpen size={14} aria-hidden="true" />,
          visible: (r) => !r.is_active, runMessage: t('usr.enabled'),
          run: async (r) => (await api.post<UserRow>(`/api/users/${r.id}/enable`)).data },
      ]}
    />
  );
}

function ResetPasswordScreen({ ctx }: { ctx: ActionCtx<UserRow> }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<UserWithTempPassword | null>(null);
  if (result) {
    return (
      <TempPasswordView
        info={{ username: result.user.username, fullName: result.user.full_name, password: result.temp_password, created: false }}
        onDone={() => ctx.done(result.user, t('usr.passwordReset'))}
      />
    );
  }
  return (
    <ActionScreen description={t('usr.resetDesc', { name: ctx.record.full_name })} onCancel={ctx.cancel}
      confirmLabel={t('usr.resetPassword')}
      onConfirm={async () => {
        const res = await api.post<UserWithTempPassword>(`/api/users/${ctx.record.id}/password`);
        setResult(res.data);
        // Đóng bằng ✕ cũng không làm danh sách cũ đi ("phải đổi mật khẩu" vừa bật).
        ctx.reload();
      }} />
  );
}

function DisableScreen({ ctx }: { ctx: ActionCtx<UserRow> }) {
  const { t } = useTranslation();
  return (
    <ActionScreen description={t('usr.disableDesc', { name: ctx.record.full_name })} onCancel={ctx.cancel}
      confirmLabel={t('usr.disable')} danger
      onConfirm={async () => ctx.done((await api.post<UserRow>(`/api/users/${ctx.record.id}/disable`)).data, t('usr.disabled'))} />
  );
}
