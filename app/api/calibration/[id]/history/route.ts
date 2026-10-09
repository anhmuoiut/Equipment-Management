import { withAuth, ok } from '@/lib/auth/withAuth';
import { subEquipmentHistory } from '@/lib/services/calibration';
import { assertUuid } from '@/lib/services/core/validate';

/** ?only=calibrations → chỉ các lần hiệu chuẩn (CALIBRATE, CALIBRATION_UPDATE, CALIBRATION_REMOVE). */
export const GET = withAuth(async (req, { requestId, params }) => {
  const only = new URL(req.url).searchParams.get('only') === 'calibrations';
  return ok(await subEquipmentHistory(assertUuid(params.id), only), requestId);
});
