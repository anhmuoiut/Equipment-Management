import { NextResponse } from 'next/server';
import { withAuth, ok } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { AppError } from '@/lib/errors';
import { toLanguage } from '@/lib/i18n/text';
import { configCheckFile, importConfigFile } from '@/lib/services/configurationImport';
import { listFromParams } from '../../schema';

/**
 * Import Excel cho một danh sách Configuration — chỉ Admin. multipart: `file` (.xlsx), `commit`.
 * Không có commit = 1: chỉ kiểm tra, trả báo cáo. commit = 1: kiểm tra lại, hết lỗi mới ghi (thêm dòng mới bằng một câu INSERT).
 */
export const POST = withAuth(async (req, { requestId, profile, params }) => {
  const list = listFromParams(params);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError('VALIDATION_ERROR', { fields: { file: 'required' } });
  }
  const file = form.get('file');
  // report = 1: trả về FILE (không phải JSON) — các dòng của file đã chọn, dòng lỗi tô đỏ, dòng đã có tô vàng, kèm cột Problem.
  if (form.get('report') === '1') {
    const buffer = await configCheckFile(list, typeof file === 'string' ? null : file, toLanguage(String(form.get('lang') ?? '')));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${list.key}-import-check-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  // Tên trùng dòng có sẵn: on_duplicate = overwrite → sửa dòng có sẵn; còn lại → giữ bản gốc.
  const onDuplicate = form.get('on_duplicate') === 'overwrite' ? 'overwrite' : 'keep';
  const report = await importConfigFile(list, typeof file === 'string' ? null : file, form.get('commit') === '1', profile.id, onDuplicate);
  return ok(report, requestId);
}, { role: ADMINS });
