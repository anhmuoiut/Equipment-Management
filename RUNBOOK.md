# RUNBOOK

Quy trình xử lý sự cố.

**Bus factor hiện tại = 1.** File này tồn tại để khi người viết code nghỉ phép, người khác vẫn xử lý được. Ưu tiên làm trên giao diện; SQL chỉ dùng khi giao diện không vào được.

Chạy SQL ở: Supabase Dashboard → SQL Editor (chọn đúng **production**, không phải dev). Mọi lệnh sửa dữ liệu đi qua `public.app_write(...)` hoặc các hàm `asset_*` để nhật ký vẫn được ghi — không `update` / `delete` thẳng vào bảng. Thiết kế database: [database/README.md](database/README.md).

Tài khoản chỉ có một loại: **Supabase Auth**, do Admin tạo. Mỗi tài khoản có một user ở `auth.users` (email nội bộ `<username>@jabil.local`, mật khẩu do Supabase giữ) và một dòng ở `public.user_profiles` (cùng `id`). Hệ thống không gửi email — mật khẩu tạm do Admin báo cho người dùng qua kênh nội bộ.

---

## 1. Đặt lại mật khẩu

Giao diện: **User Management** → mở tài khoản → **Thao tác ▾ → Đặt lại mật khẩu** → xác nhận. Hệ thống sinh **mật khẩu tạm** dạng `Jabil-4827` và hiện **một lần** (có nút sao chép) — chuyển cho người đó. Họ phải tự đặt mật khẩu mới ở lần đăng nhập tới; từ lúc đặt lại, mọi trang / API của họ đòi đổi mật khẩu trước. Lịch sử tài khoản ghi `PASSWORD_RESET`. Làm được cả với tài khoản đang bị khóa.

Lỡ đóng màn hình mật khẩu tạm khi chưa chép: đặt lại lần nữa.

Admin không đặt lại mật khẩu của chính mình ở đây — tự đổi ở menu tài khoản (góc phải trên) → **Cài đặt tài khoản → Đổi mật khẩu**.

**Admin duy nhất quên mật khẩu** (không ai vào được User Management), một trong hai cách:

- Tạo một Admin khác ngay trên máy có `.env.local` của production, rồi dùng nó đặt lại mật khẩu cho tài khoản cũ trên giao diện:

  ```bash
  npm run seed:admin -- ten.moi "Họ và tên"
  ```

- Hoặc đặt mật khẩu mới thẳng ở Supabase Auth (đổi `ten.dang.nhap`), rồi bắt đổi ở lần đăng nhập tới:

  ```sql
  update auth.users
  set encrypted_password = crypt('MatKhauTam123', gen_salt('bf'))
  where email = 'ten.dang.nhap@jabil.local';

  select public.app_write('user_profiles', 'update', id,
    '{"must_change_password": true}'::jsonb, null, 'PASSWORD_RESET', 'runbook', 'script')
  from public.user_profiles where username = 'ten.dang.nhap';
  ```

---

## 2. Thêm tài khoản mới

Không có đăng ký tự phục vụ và không có bước duyệt: người cần tài khoản nhờ Admin.

Giao diện: **User Management → Thêm tài khoản** → nhập username (chữ thường không dấu, số và `. _ + -`; không đổi sau khi tạo), họ tên, mã nhân viên, phòng ban, nhóm quyền (mặc định Readonly) → Lưu. Màn hình **Mật khẩu tạm** hiện một lần; chuyển cho người dùng. Họ đăng nhập bằng username, đặt mật khẩu mới ngay lần đầu.

Khi giao diện không vào được: chạy lại `npm run seed:admin` chỉ dùng để tạo **Admin**; tài khoản thường thì tạo trong giao diện.

Nếu Thêm báo "username đã có" mà User Management không thấy: trong Supabase → Authentication → Users có thể còn user `<username>@jabil.local` không có hồ sơ (lần tạo trước dở dang) — xóa user đó ở Dashboard rồi Thêm lại.

---

## 3. Khóa / mở khóa tài khoản

Giao diện: **User Management** → mở tài khoản → **Thao tác ▾ → Khóa tài khoản** (mở lại: **Mở khóa tài khoản**; lọc nhanh **Đã khóa**). Khóa = `is_active = false` ở `user_profiles` + `ban_duration` ở Supabase Auth (chặn đăng nhập mới và làm mới phiên). Server kiểm tra `is_active` ở mọi request nên có hiệu lực ngay, kể cả khi phiên cũ còn hạn — người bị khóa bị đưa về trang đăng nhập.

Không tự khóa chính mình (`ADMIN_SELF_CHANGE`), và luôn phải còn ít nhất một Admin đang hoạt động (`LAST_ADMIN`) — database chặn ở mọi đường ghi.

Khi giao diện không vào được, cần làm **cả hai** bước:

