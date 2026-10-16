import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { toLanguage } from '@/lib/i18n/text';
import { configExport } from '@/lib/services/configurationImport';
import { listFromParams } from '../../schema';

/**
 * Export Excel của một danh sách Configuration — ĐÚNG bố cục file mẫu import (cùng cột, tiêu đề, danh sách thả xuống) điền sẵn mọi dòng,
 * để sửa rồi import lại (chọn Ghi đè). Chỉ Admin. `?lang=vi|en`.
 */
export const GET = withAuth(async (req, { params }) => {
  const list = listFromParams(params);
  const language = toLanguage(new URL(req.url).searchParams.get('lang'));
  const buffer = await configExport(list, language);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${list.key}-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}, { role: ADMINS });
