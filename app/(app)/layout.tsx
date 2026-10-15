import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/auth/pageSession';
import { loadLookups, toOptions } from '@/lib/services/core/lookups';
import { AppShell } from '@/components/AppShell';
import '../workspace.css';
import '../mobile-workspace.css';
import '../pager.css';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Danh sách chọn đọc song song với xác thực (nhớ trong tiến trình — thường 0 lần gọi Supabase) và đưa thẳng xuống AppShell,
  // thay cho một request /api/options sau khi trang tải. Cùng dữ liệu mà /api/options trả cho mọi nhóm quyền. Đọc lỗi thì bỏ qua:
  // trang vẫn mở và các form tự gọi /api/options như trước (không để lỗi đọc danh sách làm hỏng cả trang).
  const [viewer, lookups] = await Promise.all([requirePageViewer(), loadLookups().catch(() => null)]);
  // Mật khẩu do admin đặt (tài khoản mới / đặt lại): người dùng tự đổi trước khi làm gì khác.
  if (viewer.mustChangePassword) redirect('/change-password');
  return (
    <AppShell userId={viewer.userId} username={viewer.username} fullName={viewer.fullName} role={viewer.role} options={lookups ? toOptions(lookups) : undefined}>
      {children}
    </AppShell>
  );
}
