import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { assetOps, parseAssetType } from '@/lib/services/core/assets';
import { assertUuid, parseBody, readJson, reqId, z } from '@/lib/services/core/validate';

/**
 * Gắn vào cha / đổi cha — luôn được (theo quy tắc cây), kể cả khi đang In use: tài sản và con cháu lấy vị trí, Level
 * và Status của cha mới (`usage_changes` cho biết tài sản nào đổi Status). `dry_run`: chỉ xem trước.
 */
export const POST = withAuth(async (req, { requestId, profile, params }) => {
  const { parent_id, dry_run } = parseBody(z.object({ parent_id: reqId, dry_run: z.boolean().optional() }).strict(), await readJson(req));
  return ok(await assetOps.move(parseAssetType(params.type), assertUuid(params.id), parent_id, profile.id, dry_run ?? false), requestId);
}, { role: EDITORS });
