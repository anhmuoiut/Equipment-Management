import { withAuth, ok } from '@/lib/auth/withAuth';
import { assetTree } from '@/lib/services/equipment';
import { parseAssetType } from '@/lib/services/core/assets';
import { assertUuid } from '@/lib/services/core/validate';

/** Cây chứa tài sản này (gốc → mọi con cháu), hỏi từ equipment, sub-equipment hoặc golden board. Chỉ đọc. */
export const GET = withAuth(async (_req, { requestId, params }) =>
  ok(await assetTree(parseAssetType(params.type), assertUuid(params.id)), requestId));
