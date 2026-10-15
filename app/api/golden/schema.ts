import { z, optText, optId, reqText, reqId } from '@/lib/services/core/validate';

/** Trường golden board — docs/DATABASE.md. */
const fields = {
  part_number: reqText(200),
  serial_number: reqText(200),
  utd_part_number: optText(200),
  origin: optText(200),
  purpose: optText(500),
  parent_id: optId,
  location_id: reqId,
  remark: optText(1000),
  tag_ids: z.array(reqId).max(1), // mỗi lần chỉ một thẻ (cột vẫn là mảng)
};

/** Có cha (tester / fixture) thì vị trí theo cha (không cần location_id). */
export const createSchema = z.object({ ...fields, location_id: optId }).strict();
export const updateSchema = z.object(fields).partial().strict();
