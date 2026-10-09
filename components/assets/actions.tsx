'use client';

/**
 * Thao tác chung của ba module tài sản — footer chung (docs/DETAIL_MODEL.md 3.2): trái `[Thao tác ▾]` (thao tác riêng của
 * module đứng đầu, rồi Swap · Gắn vào / Đổi cha · Tách khỏi cha · Đổi vị trí · Xóa), phải `[Sửa]` rồi nút riêng của module
 * (Ghi nhận hiệu chuẩn) và `[Check-out]` / `[Check-in]` ngoài cùng.
 */
import { ArrowLeftRight, Link2, LogIn, LogOut, MapPin, QrCode, Trash2, Unlink } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ActionCtx, ActionDef } from '@/components/ui/record/RecordModal';
import { ASSET_ROUTE, parentOf, type AssetRecord } from './api';
import { ChangeLocationScreen, DeleteAssetScreen, DetachScreen, MoveScreen, SwapScreen, UsageScreen } from './screens';
import type { AssetType } from '@/lib/types';

/** ActionCtx<R> → ActionCtx<AssetRecord>: các màn hình chung chỉ cần các trường chung của ba loại tài sản. */
const asCtx = (c: unknown) => c as ActionCtx<AssetRecord>;

export function assetActions<R extends AssetRecord>({ type, t, isAdmin, extra = [] }: {
  type: AssetType;
  t: TFunction;
  isAdmin: boolean;
  /** Thao tác riêng của module, đứng đầu danh sách (Thêm thiết bị con) hoặc nút phải đứng trước Check-out (`primary`: Ghi nhận hiệu chuẩn). */
  extra?: ActionDef<R>[];
}): ActionDef<R>[] {
  const hasParent = (r: R) => !!parentOf(type, r);
  const icon = (node: typeof Link2) => { const Icon = node; return <Icon size={14} aria-hidden="true" />; };
  return [
    ...extra,
    { key: 'swap', label: t('eq.swap'), icon: icon(ArrowLeftRight), screen: (c) => <SwapScreen type={type} ctx={asCtx(c)} /> },
    { key: 'attach', label: t(`asset.attach.${type}`), icon: icon(Link2), visible: (r) => !hasParent(r),
      screen: (c) => <MoveScreen type={type} ctx={asCtx(c)} /> },
    { key: 'move', label: t(`asset.changeParent.${type}`), icon: icon(Link2), visible: hasParent,
      screen: (c) => <MoveScreen type={type} ctx={asCtx(c)} /> },
    { key: 'detach', label: t(`asset.detach.${type}`), icon: icon(Unlink), visible: hasParent,
      screen: (c) => <DetachScreen type={type} ctx={asCtx(c)} /> },
    { key: 'location', label: t('eq.changeLocation'), icon: icon(MapPin), visible: (r) => !hasParent(r),
      screen: (c) => <ChangeLocationScreen type={type} ctx={asCtx(c)} /> },
    // Nhãn QR in được: mở ở tab mới (trang không có sidebar).
    { key: 'label', label: t('label.print'), icon: icon(QrCode),
      onClick: (r) => { window.open(`${ASSET_ROUTE[type]}/${r.id}/label`, '_blank', 'noopener'); } },
    { key: 'delete', label: t('common.delete'), icon: icon(Trash2), danger: true, visible: () => isAdmin,
      screen: (c) => <DeleteAssetScreen type={type} ctx={asCtx(c)} /> },
    { key: 'checkout', label: t('eq.checkOut'), icon: icon(LogOut), primary: true, visible: (r) => r.usage === 'not_in_use',
      screen: (c) => <UsageScreen type={type} ctx={asCtx(c)} /> },
    { key: 'checkin', label: t('eq.checkIn'), icon: icon(LogIn), primary: true, visible: (r) => r.usage === 'in_use',
      screen: (c) => <UsageScreen type={type} ctx={asCtx(c)} /> },
  ];
}
