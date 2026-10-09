# API

Cập nhật: 08/10/2026. Mọi route nằm ở `app/api/**/route.ts`, đều đi qua `withAuth` ([lib/auth/withAuth.ts](../lib/auth/withAuth.ts)). Quy tắc nghiệp vụ nằm ở database ([DATABASE_MODIFIED.md](DATABASE_MODIFIED.md)); route chỉ kiểm tra dữ liệu gửi lên, kiểm tra nhóm quyền và gọi service ([lib/services/](../lib/services/)).

## Quy ước

- **Phản hồi** thành công: `{ success: true, data, meta: { request_id, … } }`. Lỗi: `{ success: false, error: { code, message, details, request_id } }` với HTTP status theo mã ([lib/errors/index.ts](../lib/errors/index.ts)); chữ hiển thị nằm ở client (`src/i18n/locales/*.json` › `errors`).
- **Quyền**: `Mọi nhóm` = đã đăng nhập; `Editors` = Admin, User; `Admin` = chỉ Admin. Tài khoản bị khóa → 403 `USER_INACTIVE`; còn mật khẩu tạm → 403 `PASSWORD_CHANGE_REQUIRED` (trừ `/api/me`, `/api/me/password`).
- **Body**: JSON, key lạ bị từ chối (`VALIDATION_ERROR`, `details.fields`). `id` là uuid; sai dạng → 404.
- **Dry run**: mọi thao tác trên cây tài sản nhận `dry_run: true` (DELETE: `?dry_run=1`) — chạy đúng như thật rồi hoàn tác, trả cùng một dạng kết quả `AssetOpResult` = `{ dry_run, count, deleted, usage_changes[], changes[] }` ([lib/types.ts](../lib/types.ts)). Màn hình thao tác dùng nó cho mục "Kết quả" và để báo lỗi (`EQUIPMENT_IN_USE`, `SWAP_NO_CHANGE`, `PARENT_TYPE_INVALID`…) trước khi bấm nút chính.
- **Tài sản** có ba loại (`type` trên đường dẫn): `equipment`, `sub_equipment`, `golden_board`.

## Đăng nhập, tài khoản

| Route | Quyền | Việc |
| --- | --- | --- |
| `POST /api/auth/login` | Ẩn danh | `{ username, password }` → cookie phiên Supabase. Sai → `INVALID_CREDENTIALS`; khóa → `USER_INACTIVE`; quá số lần → `LOGIN_RATE_LIMITED` |
| `POST /api/auth/logout` | Ẩn danh | Đăng xuất phiên này |
| `GET /api/auth/session-ended` | Ẩn danh | Redirect: xóa phiên không còn hợp lệ rồi về `/login` |
| `GET /api/health` | Ẩn danh | Keepalive |
| `GET·PUT /api/me` | Mọi nhóm | Hồ sơ của mình (họ tên, mã nhân viên, phòng ban) |
| `PUT /api/me/password` | Mọi nhóm | `{ current_password, new_password }` (≥ 10 ký tự); mật khẩu tạm cũng là "mật khẩu hiện tại". Không ghi lịch sử |
| `GET /api/options` | Mọi nhóm | Mọi danh sách chọn (Part Number kèm `kind` và `level_id`, Type kèm `kind` và `group_id`, Group (`type_groups`) kèm `kind`, Location, Level, Department, Vendor, Tag) |

## User Management (Admin)

| Route | Việc |
| --- | --- |
| `GET /api/users` · `GET·PUT /api/users/{id}` | Danh sách, chi tiết, sửa (họ tên, mã nhân viên, phòng ban, nhóm quyền; username không đổi) |
| `POST /api/users` | Thêm: `{ username, full_name, employee_id?, department_id?, role }` → `{ user, temp_password }` — mật khẩu tạm chỉ có trong response này |
| `POST /api/users/{id}/password` | Đặt lại mật khẩu → `{ user, temp_password }` (không body) |
| `POST /api/users/{id}/disable` · `…/enable` | Khóa / Mở khóa. Chặn Admin tự khóa (`ADMIN_SELF_CHANGE`) và Admin cuối cùng (`LAST_ADMIN`) |
| `GET /api/users/{id}/history` | `user_histories` |

## Equipment (tester / base / fixture)

| Route | Quyền | Việc |
| --- | --- | --- |
| `GET /api/equipment` · `GET /api/equipment/{id}` | Mọi nhóm | Danh sách / chi tiết (kèm `kind`, `parent_serial`, `has_children`) |
| `POST /api/equipment` | Editors | Thêm. Có `parent_id` thì vị trí và Level theo cha; không có cha thì `location_id` và `level_id` **bắt buộc**; Type luôn theo part number (không gửi) |
| `PUT /api/equipment/{id}` | Editors | Sửa. Đổi `parent_id` → Move / Detach, đổi `location_id` → Đổi vị trí (chạy thử trước khi ghi). Không xóa trống `level_id` của thiết bị không có cha (`VALIDATION_ERROR`, `fields.level_id = required`) |
| `GET /api/equipment/{id}/tree` | Mọi nhóm | Cây chứa thiết bị: từ tài sản gốc xuống mọi con cháu, cả sub-equipment và golden board — một lần gọi `asset_tree`. Mỗi nút có `kind`, `type_name`, `usage`, `cal_status`; modal Equipment dùng cho tab Cây thiết bị, chip thiết bị con và tóm tắt hiệu chuẩn |
| `GET /api/equipment/{id}/history` | Mọi nhóm | `asset_logs` |
| `POST /api/equipment/import` · `GET …/import/template?lang=` | Editors | Import Excel (multipart `file`, `commit=1` để ghi) / file mẫu |

## Calibration (sub-equipment + lần hiệu chuẩn)

