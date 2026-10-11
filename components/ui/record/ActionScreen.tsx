'use client';

/**
 * Khung màn hình thao tác trong modal (docs/DETAIL_MODEL.md 3.6): nội dung · footer `[Hủy] [nút chính]`.
 * Tiêu đề nằm ở breadcrumb của khung (← SN-001 › Swap), không lặp ở đây. Khung lo trạng thái gửi: đang chạy
 * thì khóa nút và modal (không bấm lặp, không đóng giữa chừng); lỗi (kể cả mất mạng) hiện ngay trên màn hình.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/client/api';
import { Button, LoadingOverlay, ModalFooter, Notice } from '@/components/ui';
import { useLeaveGuard, useRecordBusy } from './context';

export function ActionScreen({
  description, children, onCancel, onConfirm, confirmLabel, confirmDisabled, danger, dirty, cancelLabel, busyLabel, footerNote,
  className, confirmIcon,
}: {
  description?: ReactNode;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  /** What the button does ("Swap", "Check-out"…); "Confirm" only when nothing more specific fits. */
  confirmLabel?: string;
  confirmIcon?: ReactNode;
  confirmDisabled?: boolean;
  className?: string;
  danger?: boolean;
  /** Người dùng đã chọn / nhập gì đó: đóng hoặc ← sẽ hỏi "Hủy bỏ thay đổi?". */
  dirty?: boolean;
  cancelLabel?: string;
  busyLabel?: string;
  /** Dòng chữ ở footer, bên trái (ví dụ lý do nút chính đang khóa). */
  footerNote?: ReactNode;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useLeaveGuard(!!dirty && !busy ? true : null);
  useRecordBusy(busy);

  async function confirm() {
    if (submittingRef.current || confirmDisabled) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={`ms dp-action${className ? ` ${className}` : ''}`}>
      {description && <p className="dp-action-desc">{description}</p>}
      {error && <Notice tone="alert">{error}</Notice>}
      <div className="dp-action-body">
        {children}
        {busy && children && <LoadingOverlay label={busyLabel ?? t('common.processing')} />}
      </div>
      <ModalFooter>
        {footerNote && <span className="mf-note">{footerNote}</span>}
        <Button onClick={onCancel} disabled={busy}>{cancelLabel ?? t('common.cancel')}</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={busy || confirmDisabled} onClick={() => void confirm()}>
          {!busy && confirmIcon}
          {confirmLabel ?? t('dp.confirm')}
        </Button>
      </ModalFooter>
    </div>
  );
}

/** "Hủy bỏ thay đổi?" — một màn hình trong chính modal, không phải hộp thoại thứ hai (docs/DETAIL_MODEL.md 3.7). */
export function DiscardScreen({ title, message, stayLabel, leaveLabel, onStay, onLeave }: {
  title: string; message: string; stayLabel: string; leaveLabel: string; onStay: () => void; onLeave: () => void;
}) {
  return (
    <div className="ms dp-action" data-screen="discard">
      <Notice tone="warn">
        <strong>{title}</strong>
        <div>{message}</div>
      </Notice>
      <ModalFooter>
        <Button onClick={onStay} autoFocus>{stayLabel}</Button>
        <Button variant="danger" onClick={onLeave}>{leaveLabel}</Button>
      </ModalFooter>
    </div>
  );
}
