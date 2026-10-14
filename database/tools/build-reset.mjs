// Sinh database/tools/reset_after_testing.sql = reset_after_testing.template.sql + phần thân của database/seed.sql.
// Chạy lại mỗi khi sửa seed.sql:   node database/tools/build-reset.mjs
// Thêm `--check` để chỉ kiểm tra file đã sinh có khớp seed.sql hiện tại không (thoát mã 1 nếu lệch).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const lf = (s) => s.replace(/\r\n/g, '\n');
const seed = lf(readFileSync(join(dir, '..', 'seed.sql'), 'utf8'));
const template = lf(readFileSync(join(dir, 'reset_after_testing.template.sql'), 'utf8'));

// Phần thân seed: bỏ phần chú thích đầu file, `begin;` và `commit;` (reset đã nằm trong giao dịch của nó).
const open = seed.indexOf('\nbegin;\n');
const close = seed.lastIndexOf('\ncommit;');
if (open < 0 || close < 0) throw new Error('seed.sql phải có begin; ... commit;');
const body = seed.slice(open + '\nbegin;\n'.length, close).trim();

if (!template.includes('-- @@SEED@@')) throw new Error('template thiếu dòng -- @@SEED@@');
const out = template.replace('-- @@SEED@@', body);
const target = join(dir, 'reset_after_testing.sql');

if (process.argv.includes('--check')) {
  let current = '';
  try { current = lf(readFileSync(target, 'utf8')); } catch { /* chưa có */ }
  if (current !== out) { console.error('reset_after_testing.sql không khớp seed.sql — chạy: node database/tools/build-reset.mjs'); process.exit(1); }
  console.log('reset_after_testing.sql khớp seed.sql');
} else {
  writeFileSync(target, out);
  console.log(`reset_after_testing.sql đã sinh (${out.split('\n').length} dòng, seed ${body.split('\n').length} dòng)`);
}
