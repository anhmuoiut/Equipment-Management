import type { Metadata, Viewport } from 'next';
import './globals.css';
import './brand.css';
import { PreferencesProvider } from '@/components/Preferences';

export const metadata: Metadata = {
  title: 'Jabil | SolarEdge Equipment Management',
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
        {/* Chủ đề / ngôn ngữ đặt trước khi vẽ (không nháy), rồi nạp font.
            Font nạp bằng script thay vì <link rel="stylesheet"> trong <head>: stylesheet do trình duyệt đọc ra từ HTML CHẶN việc vẽ trang
            cho tới khi fonts.googleapis.com trả lời (~0,3–0,8 s mỗi lần mở trang, lâu hơn nhiều nếu mạng công ty chậm / chặn) — stylesheet
            do script thêm thì không chặn. Chữ hiện ngay bằng font dự phòng, đổi sang IBM Plex khi font về (display=swap). Nạp qua link
            thay vì next/font để build không phụ thuộc mạng. IBM Plex được thiết kế cho ngữ cảnh kỹ thuật — chọn có chủ đích. */}
        <script dangerouslySetInnerHTML={{ __html: `try { const theme = localStorage.getItem('equipment-theme'); const language = localStorage.getItem('equipment-language'); document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'; document.documentElement.lang = language === 'vi' ? 'vi' : 'en'; } catch {}
try { const font = document.createElement('link'); font.rel = 'stylesheet'; font.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'; document.head.appendChild(font); } catch {}` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body><PreferencesProvider>{children}</PreferencesProvider></body>
    </html>
  );
}
