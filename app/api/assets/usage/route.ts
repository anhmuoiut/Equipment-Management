import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { assetOps } from '@/lib/services/core/assets';
import { optText, parseBody, readJson, reqId, z } from '@/lib/services/core/validate';

const MAX_REFS = 500;

/**
 * Check-out (in_use) / Check-in (not_in_use): các tài sản được chọn và toàn bộ con cháu đổi cùng lúc, một giao dịch.
 * `dry_run: true` chỉ xem trước. Kết quả: { dry_run, count, deleted, usage_changes[], changes[] }.
 */
export const POST = withAuth(async (req, { requestId, profile }) => {
  const { refs, usage, note, dry_run } = parseBody(z.object({
    refs: z.array(z.object({ type: z.enum(['equipment', 'sub_equipment', 'golden_board']), id: reqId }).strict()).min(1).max(MAX_REFS),
    usage: z.enum(['in_use', 'not_in_use']),
    note: optText(500),
    dry_run: z.boolean().optional(),
  }).strict(), await readJson(req));
  return ok(await assetOps.setUsage(refs, usage, note ?? null, profile.id, dry_run ?? false), requestId);
}, { role: EDITORS });
