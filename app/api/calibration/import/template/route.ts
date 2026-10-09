import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { toLanguage } from '@/lib/i18n/text';
import { subImportTemplate } from '@/lib/services/subEquipmentImport';

/** File mẫu import (.xlsx) — danh sách chọn lấy từ Configuration ngay lúc tải. `?lang=vi|en`. */
export const GET = withAuth(async (req) => {
  const language = toLanguage(new URL(req.url).searchParams.get('lang'));
  const buffer = await subImportTemplate(language);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="calibration-import-template-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}, { role: EDITORS });
