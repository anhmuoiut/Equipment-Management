import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { assetOps, parseAssetType } from '@/lib/services/core/assets';
import { AppError } from '@/lib/errors';
import { assertUuid, parseBody, readJson, reqId, z } from '@/lib/services/core/validate';

/**
 * Đổi chỗ hai tài sản cùng loại: mỗi bên nhận cha, vị trí và Status của bên kia; con cháu đi theo. Chọn trong
 * swap-candidates. `dry_run`: chỉ xem trước.
 */
export const POST = withAuth(async (req, { requestId, profile, params }) => {
  const { other_id, dry_run } = parseBody(z.object({ other_id: reqId, dry_run: z.boolean().optional() }).strict(), await readJson(req));
  const id = assertUuid(params.id);
  if (other_id === id) throw new AppError('VALIDATION_ERROR', { fields: { other_id: 'same_asset' } });
  return ok(await assetOps.swap(parseAssetType(params.type), id, other_id, profile.id, dry_run ?? false), requestId);
}, { role: EDITORS });
