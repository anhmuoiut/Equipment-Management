import { z, optText, optId, optDate, reqId, reqText } from '@/lib/services/core/validate';

/** Trường sub-equipment — docs/DATABASE_MODIFIED.md mục 4. Type không gửi: luôn theo part number. */
const sub = {
  serial_number: reqText(200),
  jabil_id: optText(200),
  part_number_id: reqId,
  asset: optText(200),
  tester_id: optId,
  location_id: reqId,
  remark: optText(1000),
  tag_ids: z.array(reqId).max(50),
};
/** Có tester thì vị trí theo tester (không cần location_id). */
export const createSubSchema = z.object({ ...sub, location_id: optId }).strict();
export const updateSubSchema = z.object(sub).partial().strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Một lần hiệu chuẩn. due_date chỉ cần khi part number chưa có Setup (có Setup thì database tự tính). */
const calibration = {
  calibrated_at: isoDate,
  due_date: optDate,
  vendor_id: optId,
  cert_no: optText(200),
  cert_file_url: optText(1000),
  result: z.enum(['pass', 'fail']),
  remark: optText(1000),
};
export const addCalibrationSchema = z.object(calibration).partial({ due_date: true, vendor_id: true, cert_no: true, cert_file_url: true, result: true, remark: true }).strict();
export const updateCalibrationSchema = z.object(calibration).partial().strict();