```sql
-- 1) hồ sơ
select public.app_write('user_profiles', 'update', id,
  '{"is_active": false}'::jsonb, null, null, 'runbook', 'script')
from public.user_profiles where username = 'ten.dang.nhap';
-- mở lại: '{"is_active": true}'
```

2) Supabase Dashboard → Authentication → Users → mở user `ten.dang.nhap@jabil.local` → **Ban user** (mở lại: **Unban**). Chỉ làm bước 1 cũng đã đủ để chặn vào app (server kiểm tra `is_active`), nhưng người đó vẫn đăng nhập được vào Supabase Auth.

Không bao giờ xóa dòng trong `user_profiles` (`app_write` chặn sẵn; khóa ngoại `auth.users` là `restrict`) — tài khoản còn được tham chiếu bởi `created_by`, `updated_by` và lịch sử. Muốn chặn ai thì khóa.

---

## 4. Sửa một lần Đổi vị trí / Đổi cha / Swap bị nhầm

Không có "undo". Cách đúng là làm thao tác ngược lại — nhật ký ghi đủ cả hai lần.

1. Mở tài sản → tab **Lịch sử** để xem vị trí / cha / Status trước đó.
2. Trên chính tài sản đó: **Thao tác ▾ → Đổi cha** (về cha cũ), **Tách khỏi cha** (nếu trước đó không có cha) hoặc **Đổi vị trí**. Cả nhánh con luôn đi theo; màn hình xem trước (dry run) cho biết tài sản nào đổi Status (ví dụ In use → Not in use khi chuyển vào cha Not in use) trước khi bạn bấm xác nhận. Muốn con ở lại chỗ cũ thì Tách con đó khỏi cha trước.

Xem nhật ký bằng SQL (id lấy từ đường dẫn `/equipment?id=…` — serial được phép trùng nên đừng tìm theo serial):

```sql
select created_at, action, from_location, to_location, old_value, new_value, reason
  from public.asset_logs
 where asset_type = 'equipment' and asset_id = 'ID_TAI_SAN'
 order by created_at desc
 limit 10;
```

Tài sản đã xóa vẫn tra được theo serial: dòng `DELETE` trong `asset_logs` chụp lại cả dòng cũ (`old_value`).

---

## 5. Thêm / sửa danh sách chọn (Location, Part Number, Type, Thẻ, …)

Giao diện: **Configuration** (chỉ Admin) → chọn danh sách ở cột trái → **Thêm**, hoặc mở dòng → **Sửa**. `sort_order` quyết định thứ tự trong các ô chọn.

- Part Number, Location, Type, Level, Department, Hiệu chuẩn › Vendor: không xóa, chỉ **Thao tác ▾ → Ẩn**. Giá trị đã ẩn không chọn được nữa, nhưng bản ghi đang dùng vẫn hiện đúng (kèm "Đã ẩn"); **Hiện lại** khi cần.
- Thẻ và Hiệu chuẩn › Setup: xóa thật. Thẻ đang được gắn thì database chặn (`TAG_IN_USE`).
- **Type** của part number chỉ đổi được khi chưa thiết bị nào dùng part number đó (`PART_NUMBER_IN_USE`). Ba Type hệ thống (Tester, Base, Fixture) không ẩn, không xóa, không đổi nhóm; Type Admin thêm luôn thuộc nhóm sub-equipment.
- Hiệu chuẩn › **Setup**: mỗi part number sub-equipment một dòng với chu kỳ (tháng) và số ngày báo trước. `due_date` của **mỗi lần hiệu chuẩn** tự tính = ngày hiệu chuẩn + chu kỳ. Đổi chu kỳ chỉ áp dụng cho các lần ghi nhận **sau đó**; hạn đã tính không tự đổi. Part number chưa có Setup thì lần hiệu chuẩn phải nhập hạn bằng tay.

---

## 6. Tra lỗi người dùng báo lại

Lỗi hệ thống (5xx) hiện kèm **mã yêu cầu** (`req_…`) ngay trong thông báo — nhờ người dùng đọc hoặc chụp lại mã đó.

Giao diện: **Configuration → Hệ thống → Error log** → tìm theo mã yêu cầu, mở dòng để xem route, người dùng, message và stack.

```sql
select * from public.error_log where request_id = 'req_xxxxx';
```

`error_log` giữ 90 ngày (tự xóa bản ghi cũ hơn). Log của Vercel chỉ giữ khoảng 1 giờ, nên đây là nguồn chính để tra lỗi cũ.

Lỗi nghiệp vụ (4xx — thiếu chu kỳ hiệu chuẩn, trùng tên, không đủ quyền…) **không** vào `error_log`: thông báo trên màn hình đã nói đúng lý do. Khi chạy `npm run dev`, terminal in thêm mã và lý do của từng lỗi 4xx.

---

## 7. Khôi phục từ bản sao lưu

