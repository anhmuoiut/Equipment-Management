# Database — bản thiết kế (nguồn chính)

Cập nhật: 09/10/2026. **Mọi quyết định thiết kế database mới đều ghi vào file này.** Database dựng mới từ đầu trên một Supabase project trống; file chỉ mô tả thiết kế hiện tại.

Làm sau: module Sửa chữa (Repair), upload file chứng nhận hiệu chuẩn lên Supabase Storage.

Ký hiệu: **✔** = bắt buộc (`not null`) · **PK** = khóa chính · **FK** = khóa ngoại · **UQ** = không được trùng. *Cần chốt* = điểm chưa quyết định.

## Menu ↔ bảng

| Menu | Bảng | Mục |
| --- | --- | --- |
| Dashboard | Không có bảng riêng. Đọc `equipment`, `sub_equipment`, `golden_boards`, view `sub_equipment_calibration` và view `recent_activities` (thay đổi gần đây) | [1](#1-dashboard) |
| Overview | Không có bảng riêng. Bảng thẻ theo Location đọc cây cha–con của `equipment`, `sub_equipment`, `golden_boards` (và view `sub_equipment_calibration`) qua một hàm `overview_board` | [2](#2-overview) |
| Equipment | `equipment` (tester / base / fixture) | [3](#3-equipment) |
| Calibration | `sub_equipment`, `calibrations`, view `sub_equipment_calibration` | [4](#4-calibration) |
| Golden | `golden_boards` | [5](#5-golden-board) |
| *(nhật ký của ba menu trên)* | `asset_logs` | [6](#6-asset_logs--nhật-ký-tài-sản) |
| Configuration | `part_numbers`, `locations`, `types`, `type_groups`, `tags`, `levels`, `departments`, `calibration_configurations`, `calibration_vendors`, `configuration_histories` | [7](#7-configuration) |
| User Management | `user_profiles`, `user_histories` | [8](#8-user-management) |
| *(hệ thống, không có menu)* | `error_log` | [9](#9-bảng-hệ-thống) |

## Quy ước chung

| Quy ước | Thiết kế |
| --- | --- |
| Tên bảng | `snake_case`. Bảng dữ liệu gốc dùng chung số nhiều, không có tiền tố (`part_numbers`, `locations`, `types`, `tags`, `levels`, `departments`). Ba loại tài sản: `equipment` (tester / base / fixture), `sub_equipment`, `golden_boards` |
| Khóa chính | **Mọi bảng** có cột `id uuid` riêng làm PK, tự sinh bằng `gen_random_uuid()` — kể cả khi bảng đã có cột UQ khác |
| Định danh | Mọi liên kết và logic dựa vào `id`, không dựa vào chữ. Bảng dữ liệu gốc không có cột mã (`code`). |
| Tên hiển thị | `display_name` — chữ người dùng thấy, admin đặt sao hiển thị vậy, sửa thoải mái |
| Thứ tự | `sort_order` |
| Thời gian | `created_at`, `updated_at` kiểu `timestamptz`; `updated_at` tự cập nhật bằng trigger `set_updated_at` |
| Người tạo/sửa | `created_by`, `updated_by` → FK `user_profiles.id` |
| Dữ liệu gốc | Admin tạo **một lần** ở Configuration, mọi trang cần thì trỏ tới. Xóa = ẩn (`is_active = false`). **Trừ** `tags`: admin sửa / xóa thật; đang được dùng thì không xóa được |
| Màu trạng thái | Không lưu trong database — dùng màu hệ thống, thiết kế chung cho toàn project (docs/JABIL_UI.md) |
| Xóa dữ liệu | Tài sản xóa thật (không có Archive). Xóa thiết bị có con: con trực tiếp luôn được giữ và thành **chưa gắn** (Not in use). Tài khoản không xóa, chỉ khóa |
| Serial | `serial_number` của cả ba bảng tài sản **không UQ**. Database tự cắt khoảng trắng hai đầu. Trước khi lưu, giao diện gọi `serial_matches` ([Tra cứu](#tra-cứu-cho-màn-hình-thao-tác)): kiểm tra serial (đã `trim`, không phân biệt hoa/thường) trên **cả ba bảng** bằng index `lower(serial_number)`; trùng thì hiện cảnh báo và người dùng vẫn lưu được |
| FK | Mọi cột FK phải trỏ tới một bảng có trang thêm / sửa / xóa. Trường không có bảng để trỏ tới thì là chữ gõ tự do (`text`) |
| Form | Trường trên form cố định trong code — không có tính năng admin đổi nhãn / ẩn / hiện / bắt buộc |
| Nhật ký | Ba loại tài sản dùng **một** bảng `asset_logs`; Configuration và User Management mỗi nơi một bảng `*_histories` cùng [khuôn](#khuôn-bảng-lịch-sử-configuration-và-user). Không có bảng nhật ký chung cho mọi thứ |
| Tách module | Module chỉ trỏ tới dữ liệu gốc dùng chung, và một chiều sang module khác khi cần (Calibration → Equipment, Golden → Equipment). Equipment không trỏ sang Calibration hay Golden; Overview và Dashboard chỉ đọc |
| Phân quyền | Theo **nhóm** (`user_profiles.role`): Admin / User / Readonly — xem [Phân quyền theo nhóm](#phân-quyền-theo-nhóm). Không cấp quyền lẻ cho từng người |
| Bảo mật | RLS chặn hết; chỉ server (service_role) đọc/ghi |

## Sơ đồ liên kết

```
Configuration (dữ liệu gốc dùng chung + cấu hình hiệu chuẩn)
  part_numbers   locations   types   type_groups   tags       levels   departments
  part_numbers ──► types       (type_id — Type của mọi thiết bị mang part number)
  part_numbers ──► levels      (level_id — không bắt buộc; form Thêm thiết bị điền sẵn)
  types ──► type_groups        (group_id — nhóm của Type; types.kind luôn bằng kind của nhóm)
  type_groups.kind: tester / base / fixture (nhóm hệ thống, khóa) · sub_equipment (mọi nhóm Admin thêm)
  calibration_configurations ──► part_numbers  (part_number_id, UQ — chỉ part number kind sub_equipment)
  calibration_vendors
  configuration_histories                      (record_id, không FK)

Equipment
  equipment ──► part_numbers  (part_number_id)
            ──► types         (type_id — kind tester / base / fixture)
            ··· tags          (tag_ids — mảng id thẻ, database kiểm tra)
            ──► levels        (level_id)
            ──► locations     (location_id)
            ──► equipment     (parent_id — Tester ⊃ Base ⊃ Fixture)

Calibration  (phụ thuộc một chiều vào Equipment)
  sub_equipment ──► part_numbers  (part_number_id)
                ──► types         (type_id — kind sub_equipment)
                ──► equipment     (tester_id — chỉ kind tester; trống = chưa gắn)
                ──► locations     (location_id)
                ··· tags          (tag_ids)
  calibrations  ──► sub_equipment       (sub_equipment_id — mỗi lần hiệu chuẩn một dòng)
                ──► calibration_vendors (vendor_id)
  sub_equipment_calibration  (view: lần hiệu chuẩn mới nhất + Calibration Status)

Golden  (phụ thuộc một chiều vào Equipment)
  golden_boards ──► equipment  (parent_id — kind tester hoặc fixture; trống = chưa gắn)
                ──► locations  (location_id)
                ··· tags       (tag_ids)

Nhật ký
  asset_logs                   (asset_type + asset_id, không FK; user_id → user_profiles)

User Management
  user_profiles ──► auth.users   (id — tài khoản Supabase Auth, on delete restrict)
  user_profiles ──► departments  (department_id)
  user_histories                  (user_id, không FK)

Hệ thống
  error_log
```

## Cây tài sản

```
Tester
 ├─ sub_equipment            sub_equipment.tester_id
 ├─ golden_boards            golden_boards.parent_id
 ├─ Fixture                  equipment.parent_id      (fixture gắn thẳng vào Tester cũng được)
 │   └─ golden_boards        golden_boards.parent_id
 └─ Base                     equipment.parent_id
     └─ Fixture              equipment.parent_id
         └─ golden_boards    golden_boards.parent_id
```

| Con | Cha được phép | Cha trống (đang nằm kho) |
| --- | --- | --- |
| Tester | — (không có cha) | luôn |
| Base | Tester | được |
| Fixture | Base hoặc Tester | được |
| sub_equipment | Tester | được |
| golden board | Tester hoặc Fixture | được |

- Loại của `equipment` là `types.kind` của `type_id` (tester / base / fixture). Sub-equipment và golden board là hai bảng riêng.
- **Database chặn gắn sai** ở mọi đường ghi (form, Move, Swap, import, script): `PARENT_TYPE_INVALID`. Quy tắc cha–con của `equipment` kiểm tra **sau** câu lệnh để Import Excel có dòng cha nằm sau trong cùng file.
- Loại của một `equipment` không đổi sau khi tạo (đổi part number của nó chỉ sang part number cùng Type — `TYPE_KIND_INVALID`), nên cây hiện có luôn còn hợp lệ.
- **Vị trí**: có cha thì luôn bằng vị trí của cha (database tự đặt); cha đổi vị trí thì cả cây con đổi theo, kể cả sub-equipment và golden board. Chưa gắn cha thì có vị trí riêng.
- **Status (Usage)**: xem [Status](#status-usage--check-out--check-in).
- **Level** chỉ có ở `equipment`: có cha thì bằng Level của cha, đổi Level cha thì cả cây `equipment` con đổi theo.
- **Con luôn đi theo**: Đổi vị trí, Move, Swap một thiết bị thì cả nhánh con (kể cả sub-equipment và golden board) đi theo — vị trí, Level, Usage theo chỗ mới. Muốn con ở lại chỗ cũ thì Detach con trước.
- **Xóa** một tài sản (`asset_delete`): con **trực tiếp** (equipment, sub-equipment, golden board) luôn được giữ và thành **chưa gắn**, Not in use (nhánh của con đi theo con); không tự gắn lên ông. Nhật ký của con ghi `DETACH`, ghi chú `parent_deleted:<SN>`. Khóa ngoại `equipment.parent_id` là `RESTRICT`: không có đường nào xóa cả cây một cách âm thầm (xóa trực tiếp thiết bị còn con → lỗi khóa ngoại) — chỉ `asset_delete` xóa, và nó gỡ con trước. Lần hiệu chuẩn của sub-equipment xóa theo sub-equipment.

## Status (Usage) — Check-out / Check-in

Cả ba bảng tài sản có cột `usage` (`in_use` / `not_in_use`, mặc định `not_in_use`); giao diện gọi là **Status**. Hệ thống tự quản, không có danh sách cấu hình, không sửa trong form.

- **Check-out** → In use, **Check-in** → Not in use (`asset_set_usage`). Tài sản được chọn **và toàn bộ con cháu** (cả ba bảng) đổi cùng lúc, một giao dịch; chọn riêng một con thì cha không đổi. Nhật ký `CHECK_OUT` / `CHECK_IN`, `reason` là ghi chú người dùng nhập. Không tài sản nào đổi → `USAGE_NO_CHANGE`.
- **Gắn vào cha / thêm mới dưới cha**: lấy Usage của cha tại thời điểm đó (cả nhánh con đi theo). **Tách khỏi cha** (hoặc cha bị xóa): tài sản và con cháu về Not in use. Tách luôn được, kể cả khi đang In use.
- **Quy tắc cố định**: chỉ **Tester** được In use khi không có cha; **Base, Fixture, sub-equipment, golden board** cần cha mới In use được (`USAGE_NEEDS_PARENT`, chặn ở Check-out, Swap và mọi đường ghi). Không có cấu hình theo part number. Tách khỏi cha (hoặc cha bị xóa) → Not in use.
- **Check-out RIÊNG một con** khi cha chưa In use bị chặn (`PARENT_NOT_IN_USE`); Check-out cả cha lẫn con cùng lúc thì được. Check-in cha thì cả nhánh con về Not in use. (Đây là chỗ duy nhất dùng `PARENT_NOT_IN_USE`.)
- Tài sản đang In use thì **không Xóa, Đổi vị trí được** (`EQUIPMENT_IN_USE`) — phải Check-in trước. **Move luôn được** (chỉ theo quy tắc cây, không bị chặn vì In use): tài sản và cả nhánh con **lấy Usage của cha mới**, cùng vị trí và Level — nên Move một tài sản In use vào cha Not in use thì nó và con cháu về Not in use (và ngược lại: Not in use vào cha In use thì thành In use). Kết quả xem trước (`usage_changes`) liệt kê tài sản nào đổi Status để modal cảnh báo "SN-001: In use → Not in use". Swap và Tách khỏi cha cũng được khi đang In use.

## Swap

Hai tài sản **cùng loại** đổi chỗ cho nhau; khác loại → `SWAP_TYPE_MISMATCH`. Mỗi bên nhận cha + vị trí của bên kia (Usage theo chỗ mới); nhật ký mỗi bên một dòng `SWAP`, ghi chú `swap_with:<SN>`. Chặn Swap không thay đổi gì (cùng cha, cùng vị trí): `SWAP_NO_CHANGE`. Swap với chính nó: `VALIDATION_ERROR` (màn hình không cho chọn). Màn hình Swap chỉ liệt kê các tài sản hợp lệ do `swap_candidates` trả về.

| Bảng | "Cùng loại" nghĩa là | Ghi chú |
| --- | --- | --- |
| `equipment` | cùng Type (tester với tester, base với base, fixture với fixture) | Mỗi bên nhận cha, vị trí **và Usage** của bên kia (Usage đi theo chỗ), Level theo cha mới; con cháu đi theo thiết bị (lấy vị trí, Level, Usage của chỗ mới) |
| `sub_equipment` | cùng Type (DMM với DMM, Power supply với Power supply…) | Đổi `tester_id` và vị trí cho nhau. Một bên chưa gắn cũng được: bên đang gắn ra kho (Not in use, vị trí của bên kia), bên kia vào chỗ của nó — Swap đồng thời là cách thay thế thiết bị |
| `golden_boards` | không giới hạn — golden board nào cũng swap được với nhau (kể cả tester ↔ fixture) | Như `sub_equipment` |

## Hàm thao tác — xem trước (dry run) và kết quả

Mọi hàm thao tác nhận `p_dry_run boolean default false` và trả **cùng một dạng jsonb**. (`app_write` là hàm ghi một dòng thông thường, không thuộc nhóm này: lỗi kiểm tra báo ngay khi lưu.)

| Nhóm | Hàm |
| --- | --- |
| 6 thao tác, dùng chung cho cả ba loại tài sản (`p_type` = `equipment` / `sub_equipment` / `golden_board`) | `asset_change_location`, `asset_move`, `asset_detach`, `asset_swap`, `asset_delete`, `asset_set_usage` (Check-out / Check-in) |
| Import | `equipment_import`, `sub_equipment_import`, `golden_import` |

**Kết quả:**

| Trường | Ý nghĩa |
| --- | --- |
| `dry_run` | `true` nếu chỉ xem trước |
| `count` | Số tài sản có thay đổi (bản ghi nào cũng tính một lần) |
| `deleted` | Số tài sản bị xóa |
| `usage_changes` | Tài sản nào **đổi Status**: `asset_type`, `asset_id`, `label`, `from`, `to` — ví dụ `in_use` → `not_in_use` khi Move một thiết bị In use vào cha Not in use, hoặc Tách khỏi cha. Rỗng nếu không ai đổi Status |
| `changes` | Danh sách thay đổi sẽ ghi / đã ghi: `asset_type`, `asset_id`, `label`, `action`, `from_location`, `to_location`, `reason`, `old_value`, `new_value` (cùng dạng `asset_logs`). Hàm import để trống (file có thể hàng nghìn dòng) |

**`p_dry_run = true`**: chạy **đúng như thật** — cùng kiểm tra, cùng mã lỗi (`EQUIPMENT_IN_USE`, `SWAP_NO_CHANGE`, `PARENT_TYPE_INVALID`…), mọi trigger — rồi hoàn tác toàn bộ; không ghi dòng `asset_logs` nào. Màn hình thao tác dùng nó cho mục "Kết quả" (con đi đâu, vị trí mới, Usage mới) và để báo lỗi trước khi bấm nút chính; Import dùng nó để kiểm tra cả file bằng chính database trước khi ghi. Thao tác thật trả cùng dạng (`dry_run = false`), nên màn hình dùng `count` / `changes` để báo "đã đổi N thiết bị".

## Tra cứu cho màn hình thao tác

Hàm chỉ đọc; quy tắc nằm ở database nên mọi màn hình dùng chung một nguồn.

| Hàm | Trả về | Dùng ở |
| --- | --- | --- |
| `valid_parents(p_type, p_id, p_kind, p_q, p_limit)` | Các `equipment` được phép làm cha của tài sản đó theo [cây tài sản](#cây-tài-sản). Tài sản có sẵn: `p_type` + `p_id`; thêm mới: `p_type` + `p_kind` (tester / base / fixture khi `p_type = equipment`). Mỗi dòng: `id`, `kind`, `serial_number`, `part_number`, `type_name`, `location`, `usage` (của cha), **`usage_after`** (Status của tài sản SAU khi gắn vào cha đó = Status của cha; không chặn theo Status — modal hiển thị "In use → Not in use" khi khác Status hiện tại). `p_q` lọc theo serial / part number | Ô Thiết bị cha / Tester / Gắn vào, màn hình Move |
| `swap_candidates(p_type, p_id, p_q, p_limit)` | Tài sản có thể Swap với `p_id`: equipment cùng Type, sub-equipment cùng Type, golden board bất kỳ; không gồm chính nó. Mỗi dòng: `id`, `serial_number`, `part_number`, `type_name`, cha (`parent_id`, `parent_serial`), `location`, `usage`, **`same_place`** (cùng cha và cùng vị trí → Swap sẽ báo `SWAP_NO_CHANGE`, trừ khi chọn "con ở lại" và có con) | Màn hình Swap |
| `serial_matches(p_serial, p_exclude_type, p_exclude_id)` | Mọi tài sản ở **cả ba bảng** có cùng serial (đã `trim`, không phân biệt hoa/thường): `asset_type`, `id`, `serial_number`, `part_number`, `location`. `p_exclude_*` bỏ chính bản ghi đang sửa | Popup cảnh báo serial trùng trước khi lưu (vẫn lưu được); import |

## Link QR

`id` của mọi tài sản bất biến, nên link trong mã QR in trên nhãn không bao giờ hết hạn. Mở link = mở thẳng modal chi tiết của tài sản đó ([DETAIL_MODEL.md](DETAIL_MODEL.md) §3.9).

| Tài sản | Link trong QR | Mở ra |
| --- | --- | --- |
| `equipment` | `/equipment?id={id}` | Modal Equipment |
| `sub_equipment` | `/calibration?id={id}` | Modal Calibration |
| `golden_boards` | `/golden?id={id}` | Modal Golden |

Link cũ `/equipment/{id}`, `/calibration/{id}`, `/golden/{id}` chuyển hướng sang các link trên (nhãn đã in vẫn dùng được). Trang Overview dùng `/overview?id={id}&type={asset_type}` vì ba bảng có id riêng (thêm `&tab=tree` để mở sẵn tab Cây thiết bị của thiết bị gốc). Tài sản đã xóa: modal báo không tìm thấy.

## Mã lỗi database

Database báo lỗi bằng mã ngắn (`raise exception 'MÃ'`); server đổi sang câu theo ngôn ngữ người dùng.

| Mã | Khi nào |
| --- | --- |
| `PARENT_TYPE_INVALID` | Gắn tài sản vào cha sai loại ([Cây tài sản](#cây-tài-sản)); đổi Type làm cây hiện có sai |
| `PARENT_NOT_FOUND` | Cha không tồn tại |
| `PARENT_NOT_IN_USE` | Check-out RIÊNG một con khi cha chưa In use (Move không bị chặn vì In use) |
| `USAGE_NEEDS_PARENT` · `USAGE_NO_CHANGE` | In use khi chưa có cha (chỉ Tester được In use khi không có cha) · Check-out / Check-in không đổi gì |
| `EQUIPMENT_IN_USE` | Xóa / Đổi vị trí tài sản đang In use |
| `EQUIPMENT_HAS_NO_PARENT` · `LOCATION_INHERITED_READ_ONLY` | Tách khỏi cha khi không có cha · đổi vị trí tài sản đã có cha |
| `SWAP_TYPE_MISMATCH` · `SWAP_NO_CHANGE` | Swap khác loại · không thay đổi gì (cùng cha, cùng vị trí) |
| `TYPE_KIND_INVALID` · `TYPE_SYSTEM_LOCKED` | Part number sai loại cho bảng / Setup hiệu chuẩn / đổi part number của equipment sang Type khác · sửa 3 loại hệ thống |
| `PART_NUMBER_IN_USE` | Đổi Type của part number đã có thiết bị dùng |
| `CALIBRATION_INTERVAL_MISSING` | Part number chưa có Setup mà không nhập `due_date` |
| `TAG_IN_USE` | Xóa thẻ đang được gắn |
| `NOT_FOUND` · `VALIDATION_ERROR` | Không tìm thấy (kể cả tài sản) · dữ liệu không hợp lệ |
| `ADMIN_SELF_CHANGE` · `LAST_ADMIN` | Admin tự khóa / hạ nhóm quyền mình · khóa / hạ nhóm quyền Admin cuối cùng còn hoạt động |
| `HISTORY_IS_APPEND_ONLY` | Sửa / xóa dòng nhật ký |

## Phân quyền theo nhóm

Mỗi tài khoản thuộc **một** nhóm (`user_profiles.role`). Quyền của từng nhóm cố định trong code; admin chỉ chọn nhóm cho tài khoản.

| Menu / thao tác | Admin | User | Readonly |
| --- | --- | --- | --- |
| Dashboard, Overview | Xem | Xem | Xem |
| Overview — Swap, Check-out / Check-in | ✔ | ✔ | — |
| Equipment — xem, tìm kiếm, xuất Excel | ✔ | ✔ | ✔ |
| Equipment — thêm, sửa, đổi vị trí, Move / Swap / Detach, Check-out / Check-in, import Excel | ✔ | ✔ | — |
| Equipment — xóa | ✔ | — | — |
| Calibration — xem, tìm kiếm, xuất Excel | ✔ | ✔ | ✔ |
| Calibration — thêm / sửa sub-equipment, ghi nhận hiệu chuẩn, Move / Swap / Detach, Check-out / Check-in, import Excel | ✔ | ✔ | — |
| Calibration — xóa sub-equipment, xóa một lần hiệu chuẩn | ✔ | — | — |
| Golden — xem, tìm kiếm, xuất Excel | ✔ | ✔ | ✔ |
| Golden — thêm, sửa, đổi vị trí, Move / Swap / Detach, Check-out / Check-in, import Excel | ✔ | ✔ | — |
| Golden — xóa | ✔ | — | — |
| Configuration (mọi trang) — xem và sửa | ✔ | — (không thấy menu) | — (không thấy menu) |
| User Management | ✔ | — | — |
| Xem lịch sử (tab History) | ✔ | ✔ | ✔ |

Tóm tắt: **Admin** làm được mọi thứ · **User** thêm / sửa / cập nhật, không xóa, không vào Configuration và User Management · **Readonly** chỉ xem, tìm kiếm và xuất Excel (xem được thì xuất được).

User nhập sai thì sửa lại (cập nhật), không xóa. Muốn ghi chú một dòng (ví dụ đang sửa chữa, để dự phòng) thì gắn **thẻ** — danh sách thẻ admin tạo ở Configuration › Tag.

## Khuôn bảng lịch sử (Configuration và User)

`configuration_histories` và `user_histories` dùng chung khuôn này; chỉ khác cột trỏ về đối tượng. (Ba loại tài sản dùng [`asset_logs`](#6-asset_logs--nhật-ký-tài-sản).)

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `<đối tượng>_id` | uuid | ✔ | | **không** FK (cố ý — lịch sử còn lại sau khi dòng gốc bị xóa); index (`<đối tượng>_id`, `created_at desc`) | Đối tượng bị thay đổi |
| `label` | text | ✔ | | | Tên đối tượng lúc thay đổi để hiển thị, ví dụ `display_name` của dòng cấu hình, `username` — vẫn đọc được sau khi đối tượng bị xóa |
| `action` | text | ✔ | | danh sách cố định theo từng bảng | Hành động |
| `changes` | jsonb | ✔ | `{}` | | Giá trị cũ → mới: `{ trường: { old, new } }`. Trường FK lưu `display_name` tại thời điểm đó. Với `DELETE`: chụp lại toàn bộ dòng trước khi xóa |
| `note` | text | | | | Ghi chú do hệ thống đặt |
| `source` | text | ✔ | `ui` | `ui` / `import` / `script` | Nguồn thay đổi |
| `created_at` | timestamptz | ✔ | now() | index (`created_at desc`) | Thời điểm thay đổi |
| `created_by` | uuid | | | FK `user_profiles` | Người thay đổi |
| `action_id` | uuid | | | partial index (`action_id` khi không null) | **Một thao tác của người dùng = một `action_id`**: mọi dòng nhật ký do cùng một thao tác ghi ra (xem [Thao tác và `action_id`](#thao-tác-và-action_id)) dùng chung id này. Null = dòng cũ / ghi từ SQL tay |

Quy tắc chung của mọi nhật ký (kể cả `asset_logs`):
- **Database tự ghi** bằng trigger trên mỗi bảng chính, trong cùng giao dịch với thay đổi. Server không tự thêm dòng nhật ký.
- Mọi thêm / sửa / xóa đi qua hàm `app_write` (kèm người thao tác, ghi chú, nguồn), hoặc các hàm thao tác riêng (Đổi vị trí, Move, Swap, Detach, Xóa, Check-out / Check-in, Import Excel). Chi tiết ở `database/04_functions.sql`.
- Sửa mà không đổi giá trị nào thì không ghi.
- Mật khẩu không nằm trong bảng nào của project (do Supabase Auth giữ) nên không bao giờ vào nhật ký.
- Chỉ thêm, không sửa / xóa dòng nhật ký (database chặn: `HISTORY_IS_APPEND_ONLY`).

---

## 1. Dashboard

Không có bảng riêng — chỉ đọc từ các module.

| Khối trên Dashboard | Đọc từ | Ai thấy |
| --- | --- | --- |
| Số lượng theo Status — Equipment (In use / Not in use) và Calibration (Calibration Status tự tính); thanh màu cố định | `equipment`, `sub_equipment`, `golden_boards`, `sub_equipment_calibration` | Mọi nhóm |
| Số lượng theo thẻ | `equipment`, `sub_equipment`, `golden_boards` (cột `tag_ids`); tài sản chưa gắn thẻ nằm ở dòng riêng **Untagged** | Mọi nhóm |
| Số lượng theo vị trí / loại | `equipment`, `sub_equipment`, `golden_boards`. Vị trí, loại và thẻ **cùng một phạm vi: mọi tài sản, mỗi tài sản đếm một lần**; golden board (không có Type) nằm ở dòng **No type** — nên tổng các dòng luôn bằng tổng tài sản (riêng thẻ: bản ghi cũ còn nhiều thẻ thì được đếm ở từng thẻ). Mỗi thẻ trên Dashboard có một dòng nói rõ phạm vi | Mọi nhóm |
| Sub-equipment quá hạn / sắp đến hạn hiệu chuẩn | view `sub_equipment_calibration`. Calibration Status của từng sub-equipment được tính **một lần** trong `getDashboard`; KPI, tiêu đề hai danh sách và thanh Status đều lấy số từ đó (`by_calibration_status`). `Failed` (cũng màu đỏ) đếm riêng, không nằm trong Quá hạn | Mọi nhóm |
| **Thay đổi gần đây** — **một thao tác của người dùng = một dòng** | view `recent_actions` (gộp theo `action_id`; kèm các bản ghi bị ảnh hưởng) | Mọi nhóm; thao tác của Configuration và User Management chỉ Admin thấy |

### Thao tác và `action_id`

Một **thao tác** là một hành động của người dùng bấm một lần (một request API): Swap hai thiết bị, Move kèm con cháu, Check-out cả cây, Import một file, lưu form sửa… Mỗi thao tác có thể ghi **nhiều dòng nhật ký** (mỗi bản ghi bị ảnh hưởng một dòng, kể cả con cháu đi theo). Các dòng đó dùng chung một `action_id`:

- **App**: `withAuth` sinh một id cho mỗi request (`lib/services/core/actionContext.ts`); `appWrite` và các hàm ghi dữ liệu truyền xuống database qua `p_action_id`. Nên một lần sửa form gồm nhiều bước (Move + sửa trường + đổi vị trí) vẫn là một thao tác.
- **Database**: `app_write` và 9 hàm (`asset_change_location`, `asset_move`, `asset_detach`, `asset_swap`, `asset_delete`, `asset_set_usage`, `equipment_import`, `sub_equipment_import`, `golden_import`) nhận `p_action_id uuid default null` và đặt vào ngữ cảnh giao dịch; trigger `write_history` ghi nó vào mọi dòng nhật ký. Không truyền (script, SQL) thì hàm tự sinh một id cho mỗi lần gọi.
- Tab Lịch sử của từng bản ghi **không đổi** (vẫn một dòng cho mỗi bản ghi); chỉ "Thay đổi gần đây" gộp.
- Dòng cũ (null) hiện như một thao tác riêng — riêng import cũ vẫn gộp theo (module, người import, lần import) như trước. Gộp thêm các thao tác cũ là tùy chọn: `database/migrations/2026-10-15_action_id_backfill_OPTIONAL.sql`.

Các thao tác ghi nhiều dòng nhật ký trong một lần của người dùng: Swap · Move (Gắn vào / Đổi cha) · Detach · Đổi vị trí · Xóa tài sản (kèm con thành chưa gắn) · Check-out / Check-in · Import Excel (Equipment, Calibration, Golden) · sửa form Equipment / Calibration / Golden (nhiều bước) · sửa tài khoản (nhóm quyền + thông tin). Ghi nhận một lần hiệu chuẩn chỉ ghi **một** dòng (due_date do trigger tính ngay trong dòng đó).

### View `recent_actions` — thay đổi gần đây theo thao tác (tính khi đọc, không lưu)

Một dòng mỗi thao tác (gộp các dòng của `asset_logs`, `configuration_histories`, `user_histories` có cùng `action_id`), mới nhất lên đầu. `security_invoker = true`, chỉ `service_role` đọc được.

| Trường | Ý nghĩa |
| --- | --- |
| `id` | `action_id` (dòng cũ: id dòng nhật ký, hoặc khóa gộp của import cũ) |
| `module`, `action`, `source`, `created_by` | Của bản ghi **đứng đầu** (bản ghi chính trước, bản ghi đi theo sau) |
| `modules` | Mọi module có bản ghi trong thao tác — lọc theo module (`@>`) và phân quyền (không phải Admin: `<@ {equipment, sub_equipment, golden_board}`) |
| `created_at` | Lúc bắt đầu thao tác (nhỏ nhất của các dòng) — lọc ngày và sắp xếp theo đây |
| `item_count` | Tổng số dòng nhật ký của thao tác |
| `records` | Các bản ghi bị ảnh hưởng: `module, object_id, label, action, changes, note, from_location, to_location` — **tối đa 50**, theo thứ tự ghi (bản ghi chính trước; bản ghi đi theo có `note` `via_parent:` / `parent_deleted:` sau) |
| `search_text` | Tên / serial của **mọi** bản ghi trong thao tác (ngăn bằng `chr(31)`) — tìm theo bất kỳ bản ghi nào cũng khớp |

Giới hạn "Xem thêm" của Dashboard tính theo **thao tác**, không phải dòng nhật ký.

### View `recent_activities` — nhật ký từng dòng (giữ lại để tương thích)

Gộp `asset_logs`, `configuration_histories`, `user_histories` thành một danh sách, mới nhất lên đầu. Không chứa dữ liệu riêng.

| Trường | Nguồn | Ý nghĩa |
| --- | --- | --- |
| `module` | `asset_logs.asset_type` hoặc tên bảng | `equipment` / `sub_equipment` / `golden_board` / `configuration` / `user` |
| `object_id` | `asset_id` / `record_id` / `user_id` | Đối tượng bị thay đổi — bấm để mở chi tiết (nếu chưa bị xóa) |
| `label` | `label` | Tên đối tượng, ví dụ `SN-001` |
| `action` | `action` | Hành động, ví dụ `UPDATE`, `CHANGE_LOCATION`, `CALIBRATE` |
| `changes` | `old_value` + `new_value` (hàm `asset_log_changes`) / `changes` | Giá trị cũ → mới `{ trường: { old, new } }` |
| `created_by` | `user_id` / `created_by` | Người thay đổi |
| `created_at` | `created_at` | Thời điểm |
| `note` | `reason` / `note` | Ghi chú (`via_parent:`, `swap_with:`…) |
| `source` | `source` | `ui` / `import` / `script` |
| `item_count` | tính | 1; Import Excel ghi mỗi dòng một bản ghi cùng `created_at` nên gộp thành **một** dòng cho mỗi (module, người import, lần import) và `item_count` = số dòng của lần import đó |

View nằm ở `04_functions.sql` (chạy lại được, không cần dựng lại bảng). Trên Dashboard: mặc định hiện 50 thay đổi mới nhất (một lần import tính là một); lọc được theo module, người thay đổi, khoảng thời gian.

---

## 2. Overview

Trang **Overview** là **bảng thẻ theo Location**. Không có bảng riêng: một hàm duy nhất `overview_board` (`04_functions.sql` mục 5) đọc [cây tài sản](#cây-tài-sản) của cả ba bảng và trả về **toàn bộ bảng trong một lần gọi** — không còn tải từng nhánh.

**Cột và thẻ.** Mỗi *cột* là một tài sản **gốc** (không có cha): Tester, rồi Base / Fixture / sub-equipment / golden board chưa gắn ("Chưa gắn"). Các cột nhóm theo Location (sắp theo `locations.sort_order`, rồi tên; Location không còn cột nào thì không có dòng); trong một Location, Tester đứng trước, mỗi nhóm theo serial. Một cột có **tối đa 3 thẻ, tính cả thẻ gốc**: thẻ gốc + 2 thẻ khác chọn trong cả cây (Tester → Base → Fixture → Golden, mọi cấp), kể cả các thẻ cha cần để đường cây không đứt; phần còn lại là "+N thiết bị".

Hàm `overview_board(p_usage, p_kind, p_q)` — ba bộ lọc, mặc định `null` = bỏ qua, kết hợp **và**:

| Tham số | Giá trị | Một thẻ khớp khi |
| --- | --- | --- |
| `p_usage` | `in_use` · `not_in_use` | Status đúng |
| `p_kind` | `tester` · `base` · `fixture` · `sub_equipment` · `golden_board` | đúng loại |
| `p_q` | chữ bất kỳ | serial **hoặc** part number chứa chữ đó (không phân biệt hoa thường; `%` và `_` là chữ thường; chữ trống = không lọc) |

`p_usage` / `p_kind` sai → `VALIDATION_ERROR`. **Có bộ lọc thì chỉ giữ cột có ít nhất một tài sản khớp** — thẻ gốc hoặc bất kỳ thẻ nào trong cây, kể cả thẻ không hiện — và `matched` đánh dấu thẻ khớp. Không có bộ lọc thì `matched` luôn `false`. Bộ lọc chạy trong database (không phải ở trình duyệt) vì một thẻ khớp có thể đang nằm sau "+N": hàm phải biết bộ lọc để chọn nó lên.

**Chọn thẻ** — mỗi cột tối đa 3 thẻ **tính cả thẻ gốc** (hằng `v_max_cards` trong hàm; đổi số đó là đổi số thẻ hiện). Xét lần lượt theo thứ tự ưu tiên:

1. thẻ **khớp bộ lọc** (chỉ khi có lọc — để thẻ tìm được luôn hiện);
2. **cảnh báo hiệu chuẩn**: `overdue` / `failed` (cùng hạng), rồi `due_soon`;
3. **Base → Fixture → Golden → Sub-equipment**;
4. serial (và `id`) — nên hai lần gọi giống nhau luôn cho cùng kết quả.

Thẻ nào cần thẻ cha thì **thẻ cha cũng tính vào 3**, nên đường cây không đứt (Fixture dưới Base = Base + Fixture, hết chỗ; Golden ở cấp 3 cần thêm hai thẻ cha nên không vừa). Thẻ không vừa chỗ thì **bỏ qua** và xét thẻ kế tiếp. **Ngoại lệ duy nhất**: thẻ khớp bộ lọc đứng đầu luôn hiện cùng các thẻ cha của nó, dù cột thành cao hơn 3 — nên một thẻ tìm được không bao giờ nằm sau "+N" (các thẻ khớp còn lại tuân theo giới hạn). Thẻ cha được thêm vào vẫn mang `matched` thật của chính nó (thường là `false`). Vị trí vẽ trong cột là thứ tự cây (`pos`): anh em theo Base → Fixture → Golden → Sub rồi serial.

Mỗi dòng trả về là một thẻ:

| Cột | Ý nghĩa |
| --- | --- |
| `location_id`, `location` | Location của cột (cả cột cùng một Location: database ép tài sản có cha luôn cùng vị trí với cha) |
| `root_id` | Khóa của cột = `id` của thẻ gốc |
| `asset_type`, `id` | Bảng (`equipment` / `sub_equipment` / `golden_board`) và id — mở modal bằng `/overview?id=&type=` |
| `kind` | `tester` · `base` · `fixture` · `sub_equipment` · `golden_board` |
| `type_name` | Tên Type (Tester, Base, Fixture, DMM…). Golden board không có Type → `null` (giao diện ghi "Golden"; sub-equipment ghi "Sub (DMM)") |
| `part_number`, `serial_number` | PN, SN (golden board: PN là chữ gõ tự do) |
| `usage` | Status — viền trái của thẻ |
| `cal_alert` | Cảnh báo hiệu chuẩn **xấu nhất** trong thẻ và mọi con cháu: `failed` · `overdue` (đỏ), `due_soon` (vàng), `null` = không có. Chỉ sub-equipment có cảnh báo riêng; thẻ Tester có `cal_alert` khi có con bị |
| `parent_id`, `depth` | Cha và độ sâu (gốc = 0, tối đa 3) — để vẽ đường cây |
| `descendants` | Số con cháu **đủ** của thẻ, kể cả thẻ không hiện, không phụ thuộc bộ lọc |
| `alerts` | Số sub-equipment có cảnh báo trong thẻ và con cháu của nó |
| `matched` | Thẻ khớp bộ lọc |
| `pos` | Vị trí trong cột theo thứ tự vẽ (thẻ gốc = 1) |

Giao diện tính các con số từ chính những dòng này: **"+N thiết bị"** = `descendants` của thẻ gốc − (số dòng của cột − 1); **header section** — số tester = số cột `kind = tester`, số In use = số cột `usage = in_use` (chỉ Tester được In use khi không có cha, nên đó là số Tester In use), số ⚠ = tổng `alerts` của các thẻ gốc.

**Tốc độ.** Hàm đọc cả ba bảng một lần, thời gian không phụ thuộc số cột. Đo trên PGlite (Postgres chạy trong Node, chậm hơn Postgres thật): 820 tài sản ≈ 50 ms; 5.000 tài sản ≈ 0,3 s, kể cả khi thống kê của planner chưa kịp cập nhật (ngay sau một lần Import lớn). Việc chọn thẻ là một truy vấn đệ quy theo thứ tự ưu tiên, dừng khi cột đầy nên chỉ vài vòng dù một cột có hàng trăm thẻ. Hai điều giữ tốc độ, đừng bỏ: các CTE trung gian `materialized` (tính một lần — bản đầu để Postgres nhúng CTE vào truy vấn và tính lại cho từng thẻ: 110 s cho 820 tài sản) và `set enable_nestloop = off` trên hàm (kế hoạch luôn là nối băm; không đặt thì 0,4 s khi thống kê mới nhưng 5 s khi chưa có). `assets.test.mjs` có bài kiểm tra quy mô.

Tab **Cây thiết bị** trong modal không dùng hàm này (bảng chỉ hiện tối đa 3 thẻ mỗi cột): nó có hàm riêng `asset_tree` (bên dưới), qua `GET /api/equipment/{id}/tree` ([DETAIL_MODEL.md](DETAIL_MODEL.md) 4.1).

**Cây đầy đủ — `asset_tree(p_type, p_id)`** (`04_functions.sql` mục 5b). Trả cây **chứa** một tài sản: từ tài sản gốc của nó (đi ngược theo cha) xuống mọi con cháu, ở cả ba bảng, trong **một lần gọi**. Dùng cho tab Cây thiết bị **và** cho chip thiết bị con + tóm tắt hiệu chuẩn của modal Equipment — modal tải cây một lần cho cả ba. Mỗi dòng: `asset_type`, `id`, `kind`, `type_name` (golden board: `null`), `part_number`, `serial_number`, `usage`, `cal_status` (sub-equipment: Calibration Status; còn lại `null`), `parent_id` (gốc: `null`), `depth` (gốc = 0), `pos` (thứ tự cây: anh em Base → Fixture → Golden → Sub rồi serial). Tài sản không tồn tại → không có dòng (app trả `NOT_FOUND`). Chỉ đọc các dòng thuộc cây (tìm con bằng `asset_children`), không quét cả bảng: cây 412 tài sản (một tester 400 sub-equipment) ≈ 32 ms trên PGlite. Trước đó tab đi ba vòng mạng nối nhau (≈ 0,75 s qua proxy); nay một vòng (≈ 0,25 s).

Hai hàm của cây cũ — `overview_children` và `overview_unattached_count` — **đã bỏ**. Database dựng mới không có chúng; database đang có dữ liệu xem `database/migrations/2026-10-09_overview_board.sql` ([database/README.md](../database/README.md)).

---

## 3. Equipment

Tester, base, fixture. Cây Tester ⊃ Base ⊃ Fixture; sub-equipment và golden board gắn vào ở bảng riêng của chúng.

### `equipment` — thiết bị

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | Mã bất biến; dùng trong link QR — xem [Link QR](#link-qr) |
| `jabil_id` | text | | | | Mã nội bộ Jabil, ví dụ P12316 |
| `part_number_id` | uuid | ✔ | | FK `part_numbers`; index | Mã part — **bắt buộc**; phải thuộc loại tester / base / fixture (`TYPE_KIND_INVALID`) |
| `serial_number` | text | ✔ | | index `lower(serial_number)`; check không rỗng; **không** UQ — trùng chỉ cảnh báo; database tự `btrim` | Số serial in trên thiết bị |
| `asset` | text | | | index | Mã tài sản kiểm kê |
| `type_id` | uuid | ✔ | | FK `types`; index | Loại thiết bị — **bắt buộc và luôn bằng Type của part number** (database tự đặt khi thêm / sửa / import; form khóa ô, ghi "theo part number"; người dùng không chọn tay) |
| `usage` | text | ✔ | `not_in_use` | check `in_use` / `not_in_use`; index | **Status** — xem [Status](#status-usage--check-out--check-in) |
| `level_id` | uuid | | | FK `levels` | Level trên dây chuyền. Có cha → **luôn bằng Level của cha** (database tự đặt khi thêm / sửa / Đổi cha / Swap / import; form khóa ô, ghi "theo thiết bị cha"). Không có cha → **bắt buộc** (form, API và Import Excel đòi; form điền sẵn Level của part number, sửa được); Tách khỏi cha giữ Level đang có. Database vẫn cho trống để dữ liệu và thao tác cũ (Check-out, Move…) không bị chặn — thiết bị cũ chưa có Level phải chọn khi sửa lần sau |
| `location_id` | uuid | ✔ | | FK `locations`; index | Vị trí hiện tại; có cha thì tự theo vị trí của cha |
| `remark` | text | | | check ≤ 1000 ký tự | Ghi chú tự do |
| `tag_ids` | uuid[] | ✔ | `{}` | Mỗi phần tử là `tags.id`; GIN index. Database kiểm tra mọi lần ghi (`04_functions.sql` mục 3e): bỏ trùng, thẻ phải có thật. Xóa thẻ đang gắn → `TAG_IN_USE` | **Thẻ** tình trạng người dùng chọn (không nằm trong chữ của Remark), **mỗi lần chọn một thẻ** (từ 14/10/2026: form và API chỉ nhận tối đa một phần tử; cột vẫn là mảng, bản ghi cũ có nhiều thẻ vẫn hiện đủ cho tới khi người dùng chọn lại; Import Excel chưa giới hạn); rỗng = chưa gắn thẻ. Độc lập với Status |
| `parent_id` | uuid | | | FK `equipment` (`on delete restrict` — không xóa được cha khi còn con; xóa qua `asset_delete`); check `id <> parent_id`; index | Thiết bị cha — xem [Cây tài sản](#cây-tài-sản); đặt khi thêm (form, import Excel), đổi trong form Sửa hoặc qua Move / Swap / Detach |
| `created_at` | timestamptz | ✔ | now() | | |
| `created_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |

Quy tắc nghiệp vụ (chi tiết ở [Cây tài sản](#cây-tài-sản), [Status](#status-usage--check-out--check-in), [Swap](#swap)):
- Thiết bị con luôn cùng vị trí và cùng Level với thiết bị cha. Cha đổi Level → cả cây `equipment` con đổi theo, nhật ký của con ghi chú `via_parent:<SN>`.
- Thao tác trên thiết bị **có con**: Đổi vị trí, Move, Swap → cả nhánh con đi theo; Xóa → con trực tiếp thành chưa gắn (mục [Cây tài sản](#cây-tài-sản)). Không có lựa chọn "con đi theo / ở lại".

Trường trên form thiết bị (theo thứ tự): Serial Number ✔, Part Number ✔ (chỉ liệt kê part number loại tester / base / fixture), Jabil ID, Asset, Type ✔ (tự điền theo part number và khóa), Level (có cha → theo cha và khóa), Thiết bị cha (Thêm thiết bị con: điền sẵn và khóa; chỉ liệt kê thiết bị do `valid_parents` trả về — đúng loại cha), Location ✔ (trừ khi có cha), Thẻ, Remark. Status không có trên form (đổi bằng Check-out / Check-in). Import Excel: cột Part number bắt buộc, cột Type để trống (ghi đúng Type của part number cũng được), có Parent thì để trống cột Level (ghi đúng giá trị đó cũng được; ghi khác → lỗi dòng). Có cha thì `location_id`, `level_id` = của cha (server tự đặt, bỏ qua giá trị gửi lên). Sửa `parent_id` trong form: cha mới → server gọi `asset_move` (nhật ký `MOVE`), bỏ trống → `asset_detach` (`DETACH`). Import Excel: cột Parent serial number + Parent part number (tìm cha trong hệ thống hoặc trong cùng file), cột Status và Tags (không bắt buộc); hàm `equipment_import` nhận sẵn `id`, `parent_id`, `usage` (Status: theo cha, hoặc ô Status, hoặc Not in use) và `tag_ids` của từng dòng do server đặt — thiếu `usage` / `tag_ids` (app cũ) thì Not in use và không có thẻ. Status vẫn qua `asset_usage_rule` (chỉ Tester In use khi không có cha) và thẻ qua `tag_ids_check`.

Nhật ký của `equipment`: xem [`asset_logs`](#6-asset_logs--nhật-ký-tài-sản) (`asset_type = equipment`). Thiết bị đã xóa: tra cứu theo serial (đọc `old_value` của dòng `DELETE`).

---

## 4. Calibration

Thiết bị **cần hiệu chuẩn** là **sub-equipment** nằm trong tester (DMM, power supply, card…). Mỗi lần hiệu chuẩn là một dòng `calibrations`.

| Trang | Làm gì | Bảng |
| --- | --- | --- |
| Calibration | Danh sách sub-equipment kèm Calibration Status và lần hiệu chuẩn gần nhất: thêm / sửa sub-equipment, **ghi nhận hiệu chuẩn** (thêm một dòng `calibrations`), xem lịch sử hiệu chuẩn | `sub_equipment`, `calibrations` |

Chu kỳ và vendor cấu hình ở [Configuration](#7-configuration). **Calibration Status** do hệ thống tự tính (view `sub_equipment_calibration`), không ai chọn, không lưu. Dựa vào lần hiệu chuẩn **mới nhất** (`calibrated_at` lớn nhất) và Setup của part number:

| Calibration Status | Khi nào |
| --- | --- |
| `not_calibrated` | Chưa hiệu chuẩn lần nào |
| `failed` | Lần hiệu chuẩn mới nhất **không đạt** (`result = fail`) |
| `overdue` | `due_date` đã qua |
| `due_soon` | `due_date` còn ≤ `warning_days` ngày (Setup; mặc định 30 nếu part number chưa có Setup) |
| `valid` | Còn lại |

"Hôm nay" theo giờ Việt Nam (`Asia/Ho_Chi_Minh`). Ngày đến hạn tự tính, xem bên dưới.

### `sub_equipment` — thiết bị cần hiệu chuẩn

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `jabil_id` | text | | | | Mã nội bộ Jabil |
| `part_number_id` | uuid | ✔ | | FK `part_numbers`; index | Mã part — phải thuộc loại sub_equipment (`TYPE_KIND_INVALID`) |
| `serial_number` | text | ✔ | | index `lower(serial_number)`; check không rỗng; **không** UQ — trùng chỉ cảnh báo; database tự `btrim` | Số serial |
| `asset` | text | | | index | Mã tài sản kiểm kê |
| `type_id` | uuid | ✔ | | FK `types`; index | Loại (DMM, Power supply, Card…) — **luôn bằng Type của part number**, như `equipment`. Cùng Type mới Swap được với nhau |
| `tester_id` | uuid | | | FK `equipment` (`on delete set null`); index; **chỉ equipment loại tester** (`PARENT_TYPE_INVALID`) | Tester chứa nó; trống = chưa gắn (đang nằm kho). Xóa tester → trống, sub-equipment không bị xóa |
| `location_id` | uuid | ✔ | | FK `locations`; index | Vị trí. Có tester → **luôn bằng vị trí của tester** (database tự đặt); chưa gắn → vị trí riêng |
| `usage` | text | ✔ | `not_in_use` | check `in_use` / `not_in_use`; index | **Status** — xem [Status](#status-usage--check-out--check-in); gắn vào tester thì lấy Usage của tester |
| `remark` | text | | | check ≤ 1000 ký tự | Ghi chú tự do |
| `tag_ids` | uuid[] | ✔ | `{}` | Như `equipment.tag_ids` | Thẻ tình trạng |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

- Xóa sub-equipment là xóa thật; các dòng `calibrations` của nó xóa theo (nhật ký `DELETE` của sub-equipment đã chụp lại cả dòng; các lần hiệu chuẩn đã ghi `CALIBRATE` trong `asset_logs` vẫn còn).
- Form: Serial Number ✔, Part Number ✔ (chỉ part number loại sub_equipment), Type (tự điền, khóa), Jabil ID, Asset, Tester (chỉ liệt kê tester), Location ✔ (trừ khi có tester), Thẻ, Remark. Import Excel: như Equipment (cột Tester serial number để gắn).

### `calibrations` — lịch sử hiệu chuẩn

Mỗi lần hiệu chuẩn thêm **một** dòng; các lần trước giữ nguyên làm lịch sử.

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ai nhập | Ý nghĩa |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | | |
| `sub_equipment_id` | uuid | ✔ | | FK `sub_equipment` (`on delete cascade`); index (`sub_equipment_id`, `calibrated_at desc`) | User | Sub-equipment được hiệu chuẩn |
| `calibrated_at` | date | ✔ | | | User | Ngày hiệu chuẩn |
| `due_date` | date | ✔ | | check ≥ `calibrated_at`; index | **Tự tính** | Part number có Setup: `calibrated_at` + `interval_months` (database tự tính, ghi đè giá trị gửi lên; tính lại khi `calibrated_at` đổi). Part number chưa có Setup: **bắt buộc nhập** (`CALIBRATION_INTERVAL_MISSING` nếu thiếu) |
| `vendor_id` | uuid | | | FK `calibration_vendors` | User | Vendor thực hiện |
| `cert_no` | text | | | | User | Số chứng nhận |
| `cert_file_url` | text | | | | User | Đường dẫn tới file chứng nhận (SharePoint / OneDrive…) — chưa upload lên Supabase Storage |
| `result` | text | ✔ | `pass` | check `pass` / `fail` | User | Kết quả; `fail` → Calibration Status = `failed` |
| `remark` | text | | | check ≤ 1000 ký tự | User | Ghi chú của lần hiệu chuẩn |
| `created_by` | uuid | | | FK `user_profiles` | | |
| `created_at` | timestamptz | ✔ | now() | | | |
| `updated_by` | uuid | | | FK `user_profiles` | | |
| `updated_at` | timestamptz | ✔ | now() | | | |

- Sửa một lần hiệu chuẩn nhập sai: được (nhật ký `CALIBRATION_UPDATE`); xóa chỉ Admin (`CALIBRATION_REMOVE`).
- Admin đổi `interval_months` của Setup chỉ áp dụng cho các lần hiệu chuẩn **sau**: `due_date` đã tính không bao giờ tự đổi (kể cả khi sửa remark của lần cũ); không có nhật ký phụ. Sửa `calibrated_at` của một lần thì `due_date` của lần đó tính lại theo chu kỳ hiện tại.
- Quá hạn / sắp đến hạn không lưu trong database và **không** gửi thông báo: tô màu cột `due_date` (đỏ = quá hạn, vàng = còn ≤ `warning_days` ngày), dấu ⚠ trên thẻ Tester và thẻ sub-equipment ở Overview và liệt kê trên Dashboard.

### View `sub_equipment_calibration`

Mỗi sub-equipment một dòng: `sub_equipment_id`, lần hiệu chuẩn mới nhất (`calibration_id`, `calibrated_at`, `due_date`, `vendor_id`, `cert_no`, `cert_file_url`, `result`), `interval_months`, `warning_days` (từ Setup, trống nếu chưa có Setup) và **`status`** (Calibration Status ở trên). Là nguồn duy nhất cho danh sách Calibration, Overview và Dashboard.

Nhật ký: [`asset_logs`](#6-asset_logs--nhật-ký-tài-sản) (`asset_type = sub_equipment`); mỗi lần hiệu chuẩn ghi `CALIBRATE`.

---

## 5. Golden board

Golden board = PCBA tốt đã biết kết quả, dùng trên line để kiểm tra tester / thiết bị.

| Trang | Làm gì | Bảng |
| --- | --- | --- |
| Golden | Danh sách golden board: thêm / sửa / xóa, đổi vị trí, gắn vào tester / fixture | `golden_boards` |

Xóa golden board là xóa thật; nhật ký vẫn còn trong `asset_logs`.

### `golden_boards` — golden board

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `part_number` | text | ✔ | | index; gõ tự do | Part number của PCBA |
| `serial_number` | text | ✔ | | index `lower(serial_number)`; check không rỗng; gõ tự do; **không** UQ — trùng chỉ cảnh báo; database tự `btrim` | Số serial của PCBA |
| `utd_part_number` | text | | | gõ tự do | UTD part number |
| `origin` | text | | | gõ tự do | Nguồn gốc |
| `purpose` | text | | | gõ tự do | Mục đích sử dụng |
| `parent_id` | uuid | | | FK `equipment` (`on delete set null`); index; **chỉ equipment loại tester hoặc fixture** (`PARENT_TYPE_INVALID`) | Tester / fixture chứa nó; trống = chưa gắn. Xóa cha → trống, golden board không bị xóa |
| `location_id` | uuid | ✔ | | FK `locations.id`; index | Vị trí. Có cha → **luôn bằng vị trí của cha** (database tự đặt); chưa gắn → vị trí riêng |
| `usage` | text | ✔ | `not_in_use` | check `in_use` / `not_in_use`; index | **Status** — chỉ In use được khi đã gắn cha (`USAGE_NEEDS_PARENT`); gắn vào cha thì lấy Usage của cha |
| `remark` | text | | | check ≤ 1000 ký tự | Ghi chú tự do |
| `tag_ids` | uuid[] | ✔ | `{}` | Như `equipment.tag_ids` | Thẻ tình trạng, ví dụ Pass / Fail |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Form: Part Number ✔, Serial Number ✔, UTD part number, Origin, Purpose, Gắn vào (tester / fixture), Location ✔ (trừ khi có cha), Thẻ, Remark. Import Excel: như Equipment (cột Parent serial number để gắn).

---

## 6. `asset_logs` — nhật ký tài sản

Một bảng cho cả ba loại tài sản. Database tự ghi bằng trigger, trong cùng giao dịch với thay đổi.

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `asset_type` | text | ✔ | | `equipment` / `sub_equipment` / `golden_board` | Loại tài sản |
| `asset_id` | uuid | ✔ | | **không** FK (cố ý — nhật ký còn lại sau khi tài sản bị xóa); index (`asset_type`, `asset_id`, `created_at desc`) | Tài sản bị thay đổi (lần hiệu chuẩn ghi vào sub-equipment của nó) |
| `label` | text | ✔ | | | Serial lúc thay đổi — vẫn đọc được sau khi tài sản bị xóa |
| `action` | text | ✔ | | danh sách bên dưới | Hành động |
| `old_value` | jsonb | | | | Các trường **đổi**: `{ trường: giá trị cũ }`. Trường FK lưu tên hiển thị lúc đó; thẻ lưu tên thẻ (trường `tags`). `CREATE`: trống. `DELETE`: chụp lại cả dòng |
| `new_value` | jsonb | | | | Các trường đổi: `{ trường: giá trị mới }`. `CREATE`: cả dòng mới. `DELETE`: trống |
| `from_location` | text | | | | Tên vị trí trước — chỉ khi vị trí đổi (hoặc `DELETE`) |
| `to_location` | text | | | | Tên vị trí sau — chỉ khi vị trí đổi (hoặc `CREATE`) |
| `reason` | text | | | | Lý do do người dùng nhập (Check-out / Check-in…) hoặc mã hệ thống: `via_parent:<SN>` (thay đổi theo thiết bị cha), `swap_with:<SN>`, `parent_deleted:<SN>` (cha bị xóa, con thành chưa gắn). Màn hình dịch sang chữ dễ đọc |
| `source` | text | ✔ | `ui` | `ui` / `import` / `script` | Nguồn thay đổi |
| `user_id` | uuid | | | FK `user_profiles` | Người thay đổi |
| `created_at` | timestamptz | ✔ | now() | index (`created_at desc`) | Thời điểm |
| `action_id` | uuid | | | partial index (`action_id` khi không null) | Cùng một thao tác của người dùng (Swap hai thiết bị, Move kèm con cháu, Check-out cả cây, Import, sửa form nhiều bước…) = cùng `action_id` — xem [Thao tác và `action_id`](#thao-tác-và-action_id). Tab Lịch sử của từng tài sản **không đổi**: vẫn mỗi tài sản một dòng nhật ký riêng |

| `action` | Khi nào |
| --- | --- |
| `CREATE` | Thêm tài sản (form hoặc import) |
| `UPDATE` | Sửa thông tin |
| `CHANGE_LOCATION` | Đổi vị trí (ghi cho tài sản được đổi và từng con đi theo) |
| `MOVE` | Gắn vào / đổi cha |
| `DETACH` | Tách khỏi cha (hoặc cha bị xóa) |
| `SWAP` | Đổi chỗ với tài sản khác cùng loại |
| `CHECK_OUT` / `CHECK_IN` | Not in use → In use / In use → Not in use (ghi cho tài sản được chọn và từng con cháu) |
| `TAGS` | Chỉ đổi thẻ (cũ → mới theo tên thẻ; đổi thứ tự chọn mà cùng tập thẻ thì không ghi) |
| `DELETE` | Xóa (ghi cho **từng** tài sản trong cây khi xóa cha) |
| `CALIBRATE` | Ghi nhận một lần hiệu chuẩn (thêm dòng `calibrations`) |
| `CALIBRATION_UPDATE` / `CALIBRATION_REMOVE` | Sửa / xóa một lần hiệu chuẩn (kể cả `due_date` tính lại khi Admin đổi chu kỳ) |

`action` được nhận ra từ các trường thay đổi (chỉ đổi vị trí → `CHANGE_LOCATION`, chỉ đổi thẻ → `TAGS`, đổi cha → `MOVE` / `DETACH`), trừ `SWAP`, `CHECK_OUT`, `CHECK_IN` do hàm thao tác đặt.

Tab History của tài sản đọc bảng này (lọc theo `asset_type` + `asset_id`). Import Excel ghi mỗi dòng một bản ghi cùng `created_at`; Dashboard gộp thành một dòng.

---

## 7. Configuration

Mọi trang cấu hình nằm ở menu **Configuration**, chỉ **Admin** vào được. Form ở các module chỉ chọn từ các danh sách này, không gõ tự do.

| Trang | Bảng | Được dùng bởi |
| --- | --- | --- |
| Configuration › Part Number | `part_numbers` | `equipment`, `sub_equipment`, `calibration_configurations` |
| Configuration › Location | `locations` | `equipment`, `sub_equipment`, `golden_boards` |
| Configuration › Type | `types` | `part_numbers`, `equipment`, `sub_equipment` |
| Configuration › Group | `type_groups` | `types` (cột Group) |
| Configuration › Tag | `tags` | `equipment`, `sub_equipment`, `golden_boards` (cột `tag_ids`) |
| Configuration › Level | `levels` | `equipment`, `part_numbers` |
| Configuration › Department | `departments` | `user_profiles` |
| Configuration › Hiệu chuẩn › Setup | `calibration_configurations` | `calibrations` (chu kỳ tính `due_date`), `sub_equipment_calibration` (`warning_days`) |
| Configuration › Hiệu chuẩn › Vendor | `calibration_vendors` | `calibrations` |

Quy tắc:
- **Xóa** = ẩn (`is_active = false`): dòng đang dùng giữ nguyên, nhưng không chọn được cho dữ liệu mới. Riêng `tags` (bị chặn khi đang được dùng) và `calibration_configurations` (sub-equipment của part number đó không còn chu kỳ — `due_date` các lần hiệu chuẩn sau phải nhập tay) xóa thật. Ba loại hệ thống của `types` (Tester, Base, Fixture) không xóa, không ẩn được.
- `display_name` không được trùng trong cùng bảng.
- Import Excel: tìm theo `display_name` (không phân biệt hoa/thường). Giá trị chưa có (hoặc đã ẩn) → báo lỗi dòng đó là "chưa có", không tự tạo mới.

### `part_numbers` — mã part

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Mã part |
| `type_id` | uuid | ✔ | | FK `types`; index | Loại thiết bị của part number — Admin chọn khi thêm part number. `kind` của Type quyết định part number dùng cho **equipment** (tester / base / fixture) hay **sub_equipment**. **Chỉ đổi được khi chưa thiết bị nào dùng part number này** (`PART_NUMBER_IN_USE`) |
| `level_id` | uuid | | | FK `levels`; index | Level của part number — Admin chọn trong Configuration › Level khi thêm / sửa part number (không bắt buộc; đổi được bất cứ lúc nào). Chỉ là giá trị **điền sẵn** cho Level của thiết bị khi thêm thiết bị mang part number này; thiết bị không bị ép theo, và đổi Level của part number không đổi thiết bị đã có |
| `description` | text | | | | Mô tả part number (cột **Mô tả** ở Configuration › Part Number). Không bắt buộc, tối đa 1000 ký tự (app kiểm tra). Trước 14/10/2026 cột này nằm ở `types` — đã chuyển sang đây, mô tả cũ của Type không được chuyển theo |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị |
| `is_active` | boolean | ✔ | `true` | | `false` = ngừng dùng cho dữ liệu mới |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Quy tắc Type theo part number (`04_functions.sql` mục 3b):
- Thiết bị có part number luôn mang `type_id` của part number — database tự đặt cho mọi đường ghi (form, Import Excel, script); người dùng không sửa được Type của thiết bị đó.
- Part number phải đúng loại của bảng: `equipment` dùng Type kind tester / base / fixture, `sub_equipment` dùng Type kind sub_equipment — sai → `TYPE_KIND_INVALID`. Form chỉ liệt kê part number đúng loại.
- **Type của part number chỉ đổi được khi chưa thiết bị nào dùng nó** (`PART_NUMBER_IN_USE`), nên không phải lan Type sang thiết bị. Gõ nhầm Type sau khi đã dùng: tạo part number mới rồi đổi part number của từng thiết bị (cùng Type).
- Type của một `equipment` không đổi sau khi tạo: đổi part number của nó chỉ sang part number cùng Type (`TYPE_KIND_INVALID`); cần loại khác thì xóa rồi tạo lại.
- Type đã ẩn: part number đang trỏ tới vẫn giữ; thêm / đổi part number sang Type đã ẩn thì bị chặn.
- Level (`level_id`): chỉ chọn Level đang dùng (giữ Level đã ẩn thì được); bỏ trống / xóa trắng được. Level còn được part number tham chiếu thì không xóa được (Level chỉ ẩn, không xóa thật).

### `locations` — vị trí

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Tên vị trí, ví dụ `B3F1` hoặc `Building 3 - Floor 1` — admin đặt sao hiển thị vậy |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị và sắp xếp mặc định của danh sách |
| `is_active` | boolean | ✔ | `true` | | `false` = ngừng dùng cho dữ liệu mới |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

### `types` — loại

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Tên loại |
| `kind` | text | ✔ | `sub_equipment` | `tester` / `base` / `fixture` / `sub_equipment`; không đổi sau khi tạo; **UQ** riêng cho 3 loại hệ thống (mỗi loại đúng một dòng) | Loại hệ thống: `tester` / `base` / `fixture` → thiết bị thuộc bảng `equipment`; `sub_equipment` → bảng `sub_equipment`. **Luôn bằng `kind` của nhóm (`group_id`) — database tự đặt, không gửi lên** |
| `group_id` | uuid | ✔ | nhóm cùng `kind` đầu tiên khi không nói | FK `type_groups`; index | Nhóm của Type (cột **Group** ở Configuration › Type). Admin chọn trong các nhóm `sub_equipment` đang dùng; 3 Type hệ thống nằm cố định trong 3 nhóm hệ thống cùng tên |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị |
| `is_active` | boolean | ✔ | `true` | | |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Quy tắc:
- **3 loại hệ thống** Tester, Base, Fixture (`03_seed.sql`, bắt buộc): hệ thống dựa vào chúng để biết thiết bị thuộc bảng nào và nằm dưới ai. Không xóa, không ẩn, không đổi `kind` (`TYPE_SYSTEM_LOCKED`); đổi tên hiển thị thì được. Trang Configuration › Type không có nút thêm loại hệ thống.
- **Loại sub_equipment** (DMM, Power supply, Card…): Admin tự thêm / sửa / ẩn ở Configuration › Type; không có dữ liệu mẫu. Chọn loại này ở Configuration › Part Number để part number dùng cho sub-equipment.
- **Group**: mỗi Type thuộc một nhóm (`group_id`, bắt buộc). Trigger `types_00_group_kind` đặt `kind` theo nhóm nên đổi nhóm giữa các nhóm `sub_equipment` không đổi gì khác; đổi sang nhóm khác `kind` (nhóm hệ thống) → `TYPE_SYSTEM_LOCKED`, và một Type hệ thống đổi nhóm cũng vậy. Thêm Type không nói nhóm (script, Import) → nhóm đầu tiên cùng `kind`.
- *Bàn sau:* icon theo loại trên UI.

### `type_groups` — nhóm của Type

Danh sách do Admin quản lý (Configuration › Group) để phân nhóm các Type; Type chọn nhóm ở cột Group.

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Tên nhóm |
| `kind` | text | ✔ | `sub_equipment` | `tester` / `base` / `fixture` / `sub_equipment`; không đổi sau khi tạo; **UQ** riêng cho 3 nhóm hệ thống | `kind` mà mọi Type thuộc nhóm này mang. Nhóm Admin thêm luôn là `sub_equipment` (app không cho gửi `kind`) |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị |
| `is_active` | boolean | ✔ | `true` | | `false` = ngừng dùng cho dữ liệu mới |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Quy tắc:
- **Dữ liệu hệ thống** (`03_seed.sql`): Tester, Base, Fixture (cùng `kind`, khóa như 3 Type hệ thống: không xóa, không ẩn, không đổi `kind` — `TYPE_SYSTEM_LOCKED`; đổi tên thì được) và **Sub-equipment** (cho các Type Admin thêm; ẩn / đổi tên được).
- Admin thêm / sửa / ẩn nhóm khác ở Configuration › Group (xóa = ẩn; nhóm còn Type tham chiếu thì khóa ngoại chặn xóa thật). Form Type chỉ liệt kê nhóm `sub_equipment` đang dùng (giữ nhóm đã ẩn mà Type đang thuộc thì được).
- Lịch sử vào `configuration_histories` (`table_name = type_groups`); lịch sử của Type ghi nhóm bằng tên (`group`).

### `tags` — thẻ tình trạng

Danh sách thẻ (có màu) dùng chung cho cả project: người dùng chọn **một thẻ** (mỗi lần) cho Equipment, Sub-equipment và Golden board (cột `tag_ids` của từng bảng), hiện thành badge, lọc được theo thẻ và đếm được trên Dashboard. Thẻ lưu ở cột riêng, **không** nằm trong chữ của Remark. Thẻ **không phải Status**: Status (In use / Not in use) và Calibration Status (not_calibrated / failed / overdue / due_soon / valid) do hệ thống tự quản, admin không cấu hình.

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Tên thẻ |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị (thẻ của một bản ghi xếp theo thứ tự này) |
| `color` | text | ✔ | `gray` | `green` / `yellow` / `red` / `blue` / `gray` / `purple` | Màu hiển thị của thẻ trên toàn hệ thống. Admin bắt buộc chọn khi thêm |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Quy tắc:
- Thẻ đang được gắn trên bản ghi nào thì không xóa được (`TAG_IN_USE`); xóa thật khi không còn dùng.
- Nhật ký của bản ghi ghi **tên** thẻ (trường `tags`: cũ → mới, theo thứ tự cấu hình, action `TAGS` khi chỉ đổi thẻ); đổi thứ tự chọn mà cùng tập thẻ thì không ghi.
- `color` có sáu mã bên dưới; không nhập HEX tự do. Theo yêu cầu mới ngày 14/10/2026, Admin có thể chọn thêm vàng/đỏ pastel cho thẻ thủ công, cùng quy chuẩn ở docs/JABIL_UI.md. Database đang có dữ liệu cần chạy [migration tag palette](../database/migrations/2026-10-14_tag_palette.sql) trước app mới: thêm mã `purple`, chuyển mã `yellow` cũ đang hiển thị tím sang `purple` một lần, giữ ID, liên kết, timestamps và lịch sử. Chạy lại không chuyển những thẻ vàng được tạo sau nâng cấp.

Mã lưu trong database và bảng màu manual hiện tại:

| `color` | Màu | Dùng cho | Ví dụ |
| --- | --- | --- | --- |
| `green` | Xanh ngọc pastel | Bình thường | Normal |
| `purple` | Tím pastel | Chờ đăng ký | Wait for registration |
| `yellow` | Vàng pastel | Thẻ tùy chỉnh do Admin chọn | Under repair |
| `red` | Đỏ pastel | Thẻ tùy chỉnh do Admin chọn | Fail |
| `blue` | Xanh dương pastel | Sắp nhận | Upcoming receive |
| `gray` | Xám pastel | Ngừng dùng, trung tính | Deactivated |

Không có dữ liệu mẫu: Admin tự tạo thẻ (ví dụ Under registration, Under repair, Spare, Pass, Fail).

### `levels` — level trên dây chuyền

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Tên level |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị |
| `is_active` | boolean | ✔ | `true` | | |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Không có dữ liệu mẫu: Admin tự tạo (ví dụ Unified, EOL, Final Test, Programming, Function Test).

### `departments` — phòng ban

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Tên phòng ban |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị |
| `is_active` | boolean | ✔ | `true` | | `false` = không chọn được cho tài khoản mới |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

### `calibration_configurations` — Setup hiệu chuẩn theo part number

Admin thêm một dòng cho mỗi part number phải hiệu chuẩn, chọn trong các part number **loại sub_equipment** (`TYPE_KIND_INVALID` nếu part number thuộc loại khác). Mọi sub-equipment cùng part number dùng chung chu kỳ và số ngày cảnh báo.

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `part_number_id` | uuid | ✔ | | FK `part_numbers.id` (`on delete restrict`); **UQ** | Part number phải hiệu chuẩn; mỗi part number tối đa một dòng; không đổi sau khi thêm |
| `interval_months` | integer | ✔ | | > 0 | Bao lâu hiệu chuẩn lại (tháng); dùng để tự tính `calibrations.due_date` |
| `warning_days` | integer | ✔ | `30` | > 0 | Còn ≤ `warning_days` ngày đến `due_date` thì Calibration Status là Due soon (tô vàng, ⚠ trên thẻ ở Overview, liệt kê trên Dashboard) |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Quy tắc:
- Admin sửa / xóa thật. Xóa → sub-equipment của part number đó không còn chu kỳ: các lần hiệu chuẩn sau phải nhập `due_date` tay; Calibration Status dùng `warning_days` mặc định 30.
- Đổi `interval_months` chỉ áp dụng cho lần hiệu chuẩn sau; `due_date` đã tính giữ nguyên.

### `calibration_vendors` — vendor hiệu chuẩn

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `display_name` | text | ✔ | | UQ (không phân biệt hoa/thường) | Tên công ty |
| `sort_order` | integer | ✔ | `0` | index (`sort_order`, `display_name`) | Thứ tự hiển thị |
| `is_active` | boolean | ✔ | `true` | | `false` = không chọn được cho lần hiệu chuẩn mới |
| `created_by` | uuid | | | FK `user_profiles` | |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

Hiệu chuẩn nội bộ: admin tạo một vendor tên ví dụ "Internal".

### `configuration_histories` — lịch sử Configuration

Theo [khuôn bảng lịch sử](#khuôn-bảng-lịch-sử-configuration-và-user), cột trỏ về là `record_id`, thêm `table_name` (text ✔, ví dụ `locations`) để biết dòng thuộc bảng nào. Một bảng lịch sử cho cả 9 bảng cấu hình.

| `action` | Khi nào |
| --- | --- |
| `CREATE` | Thêm dòng |
| `UPDATE` | Sửa dòng (kể cả ẩn / hiện lại qua `is_active`) |
| `DELETE` | Xóa thật (chỉ `tags`, `calibration_configurations`) |

---

## 8. User Management

Tài khoản là người dùng **Supabase Auth**; **Admin tạo**, không tự đăng ký, không duyệt / từ chối, không có tài khoản "local" (mật khẩu do Supabase giữ), không có thông báo.

| Trang | Làm gì | Bảng |
| --- | --- | --- |
| User Management (chỉ Admin) | Đúng 4 thao tác: **Thêm** tài khoản · **Sửa** (họ tên, mã nhân viên, phòng ban, nhóm quyền) · **Đặt lại mật khẩu** · **Khóa / Mở khóa** | `user_profiles` |

Tài khoản **không xóa**, chỉ khóa (`is_active = false`): mọi bảng đều lưu `created_by` / `updated_by` trỏ về tài khoản, xóa sẽ mất dấu người đã thao tác. Vì vậy `user_profiles.id` trỏ `auth.users(id)` với `on delete restrict`: xóa nhầm tài khoản trong Supabase Dashboard sẽ bị database chặn.

### Đăng nhập và vòng đời tài khoản

| Bước | Cách làm |
| --- | --- |
| Đăng nhập | Bằng **username** (chữ thường, không đổi sau khi tạo). Server đổi thành email nội bộ `<username>@jabil.local` (Supabase Auth cần email; không gửi email, người dùng không thấy). Xác thực xong server vẫn tra `user_profiles`: không có dòng, hoặc `is_active = false` → từ chối. **Quyền vào app luôn dựa vào `user_profiles`, không bao giờ chỉ dựa vào JWT hợp lệ.** |
| Thêm | Admin nhập username, họ tên, mã nhân viên, phòng ban, nhóm quyền. Server gọi `auth.admin.createUser({ email, password: tạm, email_confirm: true })` rồi ghi `user_profiles` (`id` = id vừa tạo, `must_change_password = true`); ghi hồ sơ lỗi thì xóa user Auth vừa tạo. **Mật khẩu tạm do hệ thống sinh**, dạng dễ đọc `Jabil-4827`, hiện **một lần** kèm nút sao chép; Admin chuyển cho người dùng. |
| Lần đăng nhập đầu | `must_change_password = true` → bắt buộc màn hình Đổi mật khẩu; chưa đổi thì mọi API khác bị server chặn. |
| Tự đổi mật khẩu | Bất cứ lúc nào ở menu tài khoản (nhập mật khẩu hiện tại). Đặt `must_change_password = false`. **Không ghi lịch sử.** |
| Đặt lại mật khẩu | Admin: mật khẩu tạm mới (cùng dạng, hiện một lần), `must_change_password = true`, lịch sử `PASSWORD_RESET` (ghi cả khi cờ vốn đã `true`). |
| Khóa / Mở khóa | Khóa: `is_active = false` + `ban_duration` ở Supabase Auth (chặn đăng nhập mới và làm mới phiên). Server kiểm tra `is_active` ở **mọi request** nên khóa có hiệu lực ngay, không phải chờ JWT hết hạn. Mở khóa làm ngược lại. |
| Bảo vệ Admin | Admin **không tự khóa / tự hạ nhóm quyền của mình** (`ADMIN_SELF_CHANGE`) và **không khóa / hạ quyền Admin cuối cùng** còn hoạt động (`LAST_ADMIN`). Database chặn bằng trigger `user_profiles_admin_guard`, mọi đường ghi. |
| Admin đầu tiên | `scripts/seed-first-admin.ts` (`npm run seed:admin -- <username> "<Họ tên>"`): tạo user Auth + hồ sơ Admin, in mật khẩu tạm một lần; lịch sử `CREATE`, `source = script`. |

Cài đặt Supabase Dashboard bắt buộc (publishable key là công khai nên sign-up mở = ai cũng tạo được user Auth): tắt public sign-up, tắt email confirmation, nâng giới hạn đăng nhập theo IP — xem [database/README.md](../database/README.md).

### `user_profiles` — tài khoản

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | | PK; FK `auth.users` (`on delete restrict`) | **Trùng id của Supabase Auth** |
| `username` | text | ✔ | | UQ; chữ thường, 1–64 ký tự `a-z 0-9 . _ + -`, bắt đầu bằng chữ / số | Tên đăng nhập; không đổi sau khi tạo (email nội bộ = `username@jabil.local`) |
| `full_name` | text | ✔ | | | Họ tên |
| `employee_id` | text | | | | Mã nhân viên |
| `department_id` | uuid | | | FK `departments` | Phòng ban |
| `role` | text | ✔ | `readonly` | `admin` / `user` / `readonly` | Nhóm quyền — xem [Phân quyền theo nhóm](#phân-quyền-theo-nhóm) |
| `is_active` | boolean | ✔ | `true` | | `false` = bị khóa, không đăng nhập được |
| `must_change_password` | boolean | ✔ | `true` | | `true` = đang dùng mật khẩu tạm, phải đổi mới vào được app |
| `created_by` | uuid | | | FK `user_profiles` | Admin tạo (trống = script tạo admin đầu tiên) |
| `created_at` | timestamptz | ✔ | now() | | |
| `updated_by` | uuid | | | FK `user_profiles` | |
| `updated_at` | timestamptz | ✔ | now() | | |

### `user_histories` — lịch sử tài khoản

Theo [khuôn bảng lịch sử](#khuôn-bảng-lịch-sử-configuration-và-user), cột trỏ về là `user_id`.

| `action` | Khi nào |
| --- | --- |
| `CREATE` | Admin tạo tài khoản (hoặc script tạo admin đầu tiên) |
| `UPDATE` | Sửa thông tin (họ tên, mã nhân viên, phòng ban) |
| `ROLE_CHANGE` | Đổi nhóm quyền |
| `DISABLE` / `ENABLE` | Khóa / mở khóa tài khoản (`is_active`) |
| `PASSWORD_RESET` | Admin đặt lại mật khẩu |

Người dùng tự đổi mật khẩu của mình **không ghi lịch sử**.

---

## 9. Bảng hệ thống

### `error_log` — nhật ký lỗi

| Trường | Kiểu | ✔ | Mặc định | Ràng buộc / liên kết | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | ✔ | tự sinh | PK | |
| `request_id` | text | ✔ | | index | Mã lỗi người dùng đọc trên màn hình báo lỗi |
| `route` | text | | | | API bị lỗi, ví dụ `POST /api/equipment` |
| `user_id` | uuid | | | không FK | Người gặp lỗi |
| `error_code` | text | | | | Mã lỗi |
| `message` | text | | | tối đa 2000 ký tự | Nội dung lỗi |
| `stack` | text | | | tối đa 8000 ký tự | Stack trace |
| `created_at` | timestamptz | ✔ | now() | | |

Tự xóa bản ghi cũ hơn 90 ngày. Admin xem ở trang lỗi hệ thống.
