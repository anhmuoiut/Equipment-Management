# Database

Thiết kế: [docs/DATABASE_MODIFIED.md](../docs/DATABASE_MODIFIED.md). Thư mục này chứa các file SQL dựng database trên một Supabase project **trống**.

## Chạy theo thứ tự

Mở Supabase → **SQL Editor**, dán từng file vào rồi bấm **Run**:

| # | File | Làm gì | Bắt buộc |
| --- | --- | --- | --- |
| 1 | `01_reset_blank.sql` | Xóa sạch schema `public` (mọi bảng, view, function và **toàn bộ dữ liệu**). Không hoàn tác được, không đụng schema `auth`. Project mới trống thì bỏ qua cũng được. Kết quả kiểm tra cuối file phải ra 0 dòng | Không (project mới) |
| 2 | `02_schema.sql` | Tạo 18 bảng theo DATABASE_MODIFIED.md, bật RLS. `user_profiles.id` trỏ tới `auth.users`. Kết quả kiểm tra cuối file phải ra 18 `BASE TABLE` | Có |
| 3 | `03_seed.sql` | Dữ liệu hệ thống bắt buộc: 4 nhóm trong `type_groups` (Tester / Base / Fixture / Sub-equipment) và 3 loại Tester / Base / Fixture trong `types`. Chạy lại không bị trùng. Mọi dữ liệu khác (Type của sub-equipment, Part Number, Location, Level, Tag, Vendor…) Admin tự tạo ở Configuration | Có |
| 4 | `04_functions.sql` | Nghiệp vụ: nhật ký tự động vào `asset_logs`, `app_write`, bảo vệ Admin, quy tắc cây (Tester ⊃ Base ⊃ Fixture; sub-equipment, golden board), 6 hàm thao tác dùng chung cho cả 3 loại tài sản (`asset_change_location`, `asset_move`, `asset_detach`, `asset_swap`, `asset_delete`, `asset_set_usage`) + 3 hàm import, tất cả có `p_dry_run`; tra cứu `valid_parents` / `swap_candidates` / `serial_matches`; Type theo Part Number; Level theo thiết bị cha; quy tắc Usage; thẻ; tự tính `due_date`; view `sub_equipment_calibration`; `overview_board` (bảng thẻ theo Location cho trang Overview); view `recent_activities`. Kết quả kiểm tra cuối file (một dòng): `history_triggers = 14`, `type_triggers = 3`, `type_lock_triggers = 1`, `type_group_triggers = 2`, `tree_triggers = 3`, `level_triggers = 2`, `usage_rule_triggers = 3`, `tag_triggers = 4`, `serial_triggers = 3`, `calibration_triggers = 2`, `user_guard_triggers = 1`, `asset_ops = 6`, `asset_swap_args = 5`, `dry_run_functions = 9`, `lookup_functions = 3`, `overview_board = 1`, `views = 2`, `app_write = 1`, `equipment_import = 1`, `sub_equipment_import = 1`, `golden_import = 1`. Chạy lại được nhiều lần — file này đổi thì chạy lại (database đang có dữ liệu cũng không sao) | Có |
| 5 | Cài đặt Supabase Dashboard | Xem [Cài đặt Supabase Dashboard](#cài-đặt-supabase-dashboard) | Có |
| 6 | Tạo admin đầu tiên | Xem [Tạo admin đầu tiên](#tạo-admin-đầu-tiên) (cần bước 4 và 5) | Có |

App chỉ chạy được khi đã có đủ bước 2 – 6.

## Nâng cấp database đang có dữ liệu

Database dựng **sau** ngày 14/10/2026 đã có sẵn mọi thứ. Database dựng trước đó (có dữ liệu, không muốn xóa) nâng cấp bằng các file trong `migrations/`, mỗi file chạy **một lần** theo thứ tự ngày, rồi chạy lại `04_functions.sql` (chạy lại được nhiều lần). Mỗi file chạy lại cũng an toàn và nằm trong một giao dịch.

| File | Làm gì |
| --- | --- |
| `migrations/2026-10-09_type_groups_and_part_number_level.sql` | Thêm bảng `type_groups` (4 nhóm ban đầu), cột `types.group_id` (gán nhóm theo `kind` hiện có — không ghi lịch sử, không đổi `updated_at`), cột `part_numbers.level_id` (trống), cho phép `type_groups` trong `configuration_histories`. Dữ liệu cũ giữ nguyên. Kết quả kiểm tra cuối file: `groups = 4` (hoặc hơn), `types_without_group = 0`, `types_with_wrong_kind = 0`, `part_number_level_column = 1` |
| `migrations/2026-10-09_overview_board.sql` | Bỏ hai hàm của cây Overview cũ (`overview_children`, `overview_unattached_count`) — `04_functions.sql` không còn định nghĩa chúng nhưng `create or replace` không tự xóa khỏi database đang có. **Thứ tự khác các file trên**: chạy lại `04_functions.sql` trước (thêm `overview_board` và `asset_tree`, hai hàm cũ còn nguyên nên app cũ vẫn chạy), triển khai app mới (Overview dạng thẻ; modal Equipment lấy con từ `asset_tree`), **rồi mới** chạy file này — file từ chối chạy nếu thiếu một trong hai hàm mới. Kết quả kiểm tra cuối file: `old_overview_functions = 0`, `overview_board = 1`, `asset_tree = 1` |
| `migrations/2026-10-14_part_number_description.sql` | Thêm cột `part_numbers.description` (trống) và **xóa** cột `types.description` — **mất mọi mô tả đã nhập ở Type, không khôi phục được** (xuất Configuration › Type ra Excel hoặc backup trước). Chạy file này **trước** khi triển khai app mới; không cần chạy lại `04_functions.sql`. Kết quả kiểm tra cuối file: `part_number_description = 1`, `type_description = 0` |
| `migrations/2026-10-14_tag_palette.sql` | Thêm mã `purple` để Configuration › Tag có sáu màu pastel, gồm vàng/đỏ. Chuyển những tag mã `yellow` cũ (đang hiển thị tím) sang `purple` một lần, giữ ID, liên kết, timestamps và lịch sử. Chạy file này **trước** app mới; không cần chạy lại `04_functions.sql`. Chạy lại giữ những tag vàng mới. Kiểm tra cuối file: `tag_color_palette` gồm sáu mã, có `purple` |
| `migrations/2026-10-15_action_id.sql` | Thêm cột `action_id` (uuid, cho phép null) vào `asset_logs`, `configuration_histories`, `user_histories` — **một thao tác của người dùng = một `action_id`**, để "Thay đổi gần đây" gộp một thao tác (Swap, Move kèm con cháu, Check-out, Import…) thành một dòng. Chỉ thêm cột + chỉ mục, không đổi dữ liệu. **Thứ tự**: chạy file này, **rồi chạy lại `04_functions.sql`** (ghi `action_id`, các hàm ghi dữ liệu nhận `p_action_id`, view mới `recent_actions`; chữ ký cũ bị bỏ trong cùng giao dịch), rồi mới triển khai app (app mới vẫn chạy với database chưa nâng cấp, chỉ chưa gộp). Kết quả kiểm tra: `action_id_columns = 3`, và ở cuối `04_functions.sql`: `action_id_functions = 10`, `asset_swap_args = 6`, `views = 3`. Tùy chọn, **chưa chạy**: `migrations/2026-10-15_action_id_backfill_OPTIONAL.sql` gộp các thao tác cũ (cùng người, cùng nguồn, cùng created_at chính xác) — sửa dòng nhật ký nên cần duyệt riêng |

Sau khi dựng xong một project mới, trỏ `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) sang project đó.

## Cài đặt Supabase Dashboard

Tài khoản chỉ do Admin tạo, nên phải đóng mọi đường tự đăng ký. Tên mục có thể khác chút tùy phiên bản Dashboard.

1. **Authentication → Sign In / Providers → User Signups**: tắt **Allow new users to sign up** (publishable key là công khai — để mở thì ai cũng tạo được user Auth qua API). Chỉ để provider **Email** bật; tắt mọi provider khác.
2. **Authentication → Sign In / Providers → Email**: tắt **Confirm email** (tài khoản dùng email nội bộ `<username>@jabil.local`, không có hộp thư; server tạo user với `email_confirm: true`).
3. **Authentication → Rate Limits**: nâng giới hạn **sign-ups and sign-ins** theo IP lên (ví dụ vài trăm / 5 phút). Mặc định ~30 lần / 5 phút / IP; cả nhà máy có thể ra internet chung một IP nên người dùng dễ bị chặn oan.
4. **Authentication → Password** (nếu có): độ dài tối thiểu từ 6 trở lên là đủ cho mật khẩu tạm dạng `Jabil-4827`.

## Tạo admin đầu tiên

Chưa có admin thì không ai tạo được tài khoản khác. Từ thư mục `Equipment-Management-System`, sau khi `.env.local` đã trỏ vào project mới:

```
npm run seed:admin -- man.tran "Trần Văn Mân" 100234
```

Username: chữ thường không dấu, số và `. _ + -`; mã nhân viên không bắt buộc. Script tạo user Supabase Auth (email nội bộ `man.tran@jabil.local`, `email_confirm: true`) và hồ sơ Admin (`must_change_password = true`) qua `app_write`, in **mật khẩu tạm** dạng `Jabil-4827` **một lần**. Đăng nhập bằng username; app bắt đổi mật khẩu ngay lần đầu. Lịch sử tài khoản ghi `CREATE` (nguồn `script`).

Từ admin đầu tiên, mọi tài khoản khác do Admin tạo trong app (User Management).

## Nghiệp vụ trong database (`04_functions.sql`)

- **Nhật ký tự động**: mọi thêm / sửa / xóa trên `equipment`, `sub_equipment`, `golden_boards`, `calibrations` tự ghi vào `asset_logs` (với `old_value` / `new_value`, `from_location` / `to_location`, `reason`, `source`, `user_id`); Configuration ghi `configuration_histories`, tài khoản ghi `user_histories`. Server không tự thêm dòng nhật ký.
- **`app_write`**: một cửa thêm / sửa / xóa cho server (bảng được phép ghi nằm trong danh sách cố định; không xóa được tài khoản).
- **Cây tài sản**: 6 hàm `asset_*` dùng chung cho `equipment` / `sub_equipment` / `golden_board` (tham số `p_type`). Con luôn đi theo khi Đổi vị trí / Move / Swap; Xóa thì con trực tiếp thành chưa gắn (Not in use). Chặn gắn sai loại (`PARENT_TYPE_INVALID`), Swap khác loại (`SWAP_TYPE_MISMATCH`) hoặc không thay đổi gì (`SWAP_NO_CHANGE`), Xóa / Đổi vị trí khi đang In use (`EQUIPMENT_IN_USE`), Check-out riêng một con khi cha chưa In use (`PARENT_NOT_IN_USE`). Move luôn được và tài sản lấy Status của cha mới. Mọi hàm thao tác trả `{ dry_run, count, deleted, usage_changes[], changes[] }`.
- **Usage**: chỉ Tester được In use khi không có cha; Base / Fixture / sub-equipment / golden board cần cha mới In use (`USAGE_NEEDS_PARENT`).
- **Import Excel**: `equipment_import` / `sub_equipment_import` / `golden_import` thêm mọi dòng của file trong **một** giao dịch (một dòng lỗi → không dòng nào được thêm); nhật ký `CREATE` với nguồn `import`. Server kiểm tra từng dòng trước khi gọi.
- **Calibration**: `calibrations.due_date = calibrated_at + interval_months` (Setup của part number) khi thêm một lần hiệu chuẩn; đổi chu kỳ chỉ áp dụng cho lần sau. View `sub_equipment_calibration` cho Calibration Status (`not_calibrated` / `failed` / `overdue` / `due_soon` / `valid`).
- **Overview**: `overview_board(p_usage, p_kind, p_q)` trả cả bảng thẻ theo Location trong một lần — mỗi cột là một tài sản gốc tối đa 3 thẻ kể cả thẻ gốc, chọn theo ưu tiên (khớp bộ lọc → cảnh báo hiệu chuẩn → Base → Fixture → Golden → Sub), số con cháu đủ để tính "+N", `matched` cho bộ lọc Status / Loại / tìm serial · part number. Chạy trong khoảng 0,05 s với 820 tài sản và 0,3 s với 5.000 (PGlite).
- **User Management**: trigger `user_profiles_admin_guard` — Admin không tự khóa / hạ quyền mình (`ADMIN_SELF_CHANGE`), không khóa / hạ quyền Admin cuối cùng (`LAST_ADMIN`).

## Database tự chặn sẵn (trong `02_schema.sql`)

- Thẻ: `tag_ids` (mảng) kiểm tra mọi lần ghi — bỏ trùng, thẻ phải có thật. Xóa thẻ đang được gắn trên bản ghi nào → `TAG_IN_USE`.
- Sửa hoặc xóa dòng trong bảng nhật ký → lỗi `HISTORY_IS_APPEND_ONLY`.
- Xóa part number đã có chu kỳ hiệu chuẩn, hoặc đang được dùng → lỗi khóa ngoại. Đổi Type của part number đã có thiết bị dùng → `PART_NUMBER_IN_USE`.
- Khóa ngoại `equipment.parent_id` là `RESTRICT`: không xóa được thiết bị còn con bằng đường nào khác `asset_delete` (hàm này gỡ con trước). Sub-equipment và golden board gắn vào thiết bị bị xóa thì thành "chưa gắn" (`on delete set null`), không bị xóa.
- `user_profiles.id` trỏ `auth.users(id)` với `on delete restrict`: không xóa nhầm tài khoản trong Dashboard làm mất `created_by` / `updated_by`.
- 3 loại hệ thống của `types` không xóa, không ẩn, không đổi `kind` (`TYPE_SYSTEM_LOCKED`). `types.kind` luôn bằng `kind` của nhóm (`group_id`, bảng `type_groups`): đổi nhóm sang nhóm khác `kind` bị chặn như vậy; 3 nhóm hệ thống khóa như 3 loại.
- `display_name` không được trùng, không phân biệt hoa/thường; `username` không trùng. Serial được phép trùng (cảnh báo ở app qua `serial_matches`, dùng index `lower(serial_number)`), database chỉ cắt khoảng trắng hai đầu. `remark` tối đa 1000 ký tự.
- `error_log` tự xóa bản ghi cũ hơn 90 ngày.
- `updated_at` tự cập nhật mỗi khi sửa dòng.

## Kiểm tra

`database/tests/assets.test.mjs` dựng database mới (02 → 03 → 04) trên PGlite rồi kiểm tra từng trigger / hàm, kể cả mọi hàm `p_dry_run = true` (không ghi `asset_logs`, không đổi bảng nào, kết quả khớp lần gọi thật). Chạy: `npm i --no-save @electric-sql/pglite && node database/tests/assets.test.mjs`.

`node database/tests/tag_palette.test.mjs` kiểm tra riêng sáu màu Tag, migration màu tím cũ, chạy lại an toàn, giữ ID/liên kết/timestamps/lịch sử và schema mới (cũng dùng PGlite, không kết nối Supabase).
