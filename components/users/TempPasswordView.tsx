'use client';

/**
 * Màn hình "Mật khẩu tạm" (docs/UI.md): hiện mật khẩu hệ thống sinh MỘT lần sau khi Admin
 * Thêm tài khoản hoặc Đặt lại mật khẩu, kèm nút Sao chép. Mật khẩu không được lưu ở đâu và không hiện lại.
 * Là một màn hình trong chính modal (không phải hộp thoại thứ hai). Đóng / [Xong] khi chưa bấm Sao chép thì
 * khung hỏi lại (Admin vẫn Đặt lại mật khẩu được nếu lỡ mất).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { Button, ModalFooter, Notice } from '@/components/ui';
import { useLeaveGuard, useRecordContext } from '@/components/ui/record/context';

export type TempPasswordInfo = { username: string; fullName: string; password: string; created: boolean };

/** Clipboard API cần HTTPS / localhost; trang nội bộ chạy http thì dùng cách cũ. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
  }
}

export function TempPasswordView({ info, onDone }: { info: TempPasswordInfo; onDone: () => void }) {
  const { t } = useTranslation();
  const record = useRecordContext();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useLeaveGuard(copied ? null : {
    title: t('usr.temp.closeTitle'), message: t('usr.temp.closeBody'), stay: t('usr.temp.stay'), leave: t('usr.temp.closeAnyway'),
  });

  async function copy() {
    const ok = await copyText(info.password);
    setCopied(ok);
    setCopyFailed(!ok);
  }

  return (
    <div className="ms">
      <p className="text-[13px]">
        {t(info.created ? 'usr.temp.createdDesc' : 'usr.temp.resetDesc', { name: info.fullName, username: info.username })}
      </p>
      <div
        className="ident"
        style={{
          fontSize: 28, fontWeight: 600, letterSpacing: '.04em', textAlign: 'center', padding: '14px 12px',
          border: '1px solid var(--rule)', background: 'var(--surface)', userSelect: 'all',
        }}
        data-testid="temp-password"
      >
        {info.password}
      </div>
      <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>{t('usr.temp.note')}</p>
      {copyFailed && <Notice tone="warn">{t('usr.temp.copyFailed')}</Notice>}
      <ModalFooter>
        <Button onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? t('usr.temp.copied') : t('usr.temp.copy')}
        </Button>
        <Button variant="primary" onClick={() => (record ? record.requestLeave(onDone) : onDone())}>{t('usr.temp.done')}</Button>
      </ModalFooter>
    </div>
  );
}
