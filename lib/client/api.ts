'use client';

import { listCache } from '@/lib/client/cache';

/**
 * API client. Mọi thất bại đều thành ApiError { code, status, requestId }:
 * lỗi server ({ code, message, request_id }), phản hồi lạ (theo HTTP status),
 * mất mạng (NETWORK_ERROR), quá thời gian (TIMEOUT) — nên mọi màn hình chỉ
 * cần một cách hiện lỗi: errorMessage().
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown>,
    readonly requestId: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Lỗi theo từng trường, để gắn vào ô nhập tương ứng. */
  get fieldErrors(): Record<string, string> {
    const f = this.details.fields;
    return f && typeof f === 'object' ? (f as Record<string, string>) : {};
  }
}

type Envelope<T> =
  | { success: true; data: T; meta: Record<string, unknown> }
  | { success: false; error: { code: string; message: string; details: Record<string, unknown>; request_id: string } };

export type Result<T> = { data: T; meta: Record<string, unknown> };

const TIMEOUT_MS = 30_000;
/** Import Excel kiểm tra / ghi cả file — cho phép lâu hơn. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Phản hồi không theo chuẩn (proxy, nền tảng host…) → mã lỗi theo HTTP status. */
const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 408: 'TIMEOUT',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_ERROR', 504: 'TIMEOUT',
};

function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN_ERROR');
}

let sessionEnding = false;

/** Phiên hết hạn / tài khoản bị khóa giữa chừng → xóa phiên và về trang đăng nhập (một lần). */
function endSessionIfNeeded(path: string, code: string) {
  if (sessionEnding || path.startsWith('/api/auth/') || (code !== 'UNAUTHORIZED' && code !== 'USER_INACTIVE')) return;
  sessionEnding = true;
  window.location.assign('/api/auth/session-ended');
}

async function send(path: string, init: RequestInit, timeout: number): Promise<Response> {
  try {
    return await fetch(path, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    throw new ApiError(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', String(e), {}, '-', 0);
  }
}

function toApiError(path: string, res: Response, body: Envelope<unknown> | null): ApiError {
  const error = body && !body.success ? body.error : null;
  const err = error
    ? new ApiError(error.code, error.message, error.details ?? {}, error.request_id, res.status)
    : new ApiError(res.ok ? 'SERVER_ERROR' : codeForStatus(res.status), `HTTP ${res.status}`, {}, '-', res.status);
  endSessionIfNeeded(path, err.code);
  return err;
}

async function call<T>(path: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<Result<T>> {
  // FormData: để trình duyệt tự đặt Content-Type (multipart + boundary).
  const headers = init.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' };
  const res = await send(path, { ...init, headers }, timeout);
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (res.ok && body?.success) {
    // Đăng nhập / đăng xuất: danh sách đã nhớ là của tài khoản trước.
    if (path.startsWith('/api/auth/')) listCache.clear();
    return { data: body.data, meta: body.meta };
  }
  throw toApiError(path, res, body);
}

/**
 * GET trùng nhau đang chạy dùng CHUNG một request: React StrictMode (dev) chạy mọi effect hai lần, và nhiều vùng màn hình có thể
 * cùng mở một URL. Chỉ nhập vào request bắt đầu SAU lần ghi gần nhất — mỗi lần ghi (bắt đầu và xong) đổi `writes`, nên một GET
 * sau khi lưu luôn đi lấy dữ liệu mới, không bao giờ nhận phản hồi cũ của một GET đã bay trước đó.
 */
let writes = 0;
const inflight = new Map<string, { writes: number; promise: Promise<Result<unknown>> }>();

function get<T>(path: string): Promise<Result<T>> {
  const shared = inflight.get(path);
  if (shared && shared.writes === writes) return shared.promise as Promise<Result<T>>;
  const promise = call<T>(path).finally(() => { if (inflight.get(path)?.promise === promise) inflight.delete(path); });
  inflight.set(path, { writes, promise });
  return promise;
}

function write<T>(path: string, init: RequestInit, timeout?: number): Promise<Result<T>> {
  writes++;
  return call<T>(path, init, timeout).finally(() => { writes++; });
}

/** Lưu Blob thành file tải về. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Tải file server sinh ra (xlsx…) về máy; lỗi vẫn theo chuẩn { code, message }. */
async function download(path: string): Promise<void> {
  const res = await send(path, {}, TIMEOUT_MS);
  if (!res.ok) throw toApiError(path, res, await res.json().catch(() => null));
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
  saveBlob(await res.blob(), name);
}

export const api = {
  get,
  post: <T>(path: string, body?: unknown) => write<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) => write<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => write<T>(path, { method: 'DELETE' }),
  /** Gửi file (multipart/form-data). */
  upload: <T>(path: string, form: FormData) => write<T>(path, { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS),
  download,
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Lỗi → câu cho người dùng, theo ngôn ngữ đang chọn (src/i18n/locales › errors).
 * Mã lạ → câu chung theo HTTP status. Lỗi server (5xx) kèm request id để báo
 * Admin; chi tiết kỹ thuật chỉ nằm ở error_log / terminal, không bao giờ ở đây.
 */
export function errorMessage(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) {
    // Không tải được phần code tải-khi-cần (thư viện Excel…) = mất mạng.
    if (error instanceof Error && error.name === 'ChunkLoadError') return t('errors.NETWORK_ERROR');
    console.error(error);
    return t('errors.UNKNOWN_ERROR');
  }
  const text = t(`errors.${error.code}`, { defaultValue: t(`errors.${codeForStatus(error.status)}`) });
  return error.status >= 500 && error.requestId !== '-' ? `${text} (${error.requestId})` : text;
}

// Intl.DateTimeFormat tốn kém khi dựng (có múi giờ) — dựng MỘT lần, dùng cho mọi ô ngày trong danh sách và modal.
const TIME_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
});
const DATE_FORMAT = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });

/** Ngày giờ theo giờ Việt Nam. Dữ liệu lưu timestamptz. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return TIME_FORMAT.format(new Date(iso));
}

/** Ngày (date hoặc timestamptz) dạng dd/mm/yyyy. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return DATE_FORMAT.format(new Date(iso.length <= 10 ? `${iso}T00:00:00+07:00` : iso));
}

export function formatRelativeTime(iso: string | null | undefined, language: 'en' | 'vi'): string {
  if (!iso) return '—';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return language === 'vi' ? 'vừa xong' : 'just now';
  if (minutes < 60) return language === 'vi' ? `${minutes} phút trước` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return language === 'vi' ? `${hours} giờ trước` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return language === 'vi' ? `${days} ngày trước` : `${days}d ago`;
  return formatTime(iso);
}

/** Cộng tháng vào ngày yyyy-mm-dd (xem trước "hạn mới"). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function todayVN(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}
