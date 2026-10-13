/** @type {import('next').NextConfig} */
const nextConfig = {
  // Portability: 'standalone' cho phép build thành container bất cứ lúc nào: rời Vercel
  // = viết một Dockerfile + đổi env, không phải viết lại kiến trúc.
  output: 'standalone',
  reactStrictMode: true,
  // Chỉ ảnh hưởng `next dev`: mặc định Next chỉ tin localhost, mở bằng 127.0.0.1 thì trang không hydrate và form đăng nhập bị gửi như GET.
  allowedDevOrigins: ['127.0.0.1'],
  // undici: bộ máy bên dưới fetch của Node, cấu hình ở instrumentation.ts (lib/server/connections.ts) — chạy từ node_modules, không đóng gói.
  serverExternalPackages: ['undici'],
};
export default nextConfig;
