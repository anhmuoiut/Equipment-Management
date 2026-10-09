import { withAuth, ok } from '@/lib/auth/withAuth';
import { ADMINS, EDITORS } from '@/lib/permissions';
import { deleteCalibration, updateCalibration } from '@/lib/services/calibration';
import { assertUuid, defined, parseBody, readJson } from '@/lib/services/core/validate';
import { updateCalibrationSchema } from '../../schema';

/** Sửa một lần hiệu chuẩn nhập sai — Admin, User. */
export const PUT = withAuth(async (req, { requestId, profile, params }) =>
  ok(await updateCalibration(assertUuid(params.recordId), defined(parseBody(updateCalibrationSchema, await readJson(req))), profile.id), requestId),
{ role: EDITORS });

/** Xóa một lần hiệu chuẩn — chỉ Admin. */
export const DELETE = withAuth(async (_req, { requestId, profile, params }) =>
  ok(await deleteCalibration(assertUuid(params.recordId), profile.id), requestId),
{ role: ADMINS });
