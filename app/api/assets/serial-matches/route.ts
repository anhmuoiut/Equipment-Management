import { withAuth, ok } from '@/lib/auth/withAuth';
import { parseAssetType, serialMatches } from '@/lib/services/core/assets';
import { UUID_RE } from '@/lib/services/core/validate';

/**
 * Serial trùng ở cả ba bảng (đã cắt khoảng trắng, không phân biệt hoa/thường). `exclude_type` + `exclude_id`: bỏ
 * chính bản ghi đang sửa. Trùng thì màn hình cảnh báo nhưng vẫn cho lưu.
 */
export const GET = withAuth(async (req, { requestId }) => {
  const sp = new URL(req.url).searchParams;
  const excludeType = sp.get('exclude_type');
  const excludeId = sp.get('exclude_id');
  const exclude = excludeType && excludeId && UUID_RE.test(excludeId)
    ? { type: parseAssetType(excludeType), id: excludeId } : undefined;
  return ok(await serialMatches((sp.get('serial') ?? '').slice(0, 200), exclude), requestId);
});
