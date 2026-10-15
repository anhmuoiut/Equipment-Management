import type { Metadata, Viewport } from 'next';
import './globals.css';
import './brand.css';
import { PreferencesProvider } from '@/components/Preferences';

export const metadata: Metadata = {
  title: 'Equipment Management',
  description: 'Test Engineering - SolarEdge workcell'
};

/**
 * `resizes-content`: when the on-screen keyboard opens, the page (and the fixed
 * bottom bars of the Detail Panel) shrink above it instead of hiding behind it
 * (Chrome / Android; iOS Safari ignores it). Zoom stays allowed.
 */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Đặt chủ đề / ngôn ngữ trước khi vẽ, rồi nạp Inter mà không chặn hiển thị.
            display=swap giữ chữ hiện bằng font dự phòng trong lúc tải; build không phụ thuộc mạng. */}
        <script dangerouslySetInnerHTML={{ __html: `try { const theme = localStorage.getItem('equipment-theme'); const language = localStorage.getItem('equipment-language'); document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'; document.documentElement.lang = language === 'vi' ? 'vi' : 'en'; } catch {}
try { const font = document.createElement('link'); font.rel = 'stylesheet'; font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'; document.head.appendChild(font); } catch {}` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body><PreferencesProvider>{children}</PreferencesProvider></body>
    </html>
  );
}
