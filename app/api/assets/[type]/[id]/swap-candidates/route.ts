import { withAuth, ok } from '@/lib/auth/withAuth';
import { parseAssetType, swapCandidates } from '@/lib/services/core/assets';
import { assertUuid } from '@/lib/services/core/validate';

/** Tài sản có thể Swap với `id` (cùng Type với equipment / sub-equipment; golden board bất kỳ). */
export const GET = withAuth(async (req, { requestId, params }) => {
  const sp = new URL(req.url).searchParams;
  return ok(await swapCandidates(
    parseAssetType(params.type), assertUuid(params.id),
    sp.get('q')?.trim().slice(0, 100) || null, Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200),
  ), requestId);
});