Bản sao lưu: GitHub → Actions → **Daily database backup** → mở lần chạy → artifact `db-backup-<id>` (giữ 30 ngày), bên trong là `eq-YYYY-MM-DD.sql.gz`. Workflow cần secret `SUPABASE_DB_URL` (connection string của production) — đặt ở GitHub, app không đọc biến này.

```bash
gunzip -c eq-YYYY-MM-DD.sql.gz | psql "$SUPABASE_DB_URL"
```

**Phải khôi phục thử vào project dev ít nhất một lần trước khi mở pilot.** Bản sao lưu chưa thử khôi phục là bản sao lưu chưa tồn tại.

Bản dump không chứa phân quyền (`--no-acl`). Nếu khôi phục vào một project Supabase **mới**, sau khi nạp dữ liệu chạy thêm khối phân quyền ở cuối `database/02_schema.sql`:

```sql
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant  all on all tables    in schema public to service_role;
grant  execute on all functions in schema public to service_role;
```

Tài khoản (`auth.users`) nằm ở schema `auth`: bản dump `public` không chứa. Khôi phục sang project mới thì phải tạo lại user Auth cho từng dòng `user_profiles` (cùng `id`) — hỏi người viết code trước khi làm.

---

## 8. Supabase project bị tạm dừng

Gói miễn phí tạm dừng project sau 1 tuần không hoạt động. **Không mất dữ liệu.**

Supabase Dashboard → project → nút Restore. Chờ vài phút.

Phòng ngừa: workflow `.github/workflows/keepalive.yml` gọi `/api/health` hằng ngày (cần variable `APP_URL`). Workflow theo lịch của GitHub tự tắt sau ~60 ngày repo không có hoạt động — nếu nghỉ dài, kiểm tra lại nó còn chạy không.

---

## 9. Xem hạn mức hằng tháng

Xem 1 lần/tháng. Cả bốn ngưỡng đều là tín hiệu **đi tối ưu**, không phải tín hiệu nâng gói.

| Chỉ số | Xem ở đâu | Ngưỡng | Nếu vượt |
|---|---|---|---|
| Vercel Active CPU | Vercel → Usage | 3 / 4 giờ | Tìm truy vấn lặp hoặc thiếu index |
| Supabase DB size | Supabase → Reports | 300 / 500 MB | Kiểm tra `asset_logs` và các bảng `*_histories` có phình bất thường |
| Supabase egress | Supabase → Reports | 3 / 5 GB | Masterlist tải đủ danh sách mỗi lần mở trang — vượt ngưỡng thì chuyển sang phân trang phía server |
| Vercel invocations | Vercel → Usage | 500k / 1M | Mỗi request API / mỗi lần mở trang gọi Supabase Auth một lần ở server (middleware chỉ gọi ở `/login` và trang nhãn — docs/PERFORMANCE.md mục 2.2) — kiểm tra có polling nào được thêm vào |

---

## 10. Làm lại database từ đầu

Chỉ làm trên **dev**. Trên production phải lấy dữ liệu ra trước: bản sao lưu ở mục 7, và/hoặc **Xuất Excel** trên Masterlist của từng module (xuất đúng các cột và dòng đang hiện — bấm **Xóa bộ lọc** và hiện đủ cột ở **Tùy chọn hiển thị** trước khi xuất).

Rồi làm theo `database/README.md`: chạy `01_reset_blank.sql` → `02_schema.sql` → `03_seed.sql` → `04_functions.sql`, kiểm tra cài đặt Dashboard (tắt sign-up…), tạo admin đầu tiên (`npm run seed:admin`), nhập lại Configuration, rồi nhập tài sản bằng **Import Excel** của từng module (tải file mẫu, điền, kiểm tra, Import — cả file trong một giao dịch). `01_reset_blank.sql` không đụng schema `auth`: user Auth cũ còn đó — xóa ở Dashboard (hoặc dùng username khác) trước khi tạo lại admin.

---

## Ba điều không được làm

**Không `update public.equipment` (hay `sub_equipment`, `golden_boards`) bằng tay để đổi `parent_id` / `tester_id`, `location_id` hoặc `usage`.** Sẽ bỏ qua việc kéo theo cả cây con, bỏ qua ghi nhật ký và làm dữ liệu lệch nhau. Luôn dùng giao diện hoặc các hàm `asset_move` / `asset_detach` / `asset_change_location` / `asset_swap` / `asset_set_usage` / `asset_delete`.

**Không sửa / xóa dòng trong `asset_logs` và các bảng `*_histories`.** Database chặn sẵn (`HISTORY_IS_APPEND_ONLY`); mọi thay đổi đều ghi thêm dòng mới.

**Không gỡ khối `revoke` / `grant` ở cuối `database/02_schema.sql` và `database/04_functions.sql`.** Không có nó, bất kỳ ai có publishable key — nằm công khai trong mã nguồn trang web — đều gọi thẳng được `app_write` / `asset_*` và bỏ qua toàn bộ tầng phân quyền.
