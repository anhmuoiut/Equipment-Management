import { z, optText, optId, reqText, reqId } from '@/lib/services/core/validate';

/** Trường trên form thiết bị — docs/DATABASE_MODIFIED.md mục 3. */
const fields = {
  serial_number: reqText(200),
  jabil_id: optText(200),
  // Part Number bắt buộc; Type không gửi — luôn theo part number (database tự đặt).
  part_number_id: reqId,
  asset: optText(200),
  level_id: optId,
  tag_ids: z.array(reqId).max(1), // mỗi lần chỉ một thẻ (cột vẫn là mảng)
  location_id: reqId,
  remark: optText(1000),
};

/** Thiết bị cha (thêm và sửa): có cha thì vị trí theo cha (không cần location_id); null = không có cha. */
export const createSchema = z.object({ ...fields, location_id: optId, parent_id: optId }).strict();
/** Sửa: đổi cha → Move / Detach, đổi vị trí → Đổi vị trí (database); con cháu luôn đi theo. */
export const updateSchema = z.object({ ...fields, parent_id: optId }).partial().strict();
