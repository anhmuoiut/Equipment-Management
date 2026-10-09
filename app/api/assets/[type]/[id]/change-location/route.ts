import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { changeAssetLocation, parseAssetType } from '@/lib/services/core/assets';
import { assertUuid, parseBody, readJson, reqId, z } from '@/lib/services/core/validate';

/** Đổi vị trí — chỉ tài sản chưa gắn cha, không đang In use; con cháu đi theo. `dry_run`: chỉ xem trước. */
export const POST = withAuth(async (req, { requestId, profile, params }) => {
  const { location_id, dry_run } = parseBody(z.object({ location_id: reqId, dry_run: z.boolean().optional() }).strict(), await readJson(req));
  return ok(await changeAssetLocation(parseAssetType(params.type), assertUuid(params.id), location_id, profile.id, dry_run ?? false), requestId);
}, { role: EDITORS });
