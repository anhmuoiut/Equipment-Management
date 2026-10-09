import { withAuth, ok } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { assetOps, parseAssetType } from '@/lib/services/core/assets';
import { assertUuid } from '@/lib/services/core/validate';

/**
 * Xóa thật — chỉ Admin; không xóa tài sản đang In use. Con trực tiếp được giữ lại, thành chưa gắn (Not in use).
 * `?dry_run=1`: chỉ xem trước (con nào thành chưa gắn, tài sản nào đổi Status).
 */
export const DELETE = withAuth(async (req, { requestId, profile, params }) => {
  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1';
  return ok(await assetOps.remove(parseAssetType(params.type), assertUuid(params.id), profile.id, dryRun), requestId);
}, { role: ADMINS });
