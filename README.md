# Equipment Management

> **UI requirements for developers and AI assistants:** Read [docs/JABIL_UI.md](docs/JABIL_UI.md) before adding or changing UI. It defines the accepted branding, compact layout, shared components, themes and responsive behavior.

Web app nội bộ quản lý Tester / Base / Fixture, sub-equipment cần hiệu chuẩn và golden board, thay cách ghi chép bằng Excel.

Thiết kế nằm ngay trong repo: [docs/DATABASE_MODIFIED.md](docs/DATABASE_MODIFIED.md) (database), [docs/API.md](docs/API.md) (API), [docs/APP_SHELL.md](docs/APP_SHELL.md), [docs/DETAIL_MODEL.md](docs/DETAIL_MODEL.md) và [docs/JABIL_UI.md](docs/JABIL_UI.md) (giao diện), [docs/PERFORMANCE.md](docs/PERFORMANCE.md) (hiệu năng: vì sao nhanh / chậm, quy tắc giữ tốc độ, số đo). Đổi thiết kế thì sửa tài liệu trong `docs/` cùng lúc với code.

**Quy mô mục tiêu:** pilot 10–20 người, 1.000–2.000 thiết bị, Excel vẫn chạy song song.

---

## Tình trạng hiện tại (v2)

Database, tầng server và giao diện (một hệ thống modal) của mô hình tài sản mới đã xong; còn dọn dẹp và kiểm thử trên dữ liệu thật.

| Phần | Trạng thái |
|---|---|
| Database | **Xong.** 18 bảng, nhật ký tài sản chung (`asset_logs`), cây Tester ⊃ Base ⊃ Fixture + sub-equipment + golden board, 6 hàm thao tác dùng chung có `p_dry_run` — [docs/DATABASE_MODIFIED.md](docs/DATABASE_MODIFIED.md) |
| Đăng nhập, tài khoản | **Xong.** Chỉ Supabase Auth, Admin tạo tài khoản, mật khẩu tạm đổi ở lần đầu, khóa / mở khóa, bốn thao tác Admin ở User Management |
| Configuration | **Xong.** 8 danh sách + Error log (chỉ Admin) |
| Dashboard | **Xong.** Status theo loại tài sản, Calibration Status, quá hạn / sắp đến hạn, theo thẻ / vị trí / loại, thay đổi gần đây |
| API tài sản | **Xong.** Equipment, Calibration (sub-equipment + lần hiệu chuẩn), Golden, Overview, thao tác cây dùng chung, Import Excel — [docs/API.md](docs/API.md) |
| Giao diện | **Xong.** Equipment, Calibration, Golden, Configuration, User Management dùng chung Masterlist full chiều rộng + một modal (S / M / L), điện thoại toàn màn hình — [docs/DETAIL_MODEL.md](docs/DETAIL_MODEL.md). Chưa chạy thử trong trình duyệt với dữ liệu thật |
| Overview | **Xong (chưa chạy thử với dữ liệu thật).** Bảng thẻ theo Location (mỗi cột một tài sản gốc, tối đa 3 thẻ kể cả thẻ gốc), một hàm `overview_board` — [docs/DETAIL_MODEL.md](docs/DETAIL_MODEL.md) mục 4.6, [docs/DATABASE_MODIFIED.md](docs/DATABASE_MODIFIED.md) mục 2 |

Chưa làm: module Repair.

---

## Chạy trên máy

Dùng Node.js 24.9 trở lên.

```bash
npm ci
npm run dev -- --hostname 127.0.0.1
```

