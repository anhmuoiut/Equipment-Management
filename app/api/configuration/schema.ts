import { AppError } from '@/lib/errors';
import { configList, STATUS_COLORS, type ConfigListDef } from '@/lib/configuration';
import { z, optId, optText, reqText, reqId } from '@/lib/services/core/validate';

export function listFromParams(params: Record<string, string>): ConfigListDef {
  const list = configList(params.list ?? '');
  if (!list) throw new AppError('NOT_FOUND');
  return list;
}

const order = z.number().int().min(0).max(100000);

/** Trường được sửa của từng danh sách — docs/DATABASE.md. */
export function schemaFor(list: ConfigListDef, mode: 'create' | 'update') {
  if (list.isCalibration) {
    // Part number chỉ chọn khi thêm (đổi PN = xóa dòng rồi thêm lại).
    const fields = {
      interval_months: z.number().int().min(1).max(600),
      warning_days: z.number().int().min(1).max(3650),
    };
    return mode === 'create' ? z.object({ part_number_id: reqId, ...fields }).strict() : z.object(fields).partial().strict();
  }
  let shape: z.ZodRawShape;
  if (list.isTag) {
    shape = {
      display_name: reqText(100),
      sort_order: order,
      color: z.enum(STATUS_COLORS),
    };
  } else {
    shape = { display_name: reqText(200), sort_order: order, is_active: z.boolean() };
    if (list.hasDescription) shape.description = optText(1000);
    // Bắt buộc, không xóa trống được (sửa: chỉ gửi khi đổi; đã có thiết bị dùng thì database từ chối: PART_NUMBER_IN_USE).
    if (list.hasType) shape.type_id = reqId;
    // Không bắt buộc: bỏ trống / null = chưa chọn Level cho part number.
    if (list.hasLevel) shape.level_id = optId;
    // Types: Group bắt buộc (kind của Type do database đặt theo nhóm, không gửi lên).
    if (list.hasGroup) shape.group_id = reqId;
  }
  const schema = z.object(shape).strict();
  return mode === 'create' ? schema : schema.partial();
}
