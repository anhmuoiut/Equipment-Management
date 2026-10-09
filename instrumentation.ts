/**
 * Chạy MỘT lần khi server Next.js khởi động (`next dev` / `next start` / standalone). Chỉ ở runtime Node — middleware chạy ở Edge
 * không dùng file này. Phải đúng dạng `if (NEXT_RUNTIME === 'nodejs') { await import(…) }`: chỉ dạng này Next mới cắt khỏi bản Edge
 * (nếu không, bản Edge cố đóng gói `undici` và build lỗi "node:" scheme).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
