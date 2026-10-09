import { withAuth, ok } from '@/lib/auth/withAuth';
import { parseAssetType, validParents } from '@/lib/services/core/assets';
import { UUID_RE } from '@/lib/services/core/validate';
import { AppError } from '@/lib/errors';
import type { EquipmentKind } from '@/lib/types';

const KINDS: EquipmentKind[] = ['tester', 'base', 'fixture'];

/**
 * Cha hợp lệ để gắn vào (ô "Thiết bị cha" / "Tester" / "Gắn vào", màn hình Move). Tài sản có sẵn: `id`;
 * thêm mới: `kind` (tester / base / fixture, khi type = equipment). `q`: lọc theo serial / part number.
 */
export const GET = withAuth(async (req, { requestId, params }) => {
  const type = parseAssetType(params.type);
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id');
  const kind = sp.get('kind');
  if (id && !UUID_RE.test(id)) throw new AppError('VALIDATION_ERROR', { fields: { id: 'invalid' } });
  if (kind && !KINDS.includes(kind as EquipmentKind)) throw new AppError('VALIDATION_ERROR', { fields: { kind: 'invalid' } });
  return ok(await validParents(type, {
    id, kind: kind as EquipmentKind | null, q: sp.get('q')?.trim().slice(0, 100) || null,
    limit: Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200),
  }), requestId);
});
