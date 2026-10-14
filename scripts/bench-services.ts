/**
 * bench-services — đo tốc độ của tầng server trên Supabase THẬT, CHỈ ĐỌC (không ghi gì). Để biết một thay đổi làm nhanh hay chậm đi.
 *
 * Chạy (từ thư mục Equipment-Management-System):
 *   npm run bench
 *
 * In: thời gian một vòng mạng tới Supabase, chuỗi xác thực của MỘT request (lần lượt vs song song — xem lib/auth/session.ts) và
 * thời gian trung vị của các dịch vụ chính khi dữ liệu gốc đã được nhớ (trạng thái bình thường) và ngay sau một lần ghi
 * (lookupCache.ts đọc lại 9 bảng một lần). Mỗi số là trung vị của 7 lần chạy; "http" là số request gửi tới Supabase.
 * Giải thích số liệu: docs/ARCHITECTURE.md.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error('Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (.env.local).');

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
let httpCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof fetch>) => { httpCalls++; return realFetch(...args); }) as typeof fetch;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function bench(name: string, run: () => Promise<unknown>, rounds = 7, before?: () => void) {
  const ms: number[] = [];
  let calls = 0;
  for (let i = 0; i < rounds; i++) {
    before?.();
    const startCalls = httpCalls;
    const start = performance.now();
    await run();
    ms.push(performance.now() - start);
    calls = httpCalls - startCalls;
  }
  console.log(`${name.padEnd(46)} trung vị ${median(ms).toFixed(0).padStart(5)} ms   (min ${Math.min(...ms).toFixed(0)}, max ${Math.max(...ms).toFixed(0)})   http ${calls}`);
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
  const { listEquipment, getEquipment, equipmentTree } = await import('../lib/services/equipment');
  const { listSubEquipment } = await import('../lib/services/calibration');
  const { listGolden } = await import('../lib/services/golden');
  const { getDashboard } = await import('../lib/services/dashboard');

  const equipment = await listEquipment();
  const one = equipment.find((r) => r.parent_id) ?? equipment[0];

  console.log('\n--- dịch vụ, dữ liệu gốc đã được nhớ (trạng thái bình thường)');
  await bench('GET /api/options', () => loadLookups());
  await bench('GET /api/equipment (danh sách)', () => listEquipment());
  if (one) {
    await bench('GET /api/equipment/:id (một bản ghi)', () => getEquipment(one.id));
    await bench('GET /api/equipment/:id/tree', () => equipmentTree(one.id));
  }
  await bench('GET /api/calibration (danh sách)', () => listSubEquipment());
  await bench('GET /api/golden (danh sách)', () => listGolden());
  await bench('GET /api/dashboard', () => getDashboard());

  console.log('\n--- ngay sau một lần ghi (dữ liệu gốc đọc lại một lần)');
  await bench('GET /api/equipment (sau khi ghi)', () => listEquipment(), 5, invalidateLookups);
  console.log(`\nSố dòng equipment: ${equipment.length}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
