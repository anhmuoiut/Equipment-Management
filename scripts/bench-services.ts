/**
 * bench-services — đo tốc độ của tầng server trên Supabase THẬT, CHỈ ĐỌC (không ghi gì). Để biết một thay đổi làm nhanh hay chậm đi.
 *
 * Chạy (từ thư mục Equipment-Management-System):
 *   npm run bench
 *
 * In: thời gian một vòng mạng tới Supabase, chuỗi xác thực của MỘT request (lần lượt vs song song — xem lib/auth/session.ts) và
 * thời gian trung vị của các dịch vụ chính khi dữ liệu gốc đã được nhớ (trạng thái bình thường) và ngay sau một lần ghi
 * (lookupCache.ts đọc lại 9 bảng một lần). Mỗi số là trung vị của 7 lần chạy; "http" là số request gửi tới Supabase và "KB" là số byte
 * (đã giải nén) các phản hồi đó mang về — lượng dữ liệu server kéo từ Supabase cho MỘT lời gọi, cơ sở để ước lượng egress của Supabase.
 * Giải thích số liệu: docs/ARCHITECTURE.md.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error('Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (.env.local).');

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
let httpCalls = 0;
let httpBytes = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  httpCalls++;
  const response = await realFetch(...args);
  // Đếm thân phản hồi trên một bản sao; bản gốc vẫn nguyên cho supabase-js đọc.
  httpBytes += (await response.clone().arrayBuffer()).byteLength;
  return response;
}) as typeof fetch;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function bench(name: string, run: () => Promise<unknown>, rounds = 7, before?: () => void) {
  const ms: number[] = [];
  let calls = 0;
  let bytes = 0;
  for (let i = 0; i < rounds; i++) {
    before?.();
    const startCalls = httpCalls;
    const startBytes = httpBytes;
    const start = performance.now();
    await run();
    ms.push(performance.now() - start);
    calls = httpCalls - startCalls;
    bytes = httpBytes - startBytes;
  }
  console.log(`${name.padEnd(46)} trung vị ${median(ms).toFixed(0).padStart(5)} ms   (min ${Math.min(...ms).toFixed(0)}, max ${Math.max(...ms).toFixed(0)})   http ${calls}   ${(bytes / 1024).toFixed(1).padStart(7)} KB`);
}

// Hai vòng mạng của một request API: Auth (getUser) + đọc hồ sơ (PostgREST). Gọi bằng fetch gốc nên không tính vào "http".
const authRoundTrip = () => realFetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: 'Bearer invalid' } }).then((r) => r.text());
const profileRead = () => realFetch(`${supabaseUrl}/rest/v1/user_profiles?select=username,role,is_active&limit=1`, { headers }).then((r) => r.text());

async function main() {
  await authRoundTrip();
  console.log('--- chuỗi xác thực của một request');
  await bench('getUser rồi mới đọc hồ sơ (lần lượt, cách cũ)', async () => { await authRoundTrip(); await profileRead(); });
  await bench('getUser ‖ đọc hồ sơ (song song, hiện tại)', async () => { await Promise.all([authRoundTrip(), profileRead()]); });

  const { invalidateLookups } = await import('../lib/services/core/lookupCache');
  const { loadLookups } = await import('../lib/services/core/lookups');
  const { listEquipment, getEquipment, equipmentTree, EQUIPMENT_LIST } = await import('../lib/services/equipment');
  const { listSubEquipment, SUB_EQUIPMENT_LIST } = await import('../lib/services/calibration');
  const { listGolden, GOLDEN_LIST } = await import('../lib/services/golden');
  const { getDashboard, recentActivities } = await import('../lib/services/dashboard');
  const { parseListParams } = await import('../lib/services/core/listQuery');

  // Danh sách phân trang: mỗi lời gọi đọc MỘT trang (query giống hệt tham số URL của route).
  const params = (spec: Parameters<typeof parseListParams>[1], query: string) => parseListParams(new URLSearchParams(query), spec);
  const first = await listEquipment(params(EQUIPMENT_LIST, ''));
  const one = first.rows.find((r) => r.parent_id) ?? first.rows[0];

  console.log('\n--- dịch vụ, dữ liệu gốc đã được nhớ (trạng thái bình thường)');
  await bench('GET /api/options', () => loadLookups());
  await bench('GET /api/equipment (trang 1, 50 dòng)', () => listEquipment(params(EQUIPMENT_LIST, '')));
  await bench('GET /api/equipment (trang 2)', () => listEquipment(params(EQUIPMENT_LIST, 'page=2')));
  await bench('GET /api/equipment (tìm "a", sắp xếp serial)', () => listEquipment(params(EQUIPMENT_LIST, 'q=a&sort=serial_number')));
  await bench('GET /api/equipment (xuất Excel: mọi dòng)', () => listEquipment(params(EQUIPMENT_LIST, 'pageSize=all')), 3);
  if (one) {
    await bench('GET /api/equipment/:id (một bản ghi)', () => getEquipment(one.id));
    await bench('GET /api/equipment/:id/tree', () => equipmentTree(one.id));
  }
  await bench('GET /api/calibration (trang 1, 50 dòng)', () => listSubEquipment(params(SUB_EQUIPMENT_LIST, '')));
  await bench('GET /api/calibration (lọc nhanh Overdue)', () => listSubEquipment(params(SUB_EQUIPMENT_LIST, 'quick=overdue')));
  await bench('GET /api/golden (trang 1, 50 dòng)', () => listGolden(params(GOLDEN_LIST, '')));
  await bench('GET /api/dashboard (số liệu)', () => getDashboard());
  await bench('GET /api/dashboard/activities (50 thao tác)', () => recentActivities('admin', { limit: 50 }));

  console.log('\n--- ngay sau một lần ghi (dữ liệu gốc đọc lại một lần)');
  await bench('GET /api/equipment (sau khi ghi)', () => listEquipment(params(EQUIPMENT_LIST, '')), 5, invalidateLookups);
  console.log(`\nTổng số dòng equipment (khớp bộ lọc hiện tại): ${first.total}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
