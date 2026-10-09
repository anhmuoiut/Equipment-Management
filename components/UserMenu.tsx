'use client';

/**
 * One trigger (avatar + full name) for "acting as this person": a small menu
 * with account settings, then sign out.
 *
 * Account settings itself is two independent forms — updating your own
 * name/employee ID/department, and changing your own password — each with
 * its own Save button, not one shared submit, since they're unrelated
 * actions a person might do only one of.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2, LogOut, UserRound } from 'lucide-react';
import { api, errorMessage } from '@/lib/client/api';
import { useFetch } from '@/lib/client/useFetch';
import { toSelect, useOptions } from '@/lib/client/options';
import { Button, ErrorState, Modal, Notice, Spinner, toast } from '@/components/ui';
import { ActionField } from '@/components/ui/record/fields';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { PreferenceMenuItems } from '@/components/Preferences';

type OwnAccount = {
  full_name: string;
  username: string;
  employee_id: string | null;
  department_id: string | null;
};

export function UserMenu({ username, fullName }: { username: string; fullName: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
      // Giữ trạng thái đang đăng xuất tới khi rời trang.
      router.push('/login');
      router.refresh();
    } catch (e) {
      // Phiên chưa xóa được: ở lại và báo, không chuyển sang /login (middleware sẽ đưa về lại).
      toast.error(errorMessage(e, t));
      setSigningOut(false);
    }
  }

  const displayName = fullName || username;
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button" className="user-menu-trigger" onClick={() => setOpen((o) => !o)}
        aria-haspopup="true" aria-expanded={open}
      >
        <span className="user-avatar" aria-hidden="true">{initials}</span>
        <span className="user-menu-name">{displayName}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul className="user-menu-list" role="menu">
          <li role="none">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setShowSettings(true); }}>
              <UserRound size={15} aria-hidden="true" />{t('userMenu.accountSettings')}
            </button>
          </li>
          <PreferenceMenuItems onDone={() => setOpen(false)} />
          <li role="none" className="user-menu-signout">
            <button type="button" role="menuitem" data-danger disabled={signingOut} aria-busy={signingOut || undefined}
              onClick={() => void signOut()}>
              {signingOut ? <Loader2 size={15} aria-hidden="true" className="ui-spin" /> : <LogOut size={15} aria-hidden="true" />}
              {t('nav.signOut')}
            </button>
          </li>
        </ul>
      )}
      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/** Mở mới mỗi lần (mount khi mở): luôn đọc thông tin mới nhất, form trống. */
function AccountSettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data: account, error, reload } = useFetch<OwnAccount>('/api/me');
  return (
    <Modal size="m" title={t('userMenu.accountSettings')} onClose={onClose}>
      {error ? <ErrorState message={error} onRetry={reload} />
        : !account ? <Spinner label={t('common.loadingEllipsis')} />
          : <AccountForms account={account} />}
    </Modal>
  );
}

function AccountForms({ account }: { account: OwnAccount }) {
  const { t } = useTranslation();
  const options = useOptions();

  const [profileForm, setProfileForm] = useState({
    full_name: account.full_name, employee_id: account.employee_id ?? '', department_id: account.department_id ?? '',
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwVisible, setPwVisible] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  async function saveProfile() {
    setProfileBusy(true);
    setProfileError(null);
    try {
      await api.put('/api/me', {
        full_name: profileForm.full_name.trim(),
        employee_id: profileForm.employee_id.trim() || null,
        department_id: profileForm.department_id || null,
      });
      toast.success(t('userMenu.profileSaved'));
    } catch (e) {
      setProfileError(errorMessage(e, t));
    } finally {
      setProfileBusy(false);
    }
  }

  async function submitPassword() {
    setPwError(null);
    if (pwForm.next !== pwForm.confirm) { setPwError(t('adminUsers.errorPasswordMismatch')); return; }
    if (pwForm.next.length < 10) { setPwError(t('adminUsers.errorPasswordTooShort')); return; }
    if (pwForm.next === pwForm.current) { setPwError(t('forcedPassword.errorSameAsCurrent')); return; }
    setPwBusy(true);
    try {
      await api.put('/api/me/password', { current_password: pwForm.current, new_password: pwForm.next });
      toast.success(t('adminUsers.passwordChanged'));
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (e) {
      setPwError(errorMessage(e, t));
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{t('userMenu.yourInformation')}</h3>
          <p className="ident mt-0.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {account.username}
          </p>
        </div>

        {profileError && <Notice tone="alert">{profileError}</Notice>}

        <div className="dp-grid">
          <ActionField htmlFor="acc-full-name" label={t('adminUsers.fullName')} required>
            <input id="acc-full-name" required value={profileForm.full_name}
              onChange={(e) => setProfileForm((f) => ({ ...f, full_name: e.target.value }))} />
          </ActionField>
          <ActionField htmlFor="acc-employee-id" label={t('adminUsers.employeeId')} wide={false}>
            <input id="acc-employee-id" value={profileForm.employee_id}
              onChange={(e) => setProfileForm((f) => ({ ...f, employee_id: e.target.value }))} />
          </ActionField>
          <ActionField label={t('adminUsers.department')} wide={false}>
            <SearchableSelect
              value={profileForm.department_id} clearable placeholder={t('dp.selectPlaceholder')}
              ariaLabel={t('adminUsers.department')}
              onChange={(v) => setProfileForm((f) => ({ ...f, department_id: v }))}
              options={toSelect(options?.departments, profileForm.department_id)}
            />
          </ActionField>
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button variant="primary" disabled={!profileForm.full_name.trim()} loading={profileBusy} onClick={() => void saveProfile()}>
            {t('common.save')}
          </Button>
        </div>
      </section>

      <section className="grid gap-3 border-t pt-4" style={{ borderColor: 'var(--rule-soft)' }}>
        <h3 className="text-[14px] font-semibold">{t('userMenu.changePassword')}</h3>

        {pwError && <Notice tone="alert">{pwError}</Notice>}

        <div className="dp-grid">
          <ActionField htmlFor="acc-pw-current" label={t('userMenu.currentPassword')} required>
            <input id="acc-pw-current" required minLength={1} maxLength={256} type={pwVisible ? 'text' : 'password'}
              autoComplete="current-password" value={pwForm.current}
              onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} />
          </ActionField>
          <ActionField htmlFor="acc-pw-new" label={t('adminUsers.newPassword')} required wide={false}>
            <input id="acc-pw-new" required minLength={10} maxLength={256} type={pwVisible ? 'text' : 'password'}
              autoComplete="new-password" value={pwForm.next}
              onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))} />
          </ActionField>
          <ActionField htmlFor="acc-pw-confirm" label={t('adminUsers.confirmNewPassword')} required wide={false}>
            <input id="acc-pw-confirm" required minLength={10} maxLength={256} type={pwVisible ? 'text' : 'password'}
              autoComplete="new-password" value={pwForm.confirm}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))} />
          </ActionField>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="dp-switch">
            <input type="checkbox" checked={pwVisible} onChange={(e) => setPwVisible(e.target.checked)} />
            {t('login.showPassword')}
          </label>
          <Button
            variant="primary" disabled={!pwForm.current || !pwForm.next || !pwForm.confirm} loading={pwBusy}
            onClick={() => void submitPassword()}
          >
            {t('userMenu.updatePassword')}
          </Button>
        </div>
      </section>
    </div>
  );
}
