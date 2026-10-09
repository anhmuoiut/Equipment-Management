'use client';

import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui';

/**
 * Hiện NGAY khi chuyển trang trong ứng dụng (thanh trên + menu bên trái giữ nguyên) trong lúc trang mới được tải, thay vì để màn
 * hình đứng yên tới khi server trả lời. Cũng cho phép Next nạp sẵn phần khung này khi rê chuột / cuộn tới liên kết (prefetch).
 */
export default function Loading() {
  const { t } = useTranslation();
  return <Spinner label={t('common.loadingEllipsis')} size="lg" />;
}
