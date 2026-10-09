'use client';

/**
 * Nhãn in được của một tài sản (Equipment, Calibration, Golden) — nằm ngoài nhóm route (app) nên không có sidebar / thanh
 * trên, chỉ layout gốc. Chỉ mở được khi đã đăng nhập (middleware bảo vệ như mọi route khác); trang không tự kiểm tra quyền.
 *
 * Mã QR sinh ngay trên trình duyệt từ đường dẫn của module (`/equipment?id=` · `/calibration?id=` · `/golden?id=`),
 * không lưu ở đâu. Mã hóa uuid chứ không phải serial nên đường dẫn vẫn dùng được nếu serial được sửa.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/client/api';
import { useFetch } from '@/lib/client/useFetch';
import { ErrorState, Spinner } from '@/components/ui';
import { ASSET_API, assetHref, type AssetRecord } from './api';
import type { AssetType, EquipmentRow, GoldenRow } from '@/lib/types';

export function AssetLabel({ type, id }: { type: AssetType; id: string }) {
  const { t } = useTranslation();
  const { data: asset, error, reload } = useFetch<AssetRecord>(`${ASSET_API[type]}/${id}`);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${window.location.origin}${assetHref(type, id)}`;
    QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#002B49', light: '#FFFFFF' } })
      .then(setQrDataUrl, (e: unknown) => setQrError(errorMessage(e, t)));
  }, [type, id, t]);

  const failure = error ?? qrError;
  if (failure) {
    return <main className="label-page"><ErrorState message={failure} onRetry={error ? reload : undefined} /></main>;
  }
  if (!asset || !qrDataUrl) {
    return <main className="label-page"><Spinner label={t('common.loadingEllipsis')} size="lg" /></main>;
  }
  const part = type === 'golden_board' ? (asset as GoldenRow).part_number : (asset as EquipmentRow).part_number;

  return (
    <main className="label-page">
      <div className="label-toolbar no-print">
        <button type="button" onClick={() => window.print()}>{t('label.print')}</button>
      </div>
      <div className="label-card">
        <p className="label-heading">{t(`label.${type}`)}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a locally
            generated data: URL gains nothing from next/image's remote
            optimization pipeline. */}
        <img src={qrDataUrl} alt={t('label.qrAlt', { serial: asset.serial_number })} className="label-qr" />
        <p className="label-field"><span>{t('label.serialShort')}</span><strong className="ident">{asset.serial_number}</strong></p>
        {part && <p className="label-field"><span>{t('label.partShort')}</span><strong className="ident">{part}</strong></p>}
      </div>
    </main>
  );
}
