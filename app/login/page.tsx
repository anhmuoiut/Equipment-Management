'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BarChart3, Cpu, Eye, EyeOff, LockKeyhole, Package, UserRound, Wrench } from 'lucide-react';
import { PreferenceControls } from '@/components/Preferences';
import { JabilLogo } from '@/components/JabilLogo';
import Image from 'next/image';
import './login.css';
import { api, errorMessage } from '@/lib/client/api';
import { safeLoginDestination } from '@/lib/auth/username';
import { SUPPORT_EMAIL } from '@/lib/support';

function SupportEmail() {
  return <a className="support-email" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}

function LoginForm() {
  const router = useRouter();
  const destination = safeLoginDestination(useSearchParams().get('next'));
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError(t(!username.trim() ? 'login.errorUsernameRequired' : 'login.errorPasswordRequired'));
      const field = e.currentTarget as HTMLFormElement;
      field.querySelector<HTMLInputElement>(!username.trim() ? '#username' : '#password')?.focus();
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/login', { username, password });
      // Giữ trạng thái đang đăng nhập tới khi rời trang (không bấm lặp).
      router.replace(destination);
      router.refresh();
    } catch (err) {
      // Sai mật khẩu, bị khóa, quá số lần, lỗi server, mất mạng — mỗi lỗi một câu riêng.
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="login-form" aria-label={t('login.signIn')} aria-busy={busy}>
      <div className="login-intro">
        <h1>{t('login.welcomeBack')}</h1>
        <p>{t('login.description')}</p>
      </div>

      <label htmlFor="username">{t('login.username')}</label>
      <div className="login-input">
        <UserRound size={18} aria-hidden="true" />
        <input id="username" name="username" type="text" required autoComplete="username" autoCapitalize="none"
          spellCheck={false} maxLength={64} value={username} onChange={e => setUsername(e.target.value)}
          placeholder={t('login.enterUsername')} aria-describedby={error ? 'login-error' : undefined} />
      </div>
      <label htmlFor="password">{t('login.password')}</label>
      <div className="login-input">
        <LockKeyhole size={18} aria-hidden="true" />
        <input id="password" name="password" type={visible ? 'text' : 'password'} required autoComplete="current-password"
          maxLength={256} value={password} onChange={e => setPassword(e.target.value)}
          placeholder={t('login.enterPassword')} aria-describedby={error ? 'login-error' : undefined} />
        <button type="button" className="password-toggle" aria-label={visible ? t('login.hidePassword') : t('login.showPassword')}
          aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
      <details className="login-recovery">
        <summary>{t('login.forgotPassword')}</summary>
        <div className="login-recovery-body">
          <p>{t('login.contactAdmin')}</p>
          <p><SupportEmail /></p>
        </div>
      </details>
      <button className="sign-in-button" type="submit" disabled={busy}>
        {busy ? t('login.signingIn') : t('login.signIn')}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <div className="auth-divider"><span>{t('login.or')}</span></div>
      <button type="button" className="sso-button" disabled aria-describedby="sso-availability">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path fill="#0078d4" d="M2 4.5 11 3.3v8.2H2zm10-1.3L22 2v9.5H12zM2 12.5h9v8.2l-9-1.2zm10 0h10V22l-10-1.3z" />
        </svg>
        <span>{t('login.signInWithSso')}</span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <p id="sso-availability" className="sso-availability">{t('login.ssoComingSoon')}</p>
    </form>
  );
}

export default function LoginPage() {
  const { t } = useTranslation();
  return (
    <main className="login-page jabil-login">
      <Image
        src="/login-signup/login-signup-background.webp"
        alt={t('loginBrand.factoryAlt')}
        fill
        priority
        sizes="100vw"
        className="auth-background"
        unoptimized
      />
      <div className="auth-layout">
        <div className="auth-title">
          <div className="auth-mobile-brand"><JabilLogo /><span>TEST ENGINEERING</span></div>
          <h2><span>{t('loginBrand.equipment')}</span><span>{t('loginBrand.management')}</span></h2>
          <p>{t('loginBrand.workcellName')}</p>
          <div className="auth-title-accent" aria-hidden="true" />
          <ul className="auth-capabilities">
            {[
              { Icon: Cpu, action: 'trackAssetsAction', subject: 'trackAssetsSubject' },
              { Icon: Package, action: 'manageLocationsAction', subject: 'manageLocationsSubject' },
              { Icon: Wrench, action: 'planMaintenanceAction', subject: 'planMaintenanceSubject' },
              { Icon: BarChart3, action: 'improveEfficiencyAction', subject: 'improveEfficiencySubject' },
            ].map(({ Icon, action, subject }) => (
              <li key={action}>
                <span className="auth-capability-icon"><Icon size={24} strokeWidth={1.8} aria-hidden="true" /></span>
                <span className="auth-capability-label">{t(`loginBrand.${action}`)}<br />{t(`loginBrand.${subject}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <section className="login-main" aria-label={t('login.yourWorkspace')}>
          <div className="login-form-area"><Suspense fallback={<p role="status">{t('common.loadingEllipsis')}</p>}><LoginForm /></Suspense></div>
          <div className="auth-preferences"><PreferenceControls /></div>
        </section>
      </div>
    </main>
  );
}
