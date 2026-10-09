import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { addCalibration, listCalibrations } from '@/lib/services/calibration';
import { assertUuid, defined, parseBody, readJson } from '@/lib/services/core/validate';
import { addCalibrationSchema } from '../../schema';

/** Các lần hiệu chuẩn của sub-equipment, mới nhất lên đầu — mọi nhóm. */
export const GET = withAuth(async (_req, { requestId, params }) =>
  ok(await listCalibrations(assertUuid(params.id)), requestId));

/** Ghi nhận một lần hiệu chuẩn — Admin, User. Trả { record, sub_equipment } (Calibration Status đã cập nhật). */
export const POST = withAuth(async (req, { requestId, profile, params }) =>
  ok(await addCalibration(assertUuid(params.id), defined(parseBody(addCalibrationSchema, await readJson(req))), profile.id), requestId),
{ role: EDITORS });
