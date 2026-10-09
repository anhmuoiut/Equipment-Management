'use client';

import { useTranslation } from 'react-i18next';
import type { SerialMatch } from '@/lib/types';

/** Cảnh báo trước khi lưu: serial này đã có ở tài sản khác (cả ba bảng). Vẫn lưu được — bấm "Vẫn lưu". */
export function SerialWarning({ matches }: { matches: SerialMatch[] }) {
  const { t } = useTranslation();
  return (
    <>
      <strong>{t('asset.serialExists')}</strong>
      <ul className="op-list">
        {matches.map((m) => (
          <li key={`${m.asset_type}:${m.id}`}>
            <strong>{m.serial_number}</strong>
            <span>{t(`asset.type.${m.asset_type}`)}</span>
            <span>{[m.part_number, m.location].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ul>
      <div>{t('asset.serialExistsHint')}</div>
    </>
  );
}
