import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/auth/pageSession';
import { AppShell } from '@/components/AppShell';
import '../workspace.css';
import '../mobile-workspace.css';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePageViewer();
  // Mật khẩu do admin đặt (tài khoản mới / đặt lại): người dùng tự đổi trước khi làm gì khác.
  if (viewer.mustChangePassword) redirect('/change-password');
  return (
    <AppShell userId={viewer.userId} username={viewer.username} fullName={viewer.fullName} role={viewer.role}>
      {children}
    </AppShell>
  );
}
