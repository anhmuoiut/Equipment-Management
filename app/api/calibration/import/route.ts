import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { AppError } from '@/lib/errors';
import { importSubEquipmentFile } from '@/lib/services/subEquipmentImport';

/**
 * Import Excel Calibration (sub-equipment) — Admin, User. multipart: `file` (.xlsx), `commit`.
 * Không có commit = 1: chỉ kiểm tra, trả báo cáo. commit = 1: kiểm tra lại, hết lỗi mới thêm tất cả (một giao dịch).
 */
export const POST = withAuth(async (req, { requestId, profile }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError('VALIDATION_ERROR', { fields: { file: 'required' } });
  }
  const file = form.get('file');
  const report = await importSubEquipmentFile(typeof file === 'string' ? null : file, form.get('commit') === '1', profile.id);
  return ok(report, requestId);
}, { role: EDITORS });
