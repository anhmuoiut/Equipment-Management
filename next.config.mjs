/** @type {import('next').NextConfig} */
const nextConfig = {
  // Portability: 'standalone' cho phép build thành container bất cứ lúc nào: rời Vercel
  // = viết một Dockerfile + đổi env, không phải viết lại kiến trúc.
  output: 'standalone',
  reactStrictMode: true,
  // undici: bộ máy bên dưới fetch của Node, cấu hình ở instrumentation.ts (lib/server/connections.ts) — chạy từ node_modules, không đóng gói.
  serverExternalPackages: ['undici'],
  eslint: { dirs: ['app', 'lib', 'components', 'scripts'] },
};
export default nextConfig;
