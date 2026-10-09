import { redirect } from 'next/navigation';

/** Link cũ (mã QR đã in): chuyển sang trang với ?id= — modal chi tiết mở theo id (docs/DETAIL_MODEL.md mục 3). */
export default async function LegacyRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/golden?id=${encodeURIComponent(id)}`);
}
