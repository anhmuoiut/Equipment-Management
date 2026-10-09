import 'server-only';

/** Kiểm tra dữ liệu gửi lên (zod) — dùng chung cho mọi route. */
import { z } from 'zod';
import { AppError } from '@/lib/errors';

export { z };

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const fields: Record<string, string> = {};
    r.error.issues.slice(0, 20).forEach((issue) => {
      // .strict(): key thừa nằm ở issue gốc (path rỗng) — ghi từng key để log / client thấy được.
      if (issue.code === 'unrecognized_keys') {
        issue.keys.forEach((k) => { fields[[...issue.path, k].join('.')] ??= 'unknown_field'; });
        return;
      }
      const key = issue.path.join('.');
      if (key && !fields[key]) fields[key] = issue.code === 'too_small' ? 'required' : issue.message;
    });
    throw new AppError('VALIDATION_ERROR', { fields });
  }
  return r.data;
}

export async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { throw new AppError('VALIDATION_ERROR'); }
}

/** Chuỗi tùy chọn: cắt khoảng trắng, rỗng → null. */
export const optText = (max = 200) =>
  z.union([z.string(), z.null()]).optional()
    .transform((v) => (v == null ? v : v.trim() === '' ? null : v.trim()))
    .refine((v) => v == null || v.length <= max, { message: 'too_long' });

/** Chuỗi bắt buộc, cắt khoảng trắng. */
export const reqText = (max = 200) => z.string().trim().min(1).max(max);

export const optId = z.union([z.string().uuid(), z.null()]).optional();
export const reqId = z.string().uuid();
export const optDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional();

/** Bỏ các key undefined — chỉ gửi trường thật sự có trong request. */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(id: string | undefined): string {
  if (!id || !UUID_RE.test(id)) throw new AppError('NOT_FOUND');
  return id;
}
