import { redirect } from 'next/navigation';

/** Link cũ: chuyển sang trang với ?id= — modal tài khoản mở theo id (docs/DETAIL_MODEL.md mục 3.9). */
export default async function LegacyUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/users?id=${encodeURIComponent(id)}`);
}