Mở địa chỉ Local mà Next.js in ra khi báo Ready (thường là http://127.0.0.1:3000).

- Giữ `.env.local` cũ là dùng lại đúng Supabase project và tài khoản — đổi máy không cần chạy lại SQL hay tạo lại admin.
- Không chép `node_modules` hoặc `.next` giữa Windows và macOS (chứa thư viện / file build theo hệ điều hành) — mỗi máy tự `npm ci`.
- Chậm? Đọc [docs/PERFORMANCE.md](docs/PERFORMANCE.md) mục 5: nên đặt dự án **ngoài OneDrive**, và đánh giá tốc độ bằng `npm run build` + `npm run start` (dev biên dịch từng trang ở lần mở đầu). `npm run bench` đo tầng server trên Supabase thật (chỉ đọc).
- Không chạy `npm run build` trong lúc `npm run dev` đang chạy: hai lệnh dùng chung thư mục `.next` và làm hỏng nhau. Lỡ chạy thì tắt dev server, xóa `.next`, chạy lại `npm run dev`.

## Chạy lần đầu

```bash
npm install
cp .env.example .env.local     # điền 3 giá trị từ Supabase → Project Settings → API
```

Ba biến: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Secret key / `service_role`, giữ bí mật). **Cả ba phải của cùng một project** — lệch project thì Supabase báo "Invalid API key".

### 1. Database

Chạy lần lượt trên Supabase SQL Editor của project **trống** — chi tiết và cách kiểm tra ở [database/README.md](database/README.md):

```
database/01_reset_blank.sql   ← tùy chọn (project mới thì bỏ qua): XÓA SẠCH schema public
database/02_schema.sql        ← tạo 18 bảng
database/03_seed.sql          ← 3 loại hệ thống Tester / Base / Fixture
database/04_functions.sql     ← nghiệp vụ: nhật ký tự động, cây tài sản, hàm thao tác, view
```

### 2. Cài đặt Supabase Dashboard

