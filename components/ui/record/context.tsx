'use client';

/**
 * Cầu nối giữa màn hình bên trong RecordModal (form, thao tác) và khung: màn hình báo
 * "có thay đổi chưa lưu" (→ khi đóng / ← khung hiện "Hủy bỏ thay đổi?") và "đang gửi" (→ không đóng được).
 */
import { createContext, useContext, useEffect } from 'react';

/** `true` = hỏi "Hủy bỏ thay đổi?"; hoặc chữ riêng (ví dụ đóng mà chưa sao chép mật khẩu tạm). */
export type LeaveGuard = true | { title: string; message: string; stay?: string; leave?: string };

export type RecordContextValue = {
  setGuard: (guard: LeaveGuard | null) => void;
  setBusy: (busy: boolean) => void;
  /** Rời màn hình hiện tại (nút [Xong] …): có guard thì khung hỏi trước, rồi mới gọi `go`. */
  requestLeave: (go: () => void) => void;
  /** Mở màn hình thao tác theo khóa (liên kết chữ trong chi tiết: "Gắn vào thiết bị cha"); không có quyền / không hiện thì bỏ qua. */
  openAction: (key: string) => void;
};

export const RecordContext = createContext<RecordContextValue | null>(null);

export function useRecordContext(): RecordContextValue | null {
  return useContext(RecordContext);
}

/** Màn hình có thay đổi chưa lưu thì truyền guard; hết thay đổi / màn hình đóng thì tự gỡ. */
export function useLeaveGuard(guard: LeaveGuard | null | false) {
  const ctx = useContext(RecordContext);
  const key = guard ? JSON.stringify(guard) : '';
  useEffect(() => {
    if (!ctx || !guard) return;
    ctx.setGuard(guard);
    return () => ctx.setGuard(null);
    // key đại diện cho guard; ctx ổn định trong đời RecordModal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Màn hình đang gửi: khung không cho đóng (✕, Esc, bấm ngoài). */
export function useRecordBusy(busy: boolean) {
  const ctx = useContext(RecordContext);
  useEffect(() => {
    if (!ctx || !busy) return;
    ctx.setBusy(true);
    return () => ctx.setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
}
