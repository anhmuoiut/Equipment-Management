import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { assetOps, parseAssetType } from '@/lib/services/core/assets';
import { assertUuid, parseBody, readJson, z } from '@/lib/services/core/validate';

/** Tách khỏi cha — được cả khi In use; tài sản và con cháu về Not in use. `dry_run`: chỉ xem trước. */
export const POST = withAuth(async (req, { requestId, profile, params }) => {
  const { dry_run } = parseBody(z.object({ dry_run: z.boolean().optional() }).strict(), await readJson(req));
  return ok(await assetOps.detach(parseAssetType(params.type), assertUuid(params.id), profile.id, dry_run ?? false), requestId);
}, { role: EDITORS });