Tắt public sign-up, tắt email confirmation, nâng rate limit đăng nhập — [database/README.md](database/README.md#cài-đặt-supabase-dashboard). Bắt buộc: publishable key là công khai, để mở sign-up thì ai cũng tạo được user Auth.

### 3. Admin đầu tiên

```bash
npm run seed:admin -- ten.dang.nhap "Họ và tên" [mã nhân viên]
```

In **mật khẩu tạm** dạng `Jabil-4827` một lần. Đăng nhập bằng username; app bắt đổi mật khẩu ngay lần đầu.

### 4. Chạy

```bash
npm run dev
curl localhost:3000/api/health
```

---

## Kiểm tra

```bash
npm run lint
npm run typecheck
npm test          # vitest: service, auth, API client, import Excel + smoke test giao diện (jsdom) — không cần database
npm run build
```

Test database (dựng 02 → 03 → 04 trên PGlite, từng trigger / hàm, kể cả dry run khớp lần gọi thật):

```bash
npm i --no-save @electric-sql/pglite
node database/tests/assets.test.mjs
```

---

## Bốn thứ không được phá

Đây là những quyết định mà vi phạm sẽ không báo lỗi ngay nhưng sẽ hỏng về sau.

### 1. Không route nào export handler trần

```ts
export const POST = withAuth(handler, { role: EDITORS });
```

`service_role` bypass RLS hoàn toàn, nên RLS **không** bảo vệ được rủi ro "quên check quyền trong một route". `withAuth` là lớp bảo vệ thật. Kiểm tra:

```bash
grep -rLn "withAuth" app/api --include=route.ts     # phải rỗng
```

### 2. `service_role` key chỉ đọc ở đúng một file

`lib/supabase/admin.ts`. Ba lớp chặn: `import 'server-only'` (build fail nếu lọt vào client bundle) → ESLint `no-restricted-imports` → không có tiền tố `NEXT_PUBLIC_`.

### 3. Mọi function trong database phải có `revoke` + `grant`

PostgreSQL mặc định `GRANT EXECUTE` cho `PUBLIC`. Không có khối `revoke` / `grant` ở cuối `database/02_schema.sql` và `database/04_functions.sql`, bất kỳ ai có publishable key (nằm công khai trong bundle frontend) đều gọi được `app_write` / `asset_*` và bypass toàn bộ tầng phân quyền.

### 4. Không dùng API riêng của Vercel

Nguyên tắc portability. Không `Vercel KV / Blob / Postgres / Cron`, không Edge Runtime cho business logic. Cron đặt ở GitHub Actions.

Tuân thủ đúng thì rời Vercel = viết một Dockerfile + đổi env ≈ 1 ngày công. Vi phạm thì con số đó thành vài tuần. `output: 'standalone'` đã bật sẵn.

---

## Ba điều dễ hiểu nhầm trong code

**Nhật ký do database ghi, không phải server.** Trigger `write_history` ghi vào `asset_logs` (equipment, sub-equipment, golden board, lần hiệu chuẩn), `configuration_histories`, `user_histories` trong cùng giao dịch với thay đổi. Server chỉ ghi qua `app_write` và các hàm `asset_*` (kèm người thao tác, hành động, ghi chú) — đừng tự insert dòng nhật ký.

**Đổi cha / vị trí / Status của tài sản luôn đi qua hàm `asset_*`.** Một bộ 6 hàm dùng chung cho cả ba loại tài sản (`asset_change_location`, `asset_move`, `asset_detach`, `asset_swap`, `asset_delete`, `asset_set_usage`, tham số `p_type`): cả cây con luôn đi theo, trong một giao dịch, và mọi hàm có `p_dry_run` cho màn hình xem trước. `PUT /api/equipment/{id}` nhận `parent_id` / `location_id` nhưng chuyển sang các hàm này (sau khi chạy thử) thay vì ghi thẳng. Thiết bị có cha thì vị trí theo cha (`LOCATION_INHERITED_READ_ONLY`).

**Lỗi trả về theo mã, chữ hiển thị nằm ở client.** API trả `{ code, message, details, request_id }`; `errorMessage()` (`lib/client/api.ts`) đổi `code` thành câu theo ngôn ngữ đang chọn (`src/i18n/locales/*.json` › `errors`). Thêm mã lỗi mới ở `lib/errors` thì thêm cả câu EN / VI — `lib/client/api.test.ts` báo thiếu.

---

## Vận hành

| Việc | Ở đâu |
|---|---|
| Backup | `.github/workflows/backup.yml` — cần secret `SUPABASE_DB_URL` |
| Chống Supabase pause | `.github/workflows/keepalive.yml` — cần variable `APP_URL` |
| Tra lỗi user báo lại | Configuration → Hệ thống → Error log, tìm theo `request_id` |
| Lấy dữ liệu ra | **Xuất Excel** trên Masterlist từng module; bản sao lưu hằng ngày (RUNBOOK mục 7) |
| Quy trình sự cố | [RUNBOOK.md](RUNBOOK.md) |

Log Vercel Hobby chỉ giữ ~1 giờ, nên `error_log` trong DB mới là nơi điều tra lỗi cũ. Lỗi 4xx không vào `error_log` — câu báo trên màn hình đã nói lý do; khi chạy `npm run dev`, terminal in thêm mã và lý do.

**Backup chưa restore thử là backup chưa tồn tại.** Phải test restore ít nhất 1 lần trước khi cho user vào (RUNBOOK mục 7).

---

## Giao diện

| Màn hình | Đường dẫn | Ai vào được |
|---|---|---|
| Đăng nhập | `/login` | Mọi người |
| Đổi mật khẩu | `/change-password` (bắt buộc ở lần đầu và sau khi Admin đặt lại) | Tài khoản đã đăng nhập |
| Dashboard | `/` | Mọi nhóm |
| Overview | `/overview` | Mọi nhóm |
| Equipment | `/equipment`, `/equipment?id=…`; nhãn QR `/equipment/{id}/label` | Mọi nhóm |
| Sub-Equipment | `/calibration`, `/calibration?id=…`; nhãn QR `/calibration/{id}/label` | Mọi nhóm |
| Golden | `/golden`, `/golden?id=…`; nhãn QR `/golden/{id}/label` | Mọi nhóm |
| Configuration | `/configuration/{danh sách}`, `/configuration/error-log` | Admin |
| User Management | `/users`, `/users?id=…` | Admin |

Đường dẫn cũ `/equipment/{id}`, `/calibration/{id}`, `/golden/{id}`, `/users/{id}` chuyển sang `?id=` (nhãn QR đã in vẫn dùng được). Màu, font, kích thước, sáng / tối và điện thoại theo [docs/JABIL_UI.md](docs/JABIL_UI.md).

---

## Việc còn lại trước khi mở pilot

1. Chạy thử giao diện trong trình duyệt với dữ liệu thật (đăng nhập → Equipment → Sub-Equipment → Golden → Overview → Configuration → User Management) và sửa những gì phát hiện.
2. Khôi phục thử bản sao lưu vào project dev (RUNBOOK mục 7).
3. Nhập dữ liệu Excel đang dùng bằng Import Excel của từng module (file mẫu tải trên giao diện).
4. Module Repair (Sửa chữa) — chưa thiết kế.
5. Nâng cấp database đang có dữ liệu cho Overview dạng thẻ: chạy lại `database/04_functions.sql` (thêm `overview_board` và `asset_tree`) → chạy app mới → **sau đó** chạy `database/migrations/2026-10-09_overview_board.sql` (bỏ hai hàm cũ mà app cũ còn gọi).

---

## Tài khoản

Chỉ có **Supabase Auth**, do **Admin tạo** — không tự đăng ký, không duyệt / từ chối, không thông báo. Chi tiết ở [docs/DATABASE_MODIFIED.md](docs/DATABASE_MODIFIED.md) mục 8.

- Đăng nhập bằng **username** (chữ thường không dấu, số và `. _ + -`). Server đổi thành email nội bộ `<username>@jabil.local` để nhờ Supabase Auth kiểm tra mật khẩu — không gửi email, người dùng không thấy email này.
- Admin **Thêm** tài khoản: hệ thống sinh **mật khẩu tạm** dạng `Jabil-4827`, hiện **một lần** kèm nút sao chép; người dùng phải tự đặt mật khẩu mới ở lần đăng nhập đầu (`/change-password`). **Đặt lại mật khẩu** cũng vậy. Người dùng tự đổi mật khẩu bất cứ lúc nào ở menu tài khoản; việc này không ghi lịch sử.
- **Khóa / Mở khóa**: `is_active` + `ban_duration` ở Supabase Auth; server kiểm tra `is_active` ở mọi request nên khóa có hiệu lực ngay. Tài khoản không bao giờ bị xóa — còn được tham chiếu trong lịch sử.
- Chỉ bốn thao tác Admin: Thêm, Sửa, Đặt lại mật khẩu, Khóa / Mở khóa. Admin không tự khóa / hạ quyền mình (`ADMIN_SELF_CHANGE`) và luôn phải còn ít nhất một Admin đang hoạt động (`LAST_ADMIN`) — database chặn ở mọi đường ghi.
- Nhóm quyền ([lib/permissions/index.ts](lib/permissions/index.ts)): **Admin** — mọi thứ; **User** — xem, thêm, sửa, không xóa, không vào Configuration / User Management; **Readonly** — xem, tìm kiếm, xuất Excel. API kiểm tra lại quyền ở mọi request (`withAuth`), không dựa vào việc ẩn nút.
- Quyền vào app luôn dựa vào `user_profiles` (có dòng và `is_active`), không bao giờ chỉ dựa vào việc đăng nhập Supabase thành công.
- Có giới hạn số lần đăng nhập sai trên mỗi instance (bổ sung cho giới hạn của Supabase Auth), không phải rate limit dùng chung toàn hệ thống.
- Chưa có "quên mật khẩu" tự phục vụ: Admin đặt lại mật khẩu ở User Management (RUNBOOK mục 1). Hệ thống không gửi email.