| Route | Quyền | Việc |
| --- | --- | --- |
| `GET /api/calibration` · `GET /api/calibration/{id}` | Mọi nhóm | Sub-equipment kèm lần hiệu chuẩn mới nhất và Calibration Status (`not_calibrated` / `failed` / `overdue` / `due_soon` / `valid`) |
| `POST /api/calibration` · `PUT /api/calibration/{id}` | Editors | Thêm / sửa sub-equipment (`tester_id` thay cho `parent_id`) |
| `GET·POST /api/calibration/{id}/records` | Mọi nhóm / Editors | Các lần hiệu chuẩn / **ghi nhận hiệu chuẩn** (`calibrated_at` bắt buộc; `due_date` tự tính theo Setup, chưa có Setup thì phải gửi) → `{ record, sub_equipment }` |
| `PUT·DELETE /api/calibration/records/{recordId}` | Editors / Admin | Sửa / xóa một lần hiệu chuẩn → `{ record?, sub_equipment }` |
| `GET /api/calibration/{id}/history?only=calibrations` | Mọi nhóm | `asset_logs` (chỉ `CALIBRATE`, `CALIBRATION_UPDATE`, `CALIBRATION_REMOVE` khi có `only`) |
| `POST /api/calibration/import` · `GET …/import/template` | Editors | Import Excel sub-equipment |

## Golden board

| Route | Quyền | Việc |
| --- | --- | --- |
| `GET·POST /api/golden` · `GET·PUT /api/golden/{id}` | Mọi nhóm / Editors | Danh sách, thêm, chi tiết, sửa (`parent_id` = tester hoặc fixture) |
| `GET /api/golden/{id}/history` | Mọi nhóm | `asset_logs` |
| `POST /api/golden/import` · `GET …/import/template` | Editors | Import Excel |

## Thao tác trên cây tài sản (dùng chung ba loại)

| Route | Quyền | Việc |
| --- | --- | --- |
| `GET /api/assets/{type}/valid-parents?id=\|kind=&q=&limit=` | Mọi nhóm | Cha hợp lệ (`id` tài sản có sẵn, hoặc `kind` tester / base / fixture khi thêm mới equipment); mỗi dòng kèm `usage_after` |
| `GET /api/assets/{type}/{id}/swap-candidates?q=` | Mọi nhóm | Tài sản Swap được (cùng Type; golden board bất kỳ); `same_place` |
| `GET /api/assets/serial-matches?serial=&exclude_type=&exclude_id=` | Mọi nhóm | Serial trùng ở cả ba bảng — cảnh báo trước khi lưu |
| `POST /api/assets/{type}/{id}/change-location` `{ location_id, dry_run? }` | Editors | Chỉ khi chưa gắn cha và không In use; con cháu đi theo |
| `POST /api/assets/{type}/{id}/move` `{ parent_id, dry_run? }` | Editors | Gắn vào / đổi cha — luôn được theo quy tắc cây; lấy vị trí, Level, Status của cha mới |
| `POST /api/assets/{type}/{id}/detach` `{ dry_run? }` | Editors | Tách khỏi cha → Not in use |
| `POST /api/assets/{type}/{id}/swap` `{ other_id, dry_run? }` | Editors | Đổi chỗ hai tài sản cùng loại |
| `DELETE /api/assets/{type}/{id}?dry_run=1` | Admin | Xóa; con trực tiếp được giữ lại, thành chưa gắn |
| `POST /api/assets/usage` `{ refs: [{ type, id }], usage, note?, dry_run? }` | Editors | Check-out / Check-in các tài sản và toàn bộ con cháu |

## Overview, Dashboard

| Route | Quyền | Việc |
| --- | --- | --- |
| `GET /api/overview?usage=&kind=&q=` | Mọi nhóm | Bảng thẻ: các dòng của `overview_board` ([DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) mục 2) — cột = tài sản gốc nhóm theo Location, tối đa 3 thẻ mỗi cột (kể cả thẻ gốc), `descendants`, `alerts`, `matched`, `pos`. `usage` = `in_use` \| `not_in_use`; `kind` = `tester` \| `base` \| `fixture` \| `sub_equipment` \| `golden_board`; `q` = serial / part number. Bỏ trống cả ba = cả bảng. Tìm và lọc chạy trong database (một thẻ khớp có thể nằm sau "+N") |

| `GET /api/dashboard` | Mọi nhóm | Số liệu tổng hợp |
| `GET /api/dashboard/activities?module=&user=&q=&from=&to=&limit=` | Mọi nhóm | Thay đổi gần đây (Configuration và User chỉ Admin thấy) |

## Configuration (Admin)

| Route | Việc |
| --- | --- |
| `GET·POST /api/configuration/{list}` · `GET·PUT·DELETE /api/configuration/{list}/{id}` | `list` = `part-numbers`, `locations`, `types`, `type-groups`, `tags`, `levels`, `departments`, `calibration-setup`, `calibration-vendors`. Xóa thật chỉ với `tags` và `calibration-setup`; còn lại ẩn (`is_active`). `part-numbers`: `type_id` bắt buộc, `level_id` không bắt buộc (id, hoặc `null` để bỏ Level); dòng trả về kèm `level_id`, `level`. `types`: `group_id` bắt buộc (nhóm `sub_equipment` đang dùng), `kind` do database đặt theo nhóm (không gửi); dòng trả về kèm `group_id`, `group`, `kind`. `type-groups`: `display_name`, `sort_order`, `is_active` (không gửi `kind`; dòng trả về kèm `kind` để phân biệt 3 nhóm hệ thống khóa) |
| `GET /api/configuration/{list}/{id}/history` · `GET /api/configuration/error-log` | Lịch sử / Error log |
