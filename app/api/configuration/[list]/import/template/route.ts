import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { toLanguage } from '@/lib/i18n/text';
import { configImportTemplate } from '@/lib/services/configurationImport';
import { listFromParams } from '../../../schema';

/** File mẫu import (.xlsx) của một danh sách Configuration — danh sách chọn lấy từ Configuration ngay lúc tải. `?lang=vi|en`. */
export const GET = withAuth(async (req, { params }) => {
  const list = listFromParams(params);
  const language = toLanguage(new URL(req.url).searchParams.get('lang'));
  const buffer = await configImportTemplate(list, language);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${list.key}-import-template-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}, { role: ADMINS });
