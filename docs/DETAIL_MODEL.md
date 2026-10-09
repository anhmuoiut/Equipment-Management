# Masterlist & Detail Modal — bố cục chung toàn project

Cập nhật: 09/10/2026 (**Overview thành bảng thẻ theo Location, mục 4.6**; bỏ side panel: mọi chi tiết / form / thao tác dùng một hệ thống modal, mục 3; footer chung và cỡ modal cố định theo review; mục 4.1–4.3 theo schema equipment / sub_equipment / golden_boards; **giao diện đã làm theo đúng mục 3–4**). Code: [mục 6](#6-triển-khai). Dữ liệu theo [DATABASE_MODIFIED.md](DATABASE_MODIFIED.md); giao diện (màu, font, kích thước, quy tắc modal) theo [JABIL_UI.md](JABIL_UI.md).

## 1. Nguyên tắc

1. **Mọi module đi cùng một luồng:** bấm menu → mở **Masterlist** (bảng danh sách, dùng **full chiều rộng**) → bấm vào một dòng → mở **Detail Modal**.
2. **Masterlist hiện đủ các trường** của module thành các cột (mặc định hiện các cột chính, còn lại mở ở Tùy chọn hiển thị).
3. **Detail Modal hiện đủ mọi trường** của bản ghi, chia nhóm cho dễ đọc. Không bỏ trường nào.
4. **Một kiểu Masterlist và một kiểu modal** cho Equipment, Calibration, Golden, Configuration, User Management (Overview là bảng thẻ theo Location — mục 4.6 — nhưng mở đúng modal này). Mỗi module chỉ khai báo cột / trường / thao tác của mình; khung là component dùng chung.
5. **Không có side panel.** Xem / sửa / thêm mới / thao tác / xác nhận đều là **một màn hình trong modal**. **Chỉ một modal tại một thời điểm** — không chồng modal, không mở hộp thoại thứ hai.

Không bao giờ hiện: mật khẩu (ngoại lệ duy nhất: mật khẩu tạm, **một lần** ở màn hình Mật khẩu tạm lúc Thêm / Đặt lại — mục 4.5), mã phiên đăng nhập và các trường kỹ thuật tương tự.

---

## 2. Masterlist — trang danh sách chung

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Equipment                                                    1.245 thiết bị   │  ← tiêu đề trang + tổng số
│ [🔍 Tìm kiếm…        ] [Bộ lọc ▾] [Tùy chọn hiển thị] [Xuất Excel] [Import] [+ Thêm] │  ← thanh công cụ
├──────────────────────────────────────────────────────────────────────────────┤
│    No  Status    Serial number  Part number  Location  Type   Jabil ID  …     │  ← tiêu đề cột: bấm để sắp xếp
│ ⊟  1   ● In use  SN-001         P12316       B3F1      Tester J-100201  …     │
│ └  2   ● In use  SN-002         P20001       B3F1      Base   J-100202  …     │  ← bấm dòng → mở Detail Modal
│ …                                                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Thành phần | Quy tắc chung cho mọi module |
| --- | --- |
| Chiều rộng | Bảng dùng **toàn bộ chiều rộng** vùng nội dung — không còn panel cạnh bên chiếm chỗ |
| Tiêu đề trang | Tên module + tổng số bản ghi (theo bộ lọc hiện tại) trên **cùng một dòng** |
| Tìm kiếm | Một ô, tìm trên các cột chữ (serial, part number, tên…) |
| Bộ lọc | Lọc theo các cột chọn từ danh sách (Status, Type, Location, Thẻ, Nhóm quyền…) |
| Tùy chọn hiển thị | Mỗi người tự ẩn / hiện cột, kéo đổi thứ tự, "Khôi phục mặc định". Mặc định hiện **các cột chính của module** (mục 4). Lưu trên trình duyệt của từng người |
| Xuất Excel | Mọi nhóm quyền (xem được thì xuất được); xuất đúng các cột và bộ lọc đang hiện |
| Thanh công cụ | Đủ chỗ nên giữ icon **và chữ** trên desktop / tablet. Chỉ khi cửa sổ hẹp (dưới 768px) `Tùy chọn hiển thị`, `Xuất Excel` và công cụ của module (Import…) còn icon — vẫn có tên (`aria-label`) và tooltip. `Bộ lọc` và `+ Thêm` luôn có chữ |
| Import | Chỉ trang có import (Equipment, Calibration, Golden) — Admin, User. Mở **modal cỡ L** (`?tool=import`): 1. tải file mẫu, 2. chọn file → kiểm tra (chưa ghi), 3. hết lỗi → Import. Xong → đóng modal + toast + tải lại danh sách. Xem mục 6 |
| `+ Thêm` | Admin, User (Configuration, User Management: chỉ Admin). Mở **modal Thêm mới cỡ M** (`?new=1`) |
| Cột đầu | `No` (số thứ tự theo bộ lọc / sắp xếp hiện tại). Equipment thêm cột quan hệ cha–con trước `No` |
| Cột Status | Equipment, Sub-equipment, Golden board: Status (In use / Not in use); Calibration: thêm Calibration Status (Not calibrated / Failed / Overdue / Due soon / Valid, tự tính). Thẻ tình trạng có chữ + màu |
| Cột định danh | Ngay sau cột Status là serial (chữ đậm), rồi part number và vị trí, cột phụ (Jabil ID, Asset, Level, Remark…) ở cuối |
| Sắp xếp | Bấm tiêu đề cột để sắp xếp tăng / giảm |
| Bấm dòng | Mở Detail Modal của dòng đó. Dòng đang mở vẫn thấy được phía sau lớp mờ; đóng modal thì focus về đúng dòng đó |
| Trống / đang tải / lỗi | Dùng trạng thái chung: khung xương khi tải; chưa có bản ghi nào → thông báo + nút `+ Thêm` (nếu có quyền); không khớp bộ lọc → thông báo + `Xóa bộ lọc`; tải lỗi → thông báo lỗi + `Thử lại` |
| Bảng rộng | Cuộn ngang **bên trong** khung bảng, tiêu đề cột luôn hiện khi cuộn dọc. Ô nhiều chữ (Remark, Mô tả…) chỉ hiện tối đa hai dòng — đủ chữ ở tooltip và trong Detail Modal — để một ghi chú dài không làm cả dòng cao gấp ba. (Điện thoại không dùng bảng: xem [3.11](#311-trên-điện-thoại)) |

---

## 3. Detail Modal — khung chi tiết chung

Một component `Modal` dùng chung; **cỡ là một prop** (S / M / L). Quy tắc hiển thị chi tiết (kích thước, lớp mờ, animation, focus) ở [JABIL_UI.md](JABIL_UI.md) mục "Modal system"; đây là hành vi nghiệp vụ.

### 3.1 Cỡ và vị trí

```
                ┌──────────────────────────────────────────────────┐
                │ ‹ ›  SN-001  [● In use]                       [✕] │  ← header (cố định)
                │ P12316 · Tester · 📍 B3F1 · Cập nhật 10:24        │
                ├──────────────────────────────────────────────────┤
                │ Thông tin │ Cây thiết bị │ Lịch sử                │  ← tab (cố định)
                ├──────────────────────────────────────────────────┤
 (masterlist    │ ĐỊNH DANH                                         │
  mờ phía sau)  │ Serial number     Part number                     │  ← thân: cuộn
                │ SN-001            P12316                          │     (cao tối đa 85vh)
                │ …                                                 │
                ├──────────────────────────────────────────────────┤
                │ [Thao tác ▾]               [Sửa] [Check-out]      │  ← footer (cố định)
                └──────────────────────────────────────────────────┘
```

| Cỡ | Rộng | Mở thẳng bằng |
| --- | --- | --- |
| **S** | ~440px | Hộp xác nhận ngắn mở độc lập, không thuộc một bản ghi |
| **M** | ~640px | `+ Thêm` (form Thêm mới), Account settings và các hộp thoại toàn cục |
| **L** | ~960px | **Chi tiết một bản ghi** (bấm dòng, `‹ ›`, link `?id=`), Import |

- Modal căn giữa, lớp mờ phủ cả trang; rộng tối đa `100vw − 32px`, **cao tối đa 85vh**.
- **Cỡ do màn hình mở đầu quyết định và giữ nguyên đến khi đóng.** Chuyển màn hình trong modal (chi tiết → Sửa / thao tác / xác nhận → quay lại) **không đổi cỡ** nên khung không nhảy. Ngoại lệ duy nhất là **Thêm mới**: lưu xong modal M đóng và chi tiết bản ghi vừa tạo mở trong một modal L mới (mục 3.6).
- Trong modal **L**, các màn hình form / thao tác / xác nhận giới hạn **nội dung ~640px, căn giữa** (header và footer vẫn rộng hết modal; nút chính vẫn ở góc phải footer). Trong modal **M**, nội dung dùng hết bề rộng.
- Dưới 768px modal **toàn màn hình** — xem [3.11](#311-trên-điện-thoại).

### 3.2 Header và footer (cố định)

Chỉ phần **thân** cuộn; header (và thanh tab) và footer luôn hiện.

**Màn hình chi tiết (modal L):**

| Vị trí | Nội dung | Ghi chú |
| --- | --- | --- |
| Header dòng 1 | `‹ ›` · **Tên chính** · tag trạng thái · `[✕]` | Tên chính = định danh dễ nhận nhất (serial, họ tên, `display_name`). `‹ ›` chỉ hiện khi có bản ghi trước / sau |
| Header dòng 2 | Định danh phụ · thông tin nhanh | Ví dụ part number · loại · vị trí (chữ đậm hơn, vì đó là điều người dùng tìm đầu tiên) · cập nhật lần cuối (giờ + người). Tối đa 3 mục nhanh |
| Footer trái | `[Thao tác ▾]` | Nút có chữ (nút chỉ có dấu ⋯ dễ bị bỏ qua), chứa các thao tác khác của bản ghi (bảng bên dưới). Xóa luôn ở cuối, màu đỏ |
| Footer phải | Các nút chính của bản ghi, **nút ngoài cùng bên phải là nút chính** | Bảng bên dưới |

**Footer chung của ba module tài sản** (Equipment, Calibration, Golden — và khi mở từ Overview, vì Overview mở đúng modal của module, **không có footer riêng**):

| Vị trí | Nút | Ghi chú |
| --- | --- | --- |
| Trái | `[Thao tác ▾]` | **Swap** · **Move** (Gắn vào / Đổi cha) · **Detach** (Tách khỏi cha) · **Đổi vị trí** · **Xóa** (Admin; cuối, màu đỏ). Thao tác riêng của module (ví dụ **Thêm thiết bị con**) nằm ở đầu danh sách |
| Phải | `[Sửa]` | Mở form Sửa |
| Phải | `[Ghi nhận hiệu chuẩn]` | **Chỉ sub-equipment** (Calibration), đứng trước Check-out |
| Phải (ngoài cùng) | `[Check-out]` / `[Check-in]` | Nút chính. Hiện theo trạng thái: Not in use → `[Check-out]`, In use → `[Check-in]`. Khóa (kèm hướng dẫn) khi không Check-out được: không phải Tester mà chưa gắn cha (`USAGE_NEEDS_PARENT`), hoặc chọn riêng một con khi cha chưa In use (`PARENT_NOT_IN_USE`) |

Configuration và User Management: `[Thao tác ▾]` bên trái; bên phải `[Sửa]` — không có nút chính riêng (User Management không có luồng duyệt; Đặt lại mật khẩu và Khóa / Mở khóa nằm trong `[Thao tác ▾]`). Readonly: footer chi tiết chỉ có `[Đóng]`.

**Màn hình form / thao tác / xác nhận:**

| Vị trí | Nội dung |
| --- | --- |
| Header | Breadcrumb **`← SN-001 › Sửa`** (hoặc `› Swap`, `› Check-out`…). `←` = Quay lại màn hình chi tiết (có thay đổi chưa lưu → hỏi xác nhận, mục 3.7). Thêm mới: tiêu đề "Thêm …". Luôn có `[✕]` |
| Footer phải | `[Hủy]` `[nút chính]` — nút chính ghi đúng việc nó làm (`Lưu`, `Swap`, `Đổi vị trí`, `Gắn vào cha`, `Check-out`, `Đặt lại mật khẩu`, `Khóa`, `Xóa`…), chỉ dùng `Xác nhận` khi không có tên nào cụ thể hơn. Nút Xóa màu đỏ |
| Khi đang chạy | Nút chính khóa + **một** chỉ báo tải; cả modal không đóng được |

### 3.3 Duyệt qua các bản ghi (Trước / Sau)

Chỉ ở **màn hình chi tiết**.

| Cách | Hành vi |
| --- | --- |
| Nút `‹` `›` (header) | Sang bản ghi trước / sau **theo đúng thứ tự, bộ lọc và sắp xếp hiện tại** của masterlist; URL `?id=` đổi theo |
| Phím `←` / `→` | Như trên. **Không** chạy khi con trỏ nằm trong ô nhập (input, textarea, select), khi đang ở màn hình form / thao tác, hoặc khi giữ Ctrl / Alt / Meta |
| Đầu / cuối danh sách | Nút tương ứng bị tắt |
| Form / thao tác | `‹ ›` không hiện — phải quay lại chi tiết mới chuyển bản ghi, nên không bao giờ có thay đổi chưa lưu bị bỏ mất khi chuyển bản ghi |

### 3.4 Tab

| Vị trí | Tab | Có ở |
| --- | --- | --- |
| Đầu | **Thông tin** | Mọi module |
| Giữa | Tab riêng của module (0–1 tab) | Equipment: Cây thiết bị |
| Cuối | **Lịch sử** | Mọi module — dòng thời gian `Trường: cũ → mới` (đọc `asset_logs` với tài sản; `configuration_histories` / `user_histories` với Configuration / User Management) |

Màn hình form / thao tác không có tab (Thêm mới chỉ có nhóm trường).

### 3.5 Thân — cách trình bày trường

- **Hiện đủ mọi trường** của bản ghi, chia **nhóm**; mỗi nhóm có tiêu đề nhỏ viết hoa.
- Nhóm cuối của mọi module là **Thông tin hệ thống** (chỉ đọc): Tạo bởi · Tạo lúc · Cập nhật bởi · Cập nhật lúc.
- Lưới **2 cột** (chi tiết L và form M); điện thoại: 2 cột khi xem, 1 cột khi sửa. Ghi chú (remark) chiếm cả hàng.
- Mỗi trường: **nhãn ở trên, giá trị ở dưới**. Trống thì hiện `—`.
- Trường FK hiện `display_name` (ví dụ vị trí `B3F1`, không hiện id).
- Trường **tự tính** (ví dụ `due_date`) luôn chỉ đọc, kèm chú thích "Tự tính".
- Trường **chỉ đổi bằng thao tác riêng** (ví dụ vị trí của thiết bị có cha) vẫn hiện nhưng khóa, kèm chú thích cách đổi.
- **Form Sửa / Thêm mới** là màn hình riêng (cỡ M): cùng các nhóm và thứ tự trường như màn hình chi tiết, nhưng là ô nhập. Trường bắt buộc có dấu `*` đỏ; lỗi hiện ngay dưới ô; trường chỉ đọc hiện lại ở dạng khóa.

### 3.6 Màn hình trong modal

Modal chỉ có **một màn hình hiện tại**. Mở thao tác từ chi tiết thì màn hình mới **thay thế nội dung trong cùng modal** (không mở modal khác, **không đổi cỡ modal**), chồng lên một ngăn xếp màn hình để `←` quay lại đúng chỗ.

| Màn hình | Mở bằng | Khung | Kết thúc |
| --- | --- | --- | --- |
| **Chi tiết** (mặc định) | Bấm dòng trong masterlist, `‹ ›`, link `?id=` / QR | Modal L | `✕` / Esc / bấm ngoài → đóng modal |
| **Sửa** | Nút `[Sửa]` | Cỡ của modal hiện tại; trong L: nội dung ~640px | Lưu → quay về **chi tiết** của bản ghi + toast "Đã lưu" |
| **Thêm mới** | Nút `+ Thêm` trên masterlist | Modal M | Lưu → **đóng modal M, mở lại modal L** chi tiết bản ghi vừa tạo (URL `?id=` của nó) + toast |
| **Thao tác** | Mục trong `[Thao tác ▾]` hoặc nút trên footer (Check-out / Check-in, Ghi nhận hiệu chuẩn, Swap, Move, Tách khỏi cha, Đổi vị trí, Đặt lại mật khẩu, Khóa / Mở khóa…) | Cỡ của modal hiện tại; trong L: nội dung ~640px | Xong → quay về **chi tiết** (đã tải lại) + toast |
| **Xóa** | `[Thao tác ▾]` › Xóa (Admin) | Như trên; thiết bị có con thì thêm cảnh báo "con sẽ thành chưa gắn" | Xong → đóng modal + toast (bản ghi không còn) |
| **Hủy bỏ thay đổi?** | Đóng hoặc `←` khi có thay đổi chưa lưu (mục 3.7) | Như trên | `[Ở lại]` `[Bỏ thay đổi]` — là một màn hình trong chính modal, không phải hộp thoại thứ hai |
| **Mở bản ghi liên quan** | Bấm thiết bị cha / con trong cùng module | Modal L | Chi tiết của bản ghi đó thay vào modal; breadcrumb `← SN-001 › SN-002` để quay lại bản ghi trước. Bản ghi của **module khác** (ví dụ từ Equipment bấm một sub-equipment) thì chuyển tới trang module đó với `?id=` — modal cũ đóng, modal mới mở: luôn chỉ một modal |
| **Import** | Nút Import trên masterlist | Modal L | Xong → đóng modal + toast + tải lại danh sách |

Màn hình thao tác gồm: tiêu đề + vài trường + mục **Kết quả** xem trước (lấy từ `p_dry_run` của hàm database tương ứng — con đi đâu, vị trí / Status mới, "Hạn mới: dd/mm/yyyy"; lỗi như đang In use hiện ngay, trước khi bấm nút chính). Sau khi xong, **tải lại cả masterlist** và dữ liệu của chi tiết.

### 3.7 Đóng modal

| Cách | Hành vi |
| --- | --- |
| `✕`, phím Esc, bấm ra ngoài lớp mờ | Đóng cả modal (từ bất kỳ màn hình nào) — **trừ** khi có **thay đổi chưa lưu** (bên dưới) hoặc có popover đang mở (bên dưới) |
| **Có bất kỳ thay đổi chưa lưu** — một ô trong form, ô Ghi chú, hoặc lựa chọn đã làm trong màn hình thao tác (thiết bị Swap, cha mới, Kết quả hiệu chuẩn, nhóm quyền…) — so với lúc mở màn hình đó | Không đóng ngay: hiện màn hình **"Hủy bỏ thay đổi?"** trong cùng modal (`[Ở lại]` `[Bỏ thay đổi]`). Áp dụng cho cả `✕`, Esc, bấm ngoài và `←` ở breadcrumb. Trên màn hình đó Esc = `[Ở lại]` |
| Màn hình **Mật khẩu tạm** (mục 4.5) mà chưa bấm `[Sao chép]` | `✕`, Esc, bấm ngoài → màn hình xác nhận "Đóng mà chưa sao chép mật khẩu tạm?" (`[Ở lại]` `[Đóng]`, cùng cơ chế "Hủy bỏ thay đổi?"). Mật khẩu không hiện lại, nhưng Admin luôn Đặt lại mật khẩu được |
| **Popover đang mở** (menu `[Thao tác ▾]`, danh sách `SearchableSelect`, bộ chọn ngày) | **Esc chỉ đóng popover**; bấm Esc lần nữa mới tính là đóng modal |
| Đang gửi (lưu / thao tác đang chạy) | Không đóng được cho đến khi xong |
| Bấm ra ngoài | Chỉ tính khi lần bấm **bắt đầu** cũng ở ngoài modal: kéo chọn chữ trong ô rồi thả ra ngoài không làm mất form |
| Sau khi đóng | URL bỏ `?id=` / `?new=1` / `?tool=`; focus và vị trí cuộn của danh sách giữ nguyên, focus về dòng / nút đã mở modal |

### 3.8 Nút theo nhóm quyền

| Nhóm | `[Sửa]` | Nút chính / `[Thao tác ▾]` | Xóa | Lịch sử | Xuất Excel |
| --- | --- | --- | --- | --- | --- |
| Admin | ✔ | ✔ | ✔ | ✔ | ✔ |
| User | ✔ | ✔ (trừ xóa) | — | ✔ | ✔ |
| Readonly | — | — | — | ✔ | ✔ |

Readonly không có nút nào ở footer chi tiết ngoài `[Đóng]`. Configuration và User Management chỉ Admin mở được.

### 3.9 Khác

| Mục | Quy tắc |
| --- | --- |
| URL | `?id=<id>` luôn đồng bộ với bản ghi đang mở: mở / chuyển bản ghi / đóng đều đổi URL (`replace` khi chuyển bản ghi bằng `‹ ›`, `push` khi mở từ danh sách để nút Back của trình duyệt đóng modal). Dán link vào tab mới mở thẳng modal (chia sẻ, link QR). Không tìm thấy bản ghi hoặc không có quyền → modal hiện thông báo lỗi + `[Đóng]`. Màn hình form / thao tác không nằm trên URL (tải lại trang thì về màn hình chi tiết). Đường dẫn cũ `/equipment/{id}`, `/calibration/{id}`, `/golden/{id}`, `/users/{id}` chuyển hướng sang `?id=` (link QR đã in vẫn dùng được). Overview thêm `&type=<equipment\|sub_equipment\|golden_board>` vì ba bảng có id riêng |
| Bàn phím | Tab di chuyển **trong** modal (khóa focus); mở modal thì focus vào tiêu đề / ô đầu tiên; đóng thì về dòng đã mở. Chuyển màn hình trong modal thì focus về tiêu đề màn hình mới |
| Đang tải / lỗi | Khung xương giữ nguyên header + nhóm trường; lỗi hiện ở đầu thân modal kèm `[Thử lại]` |
| Menu, ô chọn, tooltip | Là lớp phủ tạm (popover), **không phải modal**: được phép nằm trên modal. `[Thao tác ▾]`, `SearchableSelect`, bộ chọn ngày mở ngay cạnh ô bấm, kể cả trên điện thoại (không mở tấm trượt thứ hai chồng lên modal). Esc đóng popover trước, modal sau (mục 3.7) |

### 3.10 Chỗ chừa sẵn cho module khác (extension point)

Chi tiết của một module có thể hiện một **nhóm chỉ đọc** do module khác cung cấp, mà không phải đọc bảng của module đó. Hiện dùng cho: nhóm **Hiệu chuẩn** trong chi tiết tài sản (mục 4.1). Sau này Repair cũng gắn vào cùng cách. Nâng cấp module cung cấp không phải sửa module hiển thị.

### 3.11 Trên điện thoại

Mục tiêu: **quét nhanh → tìm thiết bị → xem trạng thái / vị trí → làm việc cần làm**, bằng **một tay**. Điện thoại không phải bản desktop thu nhỏ: danh sách là các thẻ, nút hay dùng nằm ở **đáy màn hình** (vùng ngón cái), đầu màn hình chỉ giữ tên và điều hướng. **768px là ngưỡng điện thoại duy nhất của cả giao diện**: dưới 768px modal toàn màn hình, danh sách dạng thẻ và sidebar dạng ngăn kéo; từ 768px trở lên giữ nguyên bố cục desktop / tablet.

**Danh sách (Masterlist)** — không ép bảng vào màn hình hẹp:

```
┌─────────────────────────────┐
│ Equipment   64 of 64 records│
│ [🔍 Tìm kiếm…    ] [⛭] [⋮]  │  ← tìm · Lọc & sắp xếp (badge = số đang bật) · menu ⋮
│ [Quá hạn] [Sắp đến hạn]     │  ← lọc nhanh (nếu module có)
├─────────────────────────────┤
│ SN-10007 ↳           ● In use│  ← Serial (đậm) · tag trạng thái
│ 📍 B3F1 · P20001 · Base     │  ← Vị trí đậm · part number · loại · Jabil ID
├─────────────────────────────┤
│ SN-10021           ● Repair │
│ 📍 Lab 2 · P30005           │
│ 🗓 14/10/2026 [DUE SOON]    │  ← Calibration: hạn hiệu chuẩn có màu
└─────────────────────────────┘                    ( + )  ← nút thêm nổi
```

| Thành phần | Trên điện thoại |
| --- | --- |
| Thẻ dòng | Mỗi module khai báo `mobileCard` (`RowCard`: tiêu đề + tag + vài dòng phụ); module không khai báo thì dựng thẻ chung từ các cột. Chỉ phần tử inline (thẻ là một `<button>`). Bấm thẻ = mở chi tiết. Serial dài xuống dòng, không cắt. Dòng quá hạn / sắp đến hạn có vạch màu ở mép trái |
| Thanh công cụ | Chỉ **tìm kiếm + Lọc & sắp xếp + ⋮** (Xuất Excel, Import…). Không có "Tùy chọn hiển thị" (thẻ có trường cố định), không có nút `+ Thêm` trên thanh (đã có nút nổi `+`), không có dải nút cuộn ngang |
| Lọc & sắp xếp | Tấm trượt từ đáy (mở từ danh sách, lúc chưa có modal nào): các ô lọc (chọn của hệ điều hành), "Sắp xếp theo" + A → Z / Z → A, `[Xóa bộ lọc]` · `[Xem N kết quả]`. Khi đóng, bộ lọc / sắp xếp đang bật hiện thành chip bấm để gỡ |
| Thêm mới | Nút `+` nổi ở góc dưới phải của mọi module có quyền thêm (ẩn khi modal đang mở) |
| Tiêu đề | Tên trang và số bản ghi **cùng một dòng**. Trang Configuration: ô chọn danh sách ở đầu trang đã nêu tên → ẩn tiêu đề lặp (vẫn có cho trình đọc màn hình) |
| Tải thêm | Vẽ 200 thẻ một lần, cuộn gần cuối thì vẽ tiếp |
| Đang tải / trống / lỗi | Thẻ khung xương · "Chưa có bản ghi" · "Không khớp" + `[Xóa bộ lọc]` · lỗi + `[Thử lại]` |

**Modal (dưới 768px) — toàn màn hình:**

```
┌─────────────────────────────┐
│ ‹ ›  SN-001  ● In use    [✕]│  ← header: bản ghi trước / sau · tên + tag · đóng
│    P12316 · Tester  📍 B3F1 │  ← định danh phụ + vị trí (một dòng, xuống dòng nếu dài)
├─────────────────────────────┤
│ Thông tin │ Cây │ Lịch sử   │
├─────────────────────────────┤
│ ĐỊNH DANH                   │
│ Serial number   Part number │  ← xem: trường ngắn 2 cột
│ SN-001          P12316      │
│ …                           │
├─────────────────────────────┤
│ [Thao tác ▾]        [ Sửa ] │  ← footer đáy: Thao tác · nút chính (phải)
└─────────────────────────────┘
```

| Thành phần | Trên điện thoại |
| --- | --- |
| Khung | Mọi cỡ S / M / L đều **toàn màn hình** (không bo góc, không lớp mờ), header và footer cố định, chỉ thân cuộn; chừa vùng an toàn của máy ở đáy. Nút ≥ 44px |
| Header | Chi tiết: `‹ ›` · tên chính + tag · `✕`. Form / thao tác: `← SN-001 › Sửa` · `✕`. Không có phím `← →` (không có bàn phím) |
| Dòng phụ | Định danh phụ + **mục đầu của thông tin nhanh** (vị trí; với hiệu chuẩn là hạn). Phần còn lại của thông tin nhanh ở tab Thông tin |
| Tab | Một hàng, cao 44px, vuốt ngang được |
| Thân | **Xem**: trường ngắn hai cột (`wide` chiếm cả hàng). **Sửa / thêm mới**: một cột, ô nhập cao ≥ 44px, chữ 16px (không bị iOS tự phóng to) |
| Footer (chi tiết) | Footer chung (3.2): `[Thao tác ▾]` bên trái, bên phải các nút chính (`[Sửa]`, sub-equipment thêm `[Ghi nhận hiệu chuẩn]`, `[Check-out]` / `[Check-in]` ngoài cùng); không đủ chỗ thì `[Sửa]` và `[Ghi nhận hiệu chuẩn]` chuyển vào menu Thao tác, nút chính vẫn hiện. Readonly chỉ có `[Đóng]` |
| Footer (form / thao tác / xác nhận) | `[Hủy]` `[nút chính]` chia đều bề rộng, cao 48px |
| `[Thao tác ▾]` | Danh sách thả lên ngay trên nút, mỗi dòng cao 48px; Xóa ở cuối, màu đỏ. Là popover, không phải tấm trượt thứ hai |
| Ô chọn (`SearchableSelect`) | Danh sách neo vào ô, tối đa nửa màn hình, mỗi lựa chọn cao 48px; ô tìm chỉ hiện khi danh sách dài (> 7) và không tự bật bàn phím |
| Bàn phím | Viewport `interactive-widget=resizes-content`: bàn phím mở thì thân và footer co lại phía trên nó (Chrome / Android) |
| Cây thiết bị | Dạng thụt lề giữ nguyên; mỗi dòng cao tối thiểu 44px |

### 3.12 Component dùng chung

| Component | Vai trò |
| --- | --- |
| `Masterlist` | Trang danh sách: tiêu đề + tổng số, thanh công cụ, bảng, sắp xếp, lọc, chọn dòng |
| `ColumnSettings` | Tùy chọn hiển thị cột |
| `Modal` | Khung modal duy nhất: cỡ `s` / `m` / `l` (prop, đặt khi mở và không đổi), lớp mờ, header + footer cố định, thân cuộn tối đa 85vh, nội dung màn hình phụ ~640px căn giữa trong `l`, đóng bằng Esc / ✕ / bấm ngoài (Esc đóng popover trước), khóa focus, toàn màn hình dưới 768px |
| `RecordModal` | Modal của một bản ghi: giữ ngăn xếp màn hình (chi tiết → sửa / thao tác / xác nhận), breadcrumb `← SN › …`, footer chung (3.2), `‹ ›` và phím `← →`, hỏi "Hủy bỏ thay đổi?" khi có bất kỳ thay đổi chưa lưu (`?id=` do `ModuleWorkspace` đồng bộ). Overview dùng lại modal của module theo `type` |
| `DetailSection` | Một nhóm trường: tiêu đề + lưới 2 cột |
| `DetailValue`, `FieldView`, `FieldEditor` | Vẽ nhóm (`SectionDef`) và trường (`FieldDef`) module khai báo: nhãn, giá trị khi xem, ô nhập khi sửa, chú thích, lỗi |
| `ActionScreen`, `ActionField` | Màn hình thao tác trong modal; tự khóa khi đang gửi và hiện lỗi |
| `DetailHistory` | Tab Lịch sử: dòng thời gian từ `asset_logs` / `*_histories` |

Nằm ở phần dùng chung (`components/ui`). Mỗi module chỉ truyền vào cột / nhóm / trường / tab / thao tác của mình — không module nào tự viết khung riêng, và không có hộp thoại riêng cho từng loại bản ghi.

---

## 4. Áp dụng cho từng module

Mỗi module gồm: **Masterlist** (các cột, mặc định hiện các cột chính) và **Detail Modal** (header, tab, nhóm trường, thao tác). Mọi Detail Modal đều kết thúc bằng nhóm **Thông tin hệ thống** (mục 3.5) — không nhắc lại ở từng module.

### 4.1 Equipment

Equipment = **Tester, Base, Fixture** (bảng `equipment`). Thiết bị cần hiệu chuẩn (sub-equipment) và golden board là hai module riêng — [4.2](#42-calibration), [4.3](#43-golden) — nhưng cùng hiện trong cây ở tab **Cây thiết bị** và trang [Overview](#46-overview). Dữ liệu và quy tắc: [DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) mục 3.

**Masterlist:**

| (quan hệ) | No | Status | Serial number | Part number | Type | Location | Jabil ID | Asset | Level | Parent | Thẻ | Remark |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ⊟ | 1 | ● In use | TESTER-01 | P12316 | Tester | B3F1 | J-100201 | A-00045 | EOL | | `Under repair` | |
| └ | 2 | ● In use | BASE-01 | P20001 | Base | B3F1 | J-100202 | A-00046 | EOL | TESTER-01 | | |
| └ | 3 | ○ Not in use | FIXTURE-01 | P30005 | Fixture | B3F2 | J-100203 | A-00047 | | | `Spare` | |

**Cột hiện sẵn mặc định** (cột khác ẩn, mở ở Tùy chọn hiển thị; ai đã tự chỉnh thì giữ theo trình duyệt của người đó): Status · Serial number · Part number · Type · Location · Jabil ID · Asset · Level · Thẻ.

Cột đầu (⊟ / └) cho biết thiết bị có con (equipment, sub-equipment hoặc golden board) / là con của thiết bị khác. **Bộ lọc:** Status, Type, Location, Level, Thẻ. **Lọc nhanh:** "Chưa gắn cha".

**Detail Modal:**

| Phần | Nội dung |
| --- | --- |
| Header | **Serial number** · tag Status · thẻ; dòng 2: Part number · Type · 📍 Location · Cha: `SN-…` · Cập nhật |
| Tab | Thông tin · **Cây thiết bị** · Lịch sử |
| Nhóm **Định danh** | Serial number `*` · Part number `*` (chỉ liệt kê part number loại tester / base / fixture) · Jabil ID · Asset |
| Nhóm **Phân loại** | Type (bắt buộc, luôn theo part number — ô khóa, không chọn tay) · Level `*` (**bắt buộc khi không có cha**; có cha → theo cha, khóa, và ô **hiện Level của cha** (cha cố định của Thêm thiết bị con, hoặc cha vừa chọn trong ô Thiết bị cha) giống ô Location; khi xem ghi nhỏ "theo thiết bị cha"; khi Thêm, chọn part number thì Level của part number được **điền sẵn**, sửa được; thiết bị cũ chưa có Level phải chọn khi sửa lần sau) · Status (chỉ đọc, đổi bằng Check-out / Check-in) |
| Nhóm **Vị trí & quan hệ** | Location `*` (có cha thì khóa, hiện vị trí của cha — "Theo thiết bị cha"; muốn vị trí riêng thì Tách khỏi cha) · Thiết bị cha (không bắt buộc; ô chọn lấy từ `valid_parents`, tìm theo serial / part number; khi xem: chip SN · PN bấm để mở, chưa có cha thì "Không có cha" + thao tác chữ **Gắn vào thiết bị cha**) · Thiết bị con (cả dòng; chip SN · PN của Base / Fixture con trực tiếp, bấm để mở, + thao tác chữ **Thêm thiết bị con**) · Tester còn có **Sub-equipment** (chip SN · Calibration Status, bấm → `/calibration?id=`) và **Golden board** gắn trực tiếp (chip → `/golden?id=`); Fixture có **Golden board**. Thao tác trong ô là nút dạng chữ (không viền), chỉ hiện khi xem, với người sửa được |
| Nhóm **Ghi chú** | **Thẻ** (chọn nhiều, tô màu admin chọn ở Configuration › Tag) · Remark (tối đa 1000 ký tự) |
| Nhóm **Hiệu chuẩn** (chỉ đọc, từ module Calibration — chỉ Tester) | Tóm tắt sub-equipment của tester: n quá hạn · m sắp đến hạn · k chưa hiệu chuẩn / không đạt · còn lại hợp lệ; nút "Xem trong Calibration" (mở `/calibration` đã lọc theo tester này). Tester không có sub-equipment: "Chưa có thiết bị hiệu chuẩn". Base và Fixture không có nhóm này |
| Footer | [Footer chung](#32-header-và-footer-cố-định): trái `[Thao tác ▾]`, phải `[Sửa]` `[Check-out]` / `[Check-in]` |
| `[Thao tác ▾]` (màn hình thao tác) | **Thêm thiết bị con** (Tester → Base hoặc Fixture; Base → Fixture; mở form Thêm, cha điền sẵn và **khóa** — hiện SN · PN · vị trí của cha; Part number chỉ liệt kê loại hợp lệ cho cha; Location ghi "Theo thiết bị cha"; Fixture không có thiết bị con kiểu equipment) · **Đổi vị trí** (chỉ khi không có cha; khóa khi In use) · **Gắn vào thiết bị cha** (chưa có cha) / **Đổi cha** (đã có cha): chọn trong `valid_parents`, Move **luôn được**, kể cả khi đang In use: thiết bị và nhánh con lấy Status (Usage), vị trí và Level của cha mới. Mỗi cha trong danh sách ghi `usage_after`, và mục Kết quả (dry run) liệt kê tài sản đổi Status, ví dụ "FIXTURE-01: In use → Not in use" · **Tách khỏi cha** (được cả khi In use, thiết bị về Not in use) · **Swap** (chỉ với thiết bị cùng Type, chọn trong `swap_candidates`: đổi cha, vị trí và Usage) · **Xóa** (Admin; khóa khi In use) |
| **Check-out / Check-in** (nút footer; màn hình thao tác) | Thiết bị và con cháu (cả sub-equipment, golden board) đổi Status, có ô ghi chú (lưu vào lịch sử) và mục Kết quả liệt kê tài sản sẽ đổi. **Check-out bị khóa**, kèm hướng dẫn, khi: Base / Fixture chưa gắn cha (`USAGE_NEEDS_PARENT` — chỉ Tester được In use khi không có cha) hoặc chọn riêng một con mà cha chưa In use (`PARENT_NOT_IN_USE`; Check-out cả cha lẫn con thì được) |
| Thiết bị có con | **Con luôn đi theo**, không có lựa chọn nào: Đổi vị trí, Move, Swap (và đổi cha / vị trí trong form Sửa) hiện một dòng "A có n thiết bị con — sẽ đi theo" và mục Kết quả liệt kê vị trí / Level / Status mới của cả nhánh. Muốn con ở lại chỗ cũ thì **Tách khỏi cha** con đó trước. **Xóa**: cảnh báo vàng "A có n thiết bị con trực tiếp: không bị xóa, sẽ thành chưa gắn (Not in use)" — nhánh của con đi theo con, không tự gắn lên cha cũ; Kết quả liệt kê từng con (nhật ký `DETACH`, ghi chú `parent_deleted:<SN>`). Swap hai thiết bị cùng cha + cùng vị trí → báo "không thay đổi gì" (`SWAP_NO_CHANGE`), khóa nút chính |
| Mục **Kết quả** của mọi thao tác | Lấy từ `p_dry_run` của hàm tương ứng ([DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) "Hàm thao tác"): danh sách tài sản đổi cha / vị trí / Status. Lỗi của database (ví dụ đang In use) hiện ngay trên màn hình thao tác, trước khi bấm nút chính |
| Sau thao tác | Tải lại cả masterlist (thiết bị đổi chỗ, thiết bị con, cờ "có con", cột Thiết bị cha đều cập nhật), không chỉ dòng đang xem; modal quay về chi tiết + toast |

#### Tab Cây thiết bị (sơ đồ phân tầng)

Mục đích duy nhất: **nhìn nhanh cấu trúc cha – con**. Cây bắt đầu từ Tester gốc của thiết bị đang xem (Base, Fixture không có Tester thì bắt đầu từ chính nó) và gồm cả sub-equipment và golden board. Mỗi dòng chỉ hiện **Part number** và **Serial number**; sub-equipment và golden board có thêm chữ nhỏ `Sub` / `Golden` sau serial. Muốn xem gì thêm thì bấm vào dòng. Dạng **cây thụt lề** (giống cây thư mục) — vừa với modal, giống hệt trên điện thoại, thu gọn được từng nhánh. Đây cũng là nơi xem **cây đầy đủ của một cột Overview** (bảng Overview chỉ hiện tối đa 3 thẻ mỗi cột, kể cả thẻ gốc): bấm thẻ gốc hoặc "+N thiết bị" trên Overview mở modal của tài sản gốc **ngay tab này** (`&tab=tree` trên URL, mục 4.6). Dữ liệu là một hàm database `asset_tree` ([DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) mục 2), do **modal tải một lần** và dùng chung với chip thiết bị con và tóm tắt hiệu chuẩn của Tester; mở thiết bị khác trong cùng cây thì dùng lại cây đã có.

```
[🔍 Tìm PN / SN trong cây ]           [Mở hết] [Thu gọn] [Về thiết bị đang xem]

▾ P12316   TESTER-01                    ← tester gốc
  ├─ ▾ P20001   BASE-01                 ← đang xem: viền đậm, nền nhạt
  │    └─   P30005   FIXTURE-01
  ├─   P30005   FIXTURE-02              ← fixture gắn thẳng vào tester
  ├─   DMM-100  SN-DMM-7   Sub
  └─   GB-001   GB-0007    Golden
```

| Thành phần | Quy tắc |
| --- | --- |
| Mỗi dòng | `▸/▾` (chỉ khi có con) · **Part number** (đậm) · Serial number · `Sub` / `Golden` nếu không phải equipment. Không có PN thì hiện `—` |
| Hai vùng bấm | Bấm `▸/▾` **chỉ** mở / đóng nhánh; bấm phần còn lại của dòng mở chi tiết. Dòng equipment: chi tiết thay vào **cùng modal**, breadcrumb `← SN-001 › SN-002`. Dòng `Sub` / `Golden`: chuyển tới `/calibration?id=` / `/golden?id=` (modal của module kia — luôn chỉ một modal) |
| Dòng đang xem | Viền đậm màu chọn + nền nhạt — không thêm chữ / tag |
| Đường nối | Đường dọc / ngang nối cha → con theo cấp |
| Mặc định khi mở | Mở sẵn chuỗi từ gốc đến thiết bị đang xem và một cấp con của nó; nếu cả cây ≤ 30 dòng thì mở hết |
| `[Mở hết]` / `[Thu gọn]` | Mở / đóng toàn bộ nhánh |
| Ô tìm | Gõ PN hoặc SN → tô nổi bật dòng khớp, tự mở các nhánh chứa dòng khớp |
| `[Về thiết bị đang xem]` | Cuộn lại và mở nhánh tới dòng đang xem |
| Tên dài | Cắt bằng `…`; rê chuột / giữ ngón tay hiện đầy đủ |
| Bàn phím | `↑ ↓` chọn dòng, `→` mở nhánh, `←` đóng nhánh, `Enter` mở chi tiết |

Không hiện trong cây: icon / tên loại, trạng thái, vị trí, dòng tổng số cha / con / cháu — xem trong tab Thông tin. (Toàn hệ thống theo Location: trang Overview, bảng thẻ — [4.6](#46-overview).)

### 4.2 Calibration

> Trên menu, tiêu đề trang và nhãn loại tài sản, module này tên là **Sub-Equipment**; "Calibration" còn lại chỉ việc hiệu chuẩn (Calibration Status, lần hiệu chuẩn, ngày hiệu chuẩn).

Calibration = **sub-equipment** (thiết bị cần hiệu chuẩn nằm trong tester: DMM, power supply, card…) và các lần hiệu chuẩn của chúng (`sub_equipment`, `calibrations`). Dữ liệu và quy tắc: [DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) mục 4.

**Masterlist** (mỗi sub-equipment một dòng, kèm lần hiệu chuẩn mới nhất):

| No | Calibration status | Status | Serial number | Part number | Type | Tester | Location | Calibration date | Due date | Vendor | Cert no | Result | Jabil ID | Asset | Thẻ | Remark |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `Valid` | ● In use | SN-DMM-7 | DMM-100 | DMM | TESTER-01 | B3F1 | 15/12/2025 | **15/06/2026** | ABC Lab | C-0912 | Pass | J-200117 | A-00612 | | |
| 2 | `Overdue` | ○ Not in use | SN-PSU-2 | PSU-300 | Power supply | | Kho | 01/03/2025 | **01/03/2026** | Internal | | Pass | | | `Spare` | |

**Cột hiện sẵn mặc định:** Calibration status · Serial number · Part number · Location · Calibration date · Due date.

Cột Due date tô đỏ (quá hạn) / vàng (sắp đến hạn). **Calibration status** có 5 giá trị tự tính — `Not calibrated`, `Failed`, `Overdue`, `Due soon`, `Valid`. **Lọc nhanh:** "Quá hạn", "Sắp đến hạn", "Chưa hiệu chuẩn / Không đạt"; dòng quá hạn / sắp đến hạn có vạch màu ở mép trái. Bộ lọc: Calibration status, Status, Type, Tester, Location, Vendor, Thẻ.

**Detail Modal:**

| Phần | Nội dung |
| --- | --- |
| Header | **Serial number** · tag Calibration status · tag Status · thẻ; dòng 2: Part number · Type · 📍 Location · Tester: `SN-…` · Due date (màu) · Chu kỳ N tháng |
| Tab | Thông tin · **Hiệu chuẩn** · Lịch sử |
| Nhóm **Định danh** | Serial number `*` · Part number `*` (chỉ liệt kê part number loại sub_equipment) · Jabil ID · Asset |
| Nhóm **Phân loại** | Type (luôn theo part number — khóa) · Status (chỉ đọc, đổi bằng Check-out / Check-in) |
| Nhóm **Vị trí & quan hệ** | Location `*` (đã gắn tester thì khóa — "Theo tester") · Tester (ô chọn lấy từ `valid_parents`, chỉ liệt kê tester; khi xem: chip SN → `/equipment?id=`; chưa gắn: "Chưa gắn tester" + thao tác chữ **Gắn vào tester**) |
| Nhóm **Hiệu chuẩn hiện tại** (chỉ đọc, từ lần mới nhất) | Calibration status · Calibration date · Due date (Tự tính, màu đỏ / vàng) · Vendor · Cert no · File chứng nhận (link) · Result. Chưa hiệu chuẩn: "Chưa có lần hiệu chuẩn nào" |
| Nhóm **Chu kỳ** (chỉ đọc, từ Configuration › Hiệu chuẩn › Setup) | Chu kỳ (tháng) · Báo trước (ngày). Part number chưa có Setup: ghi "Chưa có chu kỳ — khi ghi nhận hiệu chuẩn phải nhập hạn" |
| Nhóm **Ghi chú** | Thẻ · Remark |
| Tab **Hiệu chuẩn** | Bảng mọi lần hiệu chuẩn, mới nhất trên cùng: Calibration date · Due date · Vendor · Cert no · File · Result · Người ghi. Bấm một dòng → màn hình sửa lần đó (Admin, User; `CALIBRATION_UPDATE`); Admin xóa được (`CALIBRATION_REMOVE`) |
| Tab **Lịch sử** | Nhật ký của sub-equipment, có bộ lọc "Chỉ lần hiệu chuẩn" (`CALIBRATE`) |
| Footer | [Footer chung](#32-header-và-footer-cố-định): trái `[Thao tác ▾]`, phải `[Sửa]` **`[Ghi nhận hiệu chuẩn]`** `[Check-out]` / `[Check-in]` |
| `[Thao tác ▾]` | **Swap** (chỉ với sub-equipment cùng Type, chọn trong `swap_candidates`; một bên chưa gắn cũng được — đồng thời là cách thay thế thiết bị) · **Gắn vào tester** / **Đổi tester** (Move; luôn được, Status theo tester mới — mục Kết quả ghi rõ nếu đổi) · **Tách khỏi tester** (Detach) · **Đổi vị trí** (chỉ khi chưa gắn tester; khóa khi In use) · **Xóa** (Admin; khóa khi In use; các lần hiệu chuẩn xóa theo, cảnh báo số lần sẽ mất) |

| Nút | Dùng khi | Màn hình | Ghi nhật ký |
| --- | --- | --- | --- |
| `[Ghi nhận hiệu chuẩn]` | Vừa hiệu chuẩn xong | Màn hình thao tác: Ngày hiệu chuẩn `*` · Kết quả (Đạt / Không đạt) · Vendor · Số chứng nhận · Link file chứng nhận · Remark · xem trước "Hạn mới: dd/mm/yyyy" (từ Setup; part number chưa có Setup thì Hạn mới là ô bắt buộc nhập) | `CALIBRATE` |
| `[Sửa]` | Sửa thông tin sub-equipment nhập sai | Form (cỡ nội dung ~640px) với các nhóm trên | `UPDATE` |
| `[Check-out]` / `[Check-in]` | Đưa vào / ra khỏi sử dụng | Như Equipment (4.1); Check-out cần tester In use | `CHECK_OUT` / `CHECK_IN` |

`+ Thêm` trên masterlist: thêm sub-equipment (form M; chưa có tester thì chọn Location). Import Excel sub-equipment (mục 6). Sub-equipment tự có mặt trong cây của tester chứa nó.

### 4.3 Golden

Golden = **golden board** (PCBA tốt đã biết kết quả; bảng `golden_boards`). Dữ liệu và quy tắc: [DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) mục 5.

**Masterlist:**

| No | Status | Serial number | Part number | UTD part number | Location | Purpose | Origin | Gắn vào | Thẻ | Remark |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ● In use | GS-0001 | PCBA-7781 | UTD-7781-A | B3F2 | ICT check | Customer | FIXTURE-01 | `Pass` | |
| 2 | ○ Not in use | GS-0002 | PCBA-7781 | UTD-7781-A | Kho | ICT check | Customer | | `Pass` | |

**Cột hiện sẵn mặc định:** Status · Serial number · Part number · Location · Purpose · UTD part number. **Lọc nhanh:** "Chưa gắn". Bộ lọc: Status, Location, Gắn vào, Thẻ.

**Detail Modal:**

| Phần | Nội dung |
| --- | --- |
| Header | **Serial number** · tag Status · thẻ; dòng 2: Part number · 📍 Location · Gắn vào: `SN-…` · Cập nhật |
| Tab | Thông tin · Lịch sử |
| Nhóm **Định danh** | Part number `*` (chữ tự do) · Serial number `*` · UTD part number |
| Nhóm **Vị trí & quan hệ** | Location `*` (đã gắn thì khóa — "Theo thiết bị cha") · Gắn vào (Tester hoặc Fixture; ô chọn lấy từ `valid_parents`; khi xem: chip SN → `/equipment?id=`; chưa gắn: "Chưa gắn" + thao tác chữ **Gắn vào tester / fixture**) |
| Nhóm **Trạng thái** | Status (chỉ đọc, đổi bằng Check-out / Check-in) |
| Nhóm **Thông tin thêm** | Origin · Purpose |
| Nhóm **Ghi chú** | Thẻ (ví dụ Pass / Fail) · Remark |
| Footer | [Footer chung](#32-header-và-footer-cố-định): trái `[Thao tác ▾]`, phải `[Sửa]` `[Check-out]` / `[Check-in]` |
| `[Thao tác ▾]` | **Swap** (golden board nào cũng swap được với nhau, kể cả tester ↔ fixture; chọn trong `swap_candidates`) · **Gắn vào** / **Đổi cha** (Move; luôn được, Status theo cha mới — mục Kết quả ghi rõ nếu đổi) · **Tách khỏi cha** (Detach) · **Đổi vị trí** (chỉ khi chưa gắn; khóa khi In use) · **Xóa** (Admin; khóa khi In use) |
| Check-out | Golden board **chỉ In use khi đã gắn** vào tester / fixture (`USAGE_NEEDS_PARENT`) và cha đó In use (`PARENT_NOT_IN_USE`): chưa thỏa thì nút Check-out bị khóa kèm hướng dẫn |

### 4.4 Configuration

Mỗi trang cấu hình (Part Number, Location, Type, Group, Tag, Level, Department; Hiệu chuẩn: Setup, Vendor) dùng cùng Masterlist + Detail Modal.

**Masterlist:** `No` + các cột của bảng đó.

| Trang | Cột |
| --- | --- |
| Location / Level / Department / Vendor | No · Tên · Thứ tự · Đang dùng |
| Group | No · Tên · Thứ tự · Đang dùng — nhóm của Type. Có 4 nhóm sẵn: Tester, Base, Fixture (nhóm hệ thống: không ẩn, không xóa, đổi tên được) và Sub-equipment; Admin thêm / sửa / ẩn nhóm khác. Xóa = ẩn |
| Part Number | No · Tên · Type · **Level** · Thứ tự · Đang dùng. Type chọn trong cả Type hệ thống (Tester / Base / Fixture) lẫn Type sub-equipment: quyết định part number dùng cho Equipment hay Calibration. **Type chỉ đổi được khi chưa có thiết bị nào dùng part number này** (`PART_NUMBER_IN_USE`): đã có thì ô Type khóa kèm chú thích "Đã có thiết bị dùng"; chỉ ẩn được part number, không đổi Type. **Level** chọn trong danh sách Level (Configuration › Level), không bắt buộc, sửa được bất cứ lúc nào; chỉ dùng để điền sẵn Level khi thêm thiết bị mang part number này |
| Type | No · Tên · **Group** · Mô tả · Thứ tự · Đang dùng. Group là **ô chọn** lấy từ Configuration › Group (bắt buộc; chỉ liệt kê nhóm sub-equipment đang dùng). 3 Type hệ thống (Tester, Base, Fixture) không xóa, không ẩn, không đổi Group (ô khóa); nút `+ Thêm` chỉ tạo Type sub-equipment (DMM, Power supply, Card…) |
| Tag | No · Tên · Màu · Thứ tự (danh sách thẻ tình trạng chung cho cả project, chọn trong phần Ghi chú của Equipment / Calibration / Golden; Status và Calibration Status do hệ thống quản, không cấu hình) |
| Setup | No · Part number · Chu kỳ (tháng) · Báo trước (ngày). Part number chỉ chọn khi thêm (trong các part number loại sub-equipment). Đổi chu kỳ chỉ áp dụng cho các lần hiệu chuẩn ghi nhận **sau đó**; hạn (`due_date`) của các lần cũ giữ nguyên |

**Detail Modal:**

| Phần | Nội dung |
| --- | --- |
| Header | **`display_name`** (Setup: part number) · tag Đang dùng / Đã ẩn / Tên trang cấu hình |
| Tab | Thông tin · Lịch sử |
| Nhóm **Thông tin** | Đủ các trường như cột masterlist |
| `[Thao tác ▾]` | Ẩn / Hiện lại (bảng có `is_active`) · Xóa (`tags`, `calibration_configurations`) |

### 4.5 User Management

Tài khoản do **Admin tạo** ([DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) mục 8): không có đăng ký, duyệt / từ chối, tài khoản "local" hay thông báo. Đúng **bốn thao tác Admin**: **Thêm**, **Sửa**, **Đặt lại mật khẩu**, **Khóa / Mở khóa**. Không có Xóa (tài khoản chỉ khóa, để giữ dấu người đã thao tác). Chỉ Admin vào được trang này.

**Masterlist:**

| No | Họ tên | Username | Mã nhân viên | Phòng ban | Nhóm quyền | Trạng thái | Phải đổi mật khẩu |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Nguyễn Văn A | nguyenvana | 100234 | TE | Readonly | ● Hoạt động | Có |

Trạng thái: ● Hoạt động / ● Đã khóa. **Bộ lọc:** Nhóm quyền, Phòng ban, Trạng thái. **Lọc nhanh:** "Đã khóa". Cột Tạo bởi · Tạo lúc ẩn mặc định.

**Detail Modal:**

| Phần | Nội dung |
| --- | --- |
| Header | **Họ tên** · tag Trạng thái (Hoạt động / Đã khóa) · tag Nhóm quyền · username · Phòng ban · Tạo lúc |
| Tab | Thông tin · Lịch sử (`user_histories`: `CREATE`, `UPDATE`, `ROLE_CHANGE`, `DISABLE`, `ENABLE`, `PASSWORD_RESET`; người dùng tự đổi mật khẩu **không** ghi) |
| Nhóm **Tài khoản** | Username `*` (nhập khi Thêm, sau đó khóa — "Không đổi sau khi tạo") · Họ tên `*` · Mã nhân viên · Phòng ban |
| Nhóm **Phân quyền** | Nhóm quyền (Admin / User / Readonly; mặc định khi Thêm: Readonly) |
| Nhóm **Trạng thái** (chỉ đọc) | Trạng thái (Hoạt động / Đã khóa) · Phải đổi mật khẩu (Có / Không) |
| Footer | [Footer chung](#32-header-và-footer-cố-định): trái `[Thao tác ▾]`, phải `[Sửa]` |
| `[Thao tác ▾]` (màn hình thao tác) | **Đặt lại mật khẩu** · **Khóa** / **Mở khóa** (theo trạng thái hiện tại) |

**Các màn hình:**

| Màn hình | Nội dung |
| --- | --- |
| **Thêm** (modal M) | Username, Họ tên, Mã nhân viên, Phòng ban, Nhóm quyền. `[Tạo tài khoản]` → màn hình **Mật khẩu tạm** |
| **Mật khẩu tạm** (sau Thêm và sau Đặt lại mật khẩu) | Hiện mật khẩu hệ thống sinh, dễ đọc (ví dụ `Jabil-4827`) cỡ chữ lớn, nút `[Sao chép]` (đổi thành "Đã sao chép ✓"), ghi chú "Chỉ hiện một lần. Chuyển cho người dùng; họ phải đổi mật khẩu ở lần đăng nhập đầu." `[Xong]` → Thêm: đóng modal M, mở modal L chi tiết tài khoản vừa tạo + toast; Đặt lại: về chi tiết + toast. Chưa bấm `[Sao chép]` mà đóng → xác nhận ở mục 3.7 |
| **Sửa** | Họ tên, Mã nhân viên, Phòng ban, Nhóm quyền (username khóa). Admin sửa **chính mình**: ô Nhóm quyền khóa, ghi "Không tự hạ quyền của mình" (`ADMIN_SELF_CHANGE`). Hạ quyền Admin hoạt động cuối cùng → lỗi `LAST_ADMIN` ngay khi lưu |
| **Đặt lại mật khẩu** (thao tác) | "Đặt lại mật khẩu của `<Họ tên>`? Mật khẩu hiện tại không dùng được nữa; người dùng phải đổi mật khẩu ở lần đăng nhập sau." `[Hủy]` `[Đặt lại mật khẩu]` → Mật khẩu tạm. Có thể đặt lại cho cả tài khoản đang khóa |
| **Khóa / Mở khóa** (thao tác) | Khóa: "`<Họ tên>` sẽ không đăng nhập và không dùng được ứng dụng ngay lập tức." `[Hủy]` `[Khóa]` (đỏ). Mở khóa: `[Hủy]` `[Mở khóa]`. Khóa bị chặn, kèm lý do, với **chính mình** (`ADMIN_SELF_CHANGE`) và **Admin hoạt động cuối cùng** (`LAST_ADMIN`); mục Khóa trong `[Thao tác ▾]` hiện mờ cùng chú thích |

Không hiện ở bất kỳ đâu: mật khẩu (trừ lần hiện duy nhất ở màn hình Mật khẩu tạm), token / mã phiên.

Người dùng tự đổi mật khẩu ở menu tài khoản (màn hình `/change-password`, nhập mật khẩu hiện tại) — không nằm trong User Management.

### 4.6 Overview

Trang **Overview** (menu thứ hai, sau Dashboard) là **bảng thẻ theo Location**: nhìn một lượt mọi Tester và thiết bị đang nằm kho ở từng vị trí, cái nào In use, cái nào có sub-equipment sắp / quá hạn hiệu chuẩn. Thay hoàn toàn cây tải từng nhánh cũ. Dữ liệu từ **một** hàm `overview_board` ([DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) mục 2), tải một lần; lọc và tìm chạy trên server. Cây đầy đủ của một cột xem ở tab **Cây thiết bị** của modal (4.1).

```
┌────────────────────────────────────────────────────────────────────────┐
│ Overview                                                               │
│ ( Tất cả | In use | Not in use )   [Loại ▾]   [ Tìm SN / PN…        ]  │
├────────────────────────────────────────────────────────────────────────┤
│ ▾ B3F1 · 4 tester · 3 In use · 2 ⚠                                     │
│                                                                        │
│ ┌────────────────┐   ┌────────────────┐   ┌────────────────┐           │
│ │▌Tester       ⚠ │   │▌Tester         │   │▌Base           │           │
│ │ PN P12316      │   │ PN P12316      │   │ PN P20001      │           │
│ │ SN TESTER-01   │   │ SN TESTER-02   │   │ SN BASE-07     │           │
│ └────────────────┘   └────────────────┘   │ Chưa gắn       │           │
│ ├─┌─────────────┐    ├─┌─────────────┐    └────────────────┘           │
│ │ │▌Base        │    │ │▌Base        │                                 │
│ │ │ PN P20001   │    │ │ PN P20001   │                                 │
│ │ │ SN BASE-01  │    │ │ SN BASE-03  │                                 │
│ │ └─────────────┘    │ └─────────────┘                                 │
│ ├─┌─────────────┐    ├─┌─────────────┐                                 │
│ │ │▌Sub (DMM) ⚠ │    │ │▌Fixture     │                                 │
│ │ │ PN DMM-100  │    │ │ PN P30005   │                                 │
│ │ │ SN SN-DMM-7 │    │ │ SN FIX-02   │                                 │
│ │ └─────────────┘    │ └─────────────┘                                 │
│ └─ +5 thiết bị       └─ +2 thiết bị                                    │
│                                                                        │
│ ▸ B3F2 · 3 tester · 0 In use · 0 ⚠                ← section thu gọn    │
│ ▾ B4F1 · 1 tester · 1 In use · 1 ⚠                                     │
│   …                                                                    │
└────────────────────────────────────────────────────────────────────────┘
```

| Thành phần | Quy tắc |
| --- | --- |
| Section theo Location | Mỗi Location một section, sắp theo `locations.sort_order` (rồi tên). **Header** là một nút bấm cả dòng (`aria-expanded`): `▾/▸ Tên Location · N tester · M In use · K ⚠` — bấm để thu gọn / mở. N = số cột là Tester; M = số cột In use (chỉ Tester mới In use được khi không có cha, nên đó là số Tester In use); K = tổng số **sub-equipment có cảnh báo** hiệu chuẩn (đỏ + vàng) trong section. K > 0 thì ⚠ tô vàng, có cột quá hạn / không đạt thì tô đỏ. **Location không có cột nào — hoặc bị bộ lọc loại hết — thì ẩn.** Mặc định mở hết; thu gọn do người dùng chọn và nhớ trong tab đang mở. Có bộ lọc thì mọi section còn lại **tự mở** (kể cả section đã thu gọn); bỏ lọc thì trở về trạng thái đã thu gọn trước đó |
| Cột | Mỗi cột là **một tài sản gốc** (không có cha). Thứ tự trong section: **Tester trước**, rồi thiết bị **chưa gắn** (Base / Fixture / Golden / Sub) — thẻ gốc của chúng có dòng nhỏ **`Chưa gắn`** — mỗi nhóm theo serial. Cột **căn trên** |
| Thẻ | **Không có icon.** Dòng 1: **tên Type** (`Tester`, `Base`, `Fixture`; golden board: `Golden`; sub-equipment: `Sub (DMM)` — tên Type trong ngoặc) + **⚠** nếu có. Dòng 2: nhãn nhỏ nhạt `PN` + part number. Dòng 3: nhãn nhỏ nhạt `SN` + serial. Giá trị dài cắt bằng `…`, tooltip hiện đầy đủ. **Không hiện Location** (đã có ở header section). **Viền trái = Status**: xanh lá In use, xám Not in use (màu cố định của Status, kèm `aria-label`). **Thẻ gốc có nền đậm hơn** thẻ con |
| ⚠ | **Vàng** = `due_soon`, **đỏ** = `overdue` hoặc `failed` (tooltip và `aria-label` ghi đúng trạng thái). Trên thẻ sub-equipment là cảnh báo của chính nó; **thẻ gốc (Tester) hiện ⚠ nếu có con bị** — kể cả con không hiện trong cột — với mức xấu nhất trong số đó |
| Thẻ con và "+N" | Mỗi cột hiện **tối đa 3 thẻ, tính cả thẻ gốc** (thẻ gốc + 2 thẻ khác) chọn trong cả cây (không chỉ con trực tiếp); phần còn lại là dòng **`+N thiết bị`**. Thứ tự ưu tiên chọn: ① **thẻ khớp bộ lọc** (chỉ khi đang lọc) ② **cảnh báo hiệu chuẩn**: overdue / failed trước, rồi due soon ③ **Base → Fixture → Golden → Sub** ④ serial. Thẻ nào cần thẻ cha để đường cây không đứt thì **thẻ cha cũng tính vào 3** (Fixture dưới Base = Base + Fixture, hết chỗ; Golden ở cấp 3 không vừa). Thẻ không vừa chỗ thì bỏ qua, xét thẻ kế tiếp. **Ngoại lệ duy nhất**: thẻ khớp bộ lọc đứng đầu luôn hiện cùng các thẻ cha của nó dù cột thành cao hơn 3 — để thẻ tìm được không nằm sau "+N". N = `descendants` của thẻ gốc − số thẻ đang hiện dưới thẻ gốc |
| Đường cây | Thẻ con xếp dọc dưới thẻ gốc, nối bằng đường cây `├` `└`, **thụt ~10px mỗi cấp**, tối đa **4 cấp** (Tester → Base → Fixture → Golden). Anh em trong cột theo thứ tự Base → Fixture → Golden → Sub rồi serial (`pos` do database trả về) |
| Lưới | Các cột trong một section xếp theo **lưới tự điền**, cột rộng tối thiểu **~150px** (≈ 7 cột trên laptop, nội dung ~1100px); **điện thoại 2 cột**. Chi tiết kích thước: [JABIL_UI.md](JABIL_UI.md) "Overview board" |
| Bấm | **Thẻ con** → `RecordModal` của chính tài sản đó. **Thẻ gốc hoặc `+N thiết bị`** → `RecordModal` của tài sản gốc, **mở sẵn tab Cây thiết bị** (với thẻ gốc là thiết bị có con; thẻ gốc không có con — sub-equipment, golden board, thiết bị chưa gắn không có con — mở tab Thông tin như thường). URL `?id=<id>&type=<equipment\|sub_equipment\|golden_board>`, thêm `&tab=tree` khi mở sẵn tab cây (chỉ có ý nghĩa với `type=equipment`) |
| Thanh lọc | `( Tất cả \| In use \| Not in use )` · `[Loại ▾]` (Tất cả / Tester / Base / Fixture / Sub-equipment / Golden) · ô tìm **SN / PN** (đợi ~300ms sau khi ngừng gõ). Ba bộ lọc kết hợp **và**. Có lọc thì **chỉ giữ cột có ít nhất một tài sản khớp** — kể cả khi thẻ khớp đang nằm sau "+N" (nó được chọn lên đầu) — **thẻ khớp được tô nổi bật** (viền Picton + nền nhạt, kèm `aria-label`), các section còn lại tự mở. Thẻ cha được kéo theo chỉ để nối đường cây: chỉ tô khi chính nó khớp. Tô nổi bật chỉ khi lọc theo **Loại** hoặc tìm **SN / PN**; lọc theo Status thì mọi thẻ In use của cột đều khớp nên **không tô** (cột vẫn chỉ giữ khi có tài sản khớp) |
| Trống / lỗi | Chưa có tài sản nào: `EmptyState` (không có nút thêm — Overview chỉ đọc). Lọc ra rỗng: "Không có thiết bị khớp" + `Xóa bộ lọc`. Lỗi tải: `ErrorState` + `Thử lại`. Đang tải lần đầu: khung xương của section và cột; tải lại (sau khi sửa, đổi bộ lọc) giữ bảng cũ, không nháy về khung xương |
| Bàn phím, đọc màn hình | Mọi thẻ và header là `button` (Tab, Enter / Space); mỗi cột là một nhóm có tên là serial của thẻ gốc; đường cây chỉ để trang trí (`aria-hidden`), thứ bậc cha – con nói trong tên của thẻ ("… thuộc <serial cha>") |

**Detail Modal của Overview** là **đúng `RecordModal` của module sở hữu bản ghi**, chọn theo `type` trên URL — `equipment` → modal Equipment (4.1), `sub_equipment` → modal Calibration (4.2), `golden_board` → modal Golden (4.3). **Không có footer riêng**: dùng footer chung (3.2) — trái `[Thao tác ▾]` (Swap, Move / Detach, Đổi vị trí, Xóa), phải `[Sửa]` `[Check-out]` / `[Check-in]` (sub-equipment thêm `[Ghi nhận hiệu chuẩn]` trước Check-out). Lịch sử là tab Lịch sử. Swap chọn thiết bị **cùng loại** trong `swap_candidates` (equipment cùng Type; sub-equipment cùng Type; golden board bất kỳ). Sau mỗi thao tác modal quay về chi tiết + toast và **bảng tải lại** (giữ bộ lọc và các section đã thu gọn / mở): thiết bị đổi chỗ, đổi Status hay đổi cha có thể dời cả cột sang section khác.

Quyền: mọi nhóm xem được; Swap và Check-out / Check-in cho Admin, User ([DATABASE_MODIFIED.md](DATABASE_MODIFIED.md) "Phân quyền").

---

## 5. Đã chốt và còn chờ review

**Đã chốt (08/10/2026):**

- **Cỡ modal không đổi giữa các màn hình**: giữ cỡ của màn hình mở đầu đến khi đóng. Form / thao tác / xác nhận bên trong modal L giới hạn nội dung ~640px, căn giữa (mục 3.1).
- **Đóng modal**: Esc / ✕ / bấm ngoài — nếu có bất kỳ thay đổi chưa lưu (form, Ghi chú, lựa chọn trong màn thao tác) thì hiện "Hủy bỏ thay đổi?" ngay trong modal; popover đang mở thì Esc chỉ đóng popover (mục 3.7).
- **Một ngưỡng 768px** cho modal toàn màn hình, danh sách dạng thẻ và sidebar dạng ngăn kéo (mục 3.11). Code: `usePhone` = `(max-width: 767px)`, mọi `@media` trong `app/*.css` dùng 767px / 768px.
- **Overview mở đúng `RecordModal` của module theo `type`, không có footer riêng.** Footer chung: trái `[Thao tác ▾]` (Swap, Move / Detach, Đổi vị trí, Xóa); phải `[Sửa]` `[Check-out]` / `[Check-in]`; sub-equipment thêm `[Ghi nhận hiệu chuẩn]` trước Check-out (mục 3.2, 4.6).
- **Overview là bảng thẻ theo Location (09/10/2026), thay hoàn toàn cây tải từng nhánh**: section theo Location, mỗi cột một tài sản gốc (Tester trước, rồi thiết bị chưa gắn), tối đa 3 thẻ mỗi cột kể cả thẻ gốc, chọn theo ưu tiên (khớp lọc → cảnh báo hiệu chuẩn → Base → Fixture → Golden → Sub), một hàm database `overview_board` trả cả bảng trong một lần, lọc và tìm chạy trong database; bấm thẻ gốc / "+N" mở modal tài sản gốc ở tab Cây thiết bị (mục 4.6).
- **Thêm mới**: lưu xong thì **đóng modal M và mở lại modal L** chi tiết bản ghi vừa tạo + toast (mục 3.6).
- **Move luôn được** (trừ quy tắc cây), kể cả khi đang In use: tài sản lấy Status của cha mới, nhánh con theo. Kết quả xem trước (`usage_changes`) và `usage_after` của `valid_parents` để modal hiển thị "In use → Not in use". `PARENT_NOT_IN_USE` chỉ còn cho Check-out riêng một con (mục 4.1).
- **Calibration status** có 5 giá trị tự tính — `Not calibrated`, `Failed`, `Overdue`, `Due soon`, `Valid` (nhãn "Not calibrated" thay cho "Under calibration" cũ).
- "Hủy bỏ thay đổi?" là một màn hình trong cùng modal (không phải hộp thoại thứ hai); menu và ô chọn là popover được nằm trên modal; đường dẫn cũ `/equipment/{id}`… chuyển hướng sang `?id=` (mục 3.6, 3.9).

**Còn chờ bạn review (2 điểm):**

1. **Cột Masterlist** của Equipment, Calibration, Golden (mục 4.1–4.3) và Configuration, User Management (4.4–4.5) — đã viết theo schema mới; thứ tự cột và cột mặc định có cần đổi không?
2. **Bố cục trên điện thoại** (mục 3.11) — danh sách dạng thẻ, modal toàn màn hình dưới 768px, footer có Thao tác + nút chính. Có ổn không?

## 6. Triển khai

Giao diện làm theo mục 3–4: một component `Modal` (cỡ là prop), `RecordModal` giữ ngăn xếp màn hình, `ModuleWorkspace` là trang Masterlist full chiều rộng với trạng thái nằm trên URL. Không còn side panel, `DetailPanel`, `RecordDetail` hay `RecordPage`.

| Component | File | Ghi chú |
| --- | --- | --- |
| `Modal`, `ModalFooter`, `ModalSuspend`, `useInModal` | [components/ui/index.tsx](../components/ui/index.tsx) | Vẽ ra `document.body` (portal); cỡ `s` / `m` / `l` do prop; khi mở: nền `inert` + không cuộn, khóa focus, Esc / ✕ / bấm ngoài (chỉ khi lần bấm **bắt đầu** ở ngoài), `busy` = không đóng được. Màn hình bên trong đặt nút ở footer bằng `<ModalFooter>` (portal vào footer của modal gần nhất, tự ẩn khi đang bị che bởi "Hủy bỏ thay đổi?") |
| `RecordModal`, `ActionScreen`, `DiscardScreen` | [components/ui/record/](../components/ui/record) | Chi tiết · Sửa · Thêm mới · Thao tác · Xóa trong **một** modal; header `‹ ›` hoặc breadcrumb `← SN-001 › Sửa` (và đường mở bản ghi liên quan `← SN-001 › SN-002`); footer chung (`[Thao tác ▾]` trái, `[Sửa]` + nút riêng + nút chính phải; điện thoại chỉ giữ nút chính); phím ← →; "Hủy bỏ thay đổi?" là màn hình trong modal (`useLeaveGuard` — màn hình báo có thay đổi / chữ riêng như mật khẩu tạm chưa sao chép); `useRecordBusy`; `openAction(key)` cho liên kết chữ trong chi tiết; `ActionDef.hidden` (thao tác chỉ mở từ chỗ khác, ví dụ sửa một lần hiệu chuẩn); `beforeSave` (cảnh báo rồi nút "Vẫn lưu"); `savedScreen` (màn hình sau Thêm, ví dụ Mật khẩu tạm) |
| `DetailSection`, `DetailValue`, `FieldView`, `FieldEditor`, `ActionField`, `SystemInfoSection` | [components/ui/record/fields.tsx](../components/ui/record/fields.tsx) | `FieldDef` / `SectionDef` module khai báo; nhóm "Thông tin hệ thống" khung tự thêm; `SectionDef.viewExtra` nối nội dung chỉ đọc sau các trường (thiết bị con, sub-equipment…) |
| `ActionMenu` | [components/ui/ActionMenu.tsx](../components/ui/ActionMenu.tsx) | `[Thao tác ▾]` / `⋮`: popover vẽ ra body, mở lên trên khi dưới không đủ chỗ (footer ở đáy); Esc đóng popover trước modal |
| `SearchableSelect` | [components/ui/SearchableSelect.tsx](../components/ui/SearchableSelect.tsx) | Popover neo vào ô (cả trên điện thoại, không có tấm trượt thứ hai); chế độ `onSearch` (tìm trên server: cha hợp lệ, thiết bị Swap) với `loading` / `selectedLabel` |
| `DetailHistory` | [components/ui/detail/DetailHistory.tsx](../components/ui/detail/DetailHistory.tsx) | Dòng thời gian `Trường: cũ → mới` (+ vị trí cũ → mới) |
| `Masterlist`, `RowCard`, `ColumnSettings` | [components/ui/masterlist/](../components/ui/masterlist) | Tải đủ dữ liệu một lần, tìm / lọc / sắp xếp ngay trên trình duyệt; vẽ dần 200 dòng khi cuộn. Xuất Excel đúng cột và dòng đang hiện. Điện thoại: thẻ thay bảng; `usePhone` ([lib/client/usePhone.ts](../lib/client/usePhone.ts)) là nơi duy nhất quyết định "đang ở điện thoại" cho JS. `initialSearch` điền sẵn ô tìm (`?q=`) |
| `ModuleWorkspace`, `useList`, `useUrlParams` | [components/ui/workspace/ModuleWorkspace.tsx](../components/ui/workspace/ModuleWorkspace.tsx), [lib/client/useUrlParams.ts](../lib/client/useUrlParams.ts) | URL là nguồn sự thật: `?id=` (chi tiết), `?new=1` (thêm mới), `?tool=` (công cụ như Import), `?q=`. Đổi bằng `history.pushState` / `replaceState` (Next.js nối vào `useSearchParams`, không chờ server): mở từ danh sách = **push** (Back đóng modal; đóng bằng ✕ = `history.back()` để lịch sử không thừa), chuyển bản ghi / thêm mới → chi tiết = **replace**. Bản ghi tải theo id (`recordUrl`), `‹ ›` theo thứ tự đang hiện, `trail` cho breadcrumb, `reload` + `version` để phần tải riêng của modal (cây, thiết bị con) tải lại theo. Test đổi URL bằng [lib/client/testing/urlParamsMock.ts](../lib/client/testing/urlParamsMock.ts) |
| `ImportModal` | [components/ui/ImportModal.tsx](../components/ui/ImportModal.tsx) | Import Excel ba bước, modal L, dùng cho Equipment / Calibration / Golden; đang ghi thì không đóng được |
| Nhân tài sản dùng chung | [components/assets/](../components/assets) | `api.ts` (đường dẫn, `parentOf`, lời gọi `/api/assets/*`, `useDryRun`), `OpResult` (mục **Kết quả** từ `dry_run`), `pickers.tsx` (`ParentPicker`, `SwapPicker` tìm trên server), `screens.tsx` (Đổi vị trí, Gắn vào / Đổi cha, Tách khỏi cha, Swap, Xóa, Check-out / Check-in — xem trước bằng `dry_run`, lỗi hiện ngay), `actions.tsx` (`assetActions`: thứ tự và điều kiện hiện của footer chung), `Relations.tsx` (chip cha / con, liên kết chữ, mở bản ghi cùng / khác module), `TreeTab.tsx` (cây thụt lề, bàn phím), `SerialWarning`, `AssetLabel` (nhãn QR của ba module) |
| Equipment | [components/equipment/](../components/equipment) | `EquipmentWorkspace` (cột, lọc nhanh "Chưa gắn", Import), `EquipmentModal` (nhóm trường, quan hệ cha – con, nhóm Hiệu chuẩn của Tester, tab Cây thiết bị, Thêm thiết bị con, cảnh báo serial trùng) |
| Calibration | [components/calibration/](../components/calibration) | `CalibrationWorkspace`, `CalibrationModal` (nút `[Ghi nhận hiệu chuẩn]` đứng trước Check-out, tab Hiệu chuẩn), `CalibrationScreens` (Ghi nhận kèm "Hạn mới", sửa / xóa một lần hiệu chuẩn) |
| Golden | [components/golden/](../components/golden) | `GoldenWorkspace`, `GoldenModal` |
| Overview | [components/overview/](../components/overview) | `OverviewPage` (một lần tải `GET /api/overview`, thanh lọc Status / Loại / tìm chữ trên server, thu gọn section), `OverviewBoard` (`BoardSection`, cột, thẻ, đường cây — `columnEntries` tính ô đường cây, "+N" là con cuối "ảo" của thẻ gốc; `BoardSkeleton`), `OverviewRecord` (mở đúng modal của module theo `type`, truyền `tab` cho modal Equipment) |
| Configuration, User Management | [components/configuration/](../components/configuration), [components/users/](../components/users) | `ConfigWorkspace` / `ErrorLogWorkspace`, `UsersWorkspace` / `UserModal` (+ `TempPasswordView`: Mật khẩu tạm là một màn hình trong modal). Account settings ([UserMenu.tsx](../components/UserMenu.tsx)) là modal M |

Bổ sung khi làm:

- **Lọc nhanh** cạnh Bộ lọc: Equipment và Golden có "Chưa gắn"; Calibration có "Overdue" / "Due soon" / "Not calibrated / Failed"; User Management có "Đã khóa". Dòng quá hạn / không đạt / sắp đến hạn có vạch màu ở mép trái.
- Trường chọn từ Configuration chỉ hiện giá trị **đang dùng**. Giá trị đã ẩn mà bản ghi đang giữ vẫn hiện, kèm chữ "(Đã ẩn)".
- Serial trùng (cả ba bảng): **cảnh báo trước khi lưu** ngay trong form (`serial_matches`, danh sách tài sản trùng), nút chính thành "Vẫn lưu"; đổi ô nào thì kiểm tra lại.
- Thẻ tô theo màu Admin chọn ở Configuration › Tag (5 màu, `tags.color`), luôn kèm chữ. Status của tài sản (In use / Not in use) và Calibration Status có màu cố định.
- Đang tải / lỗi: mọi vùng tải dữ liệu dùng `useFetch` ([lib/client/useFetch.ts](../lib/client/useFetch.ts)) — giữ dữ liệu cũ khi tải lại (modal không nháy về khung xương khi tải lại ngầm), bỏ qua phản hồi cũ, lỗi hiện kèm nút Thử lại. Màn hình thao tác (`ActionScreen`) tự khóa khi đang gửi; lỗi luôn là câu theo mã lỗi (`errorMessage()`), không có thao tác nào im lặng.
- **In nhãn QR** (`[Thao tác ▾]` › In nhãn, mở tab mới): `/equipment/{id}/label`, `/calibration/{id}/label`, `/golden/{id}/label`; mã QR dẫn tới `?id=` của module.
- Những gì chưa có (xác nhận, ghi ở đây để khỏi tìm): Back của trình duyệt khi đang sửa đóng modal mà không hỏi (lịch sử là của trình duyệt); Account settings gồm hai form độc lập, mỗi form lưu riêng nên không có "Hủy bỏ thay đổi?".

**Import Excel (Equipment):**

- **File mẫu** sinh lúc bấm tải (`GET /api/equipment/import/template`), nên luôn khớp Configuration lúc đó — ví dụ Admin có Level 1–5 thì file ghi "Chọn: 1, 2, 3, 4, 5". Sheet `Equipment`: dòng 1 ghi chú từng cột nhận gì (bắt buộc, độ dài, danh sách), dòng 2 tiêu đề (`*` = bắt buộc), nhập từ dòng 3. Cột chọn có ô thả xuống; bấm vào ô hiện chú thích; ô dạng chữ (giữ số 0 đầu serial). Thêm sheet Hướng dẫn và Giá trị hợp lệ (nguồn của ô thả xuống, khóa sửa). Configuration đổi thì tải lại mẫu.
- **Cột** theo thứ tự form Thêm thiết bị: Serial number ✔, Part number ✔ (loại tester / base / fixture), Jabil ID, Asset, Type (để trống hoặc ghi đúng Type của part number), Level, **Status** (`In use` / `Not in use`), Location ✔ (trừ khi có cha), Parent serial number, Parent part number, **Tags** (tên thẻ, cách nhau dấu `;` hoặc dấu phẩy), Remark. Status và Tags không bắt buộc: file mẫu cũ không có hai cột này vẫn import được (Not in use, không thẻ).
- **Thiết bị cha**: `Parent serial number` tìm trong thiết bị đã có **và** các dòng khác của file (không phân biệt hoa / thường, thứ tự dòng không quan trọng — dòng con đứng trước dòng cha vẫn được). `Parent part number` chỉ cần khi serial đó trùng ở nhiều thiết bị (tìm cả mã đã ẩn). Có cha thì để trống Location: vị trí theo cha (cả chuỗi cha – con trong file); ghi Location khác vị trí của cha → lỗi. Không tìm thấy / khớp nhiều thiết bị / cha sai loại (`PARENT_TYPE_INVALID`) → lỗi dòng đó.
- **Kiểm tra** (`POST /api/equipment/import`) cùng quy tắc với form — cha phải đúng loại (Base → Tester; Fixture → Base hoặc Tester), rồi `equipment_import` với `p_dry_run` kiểm tra lại cả file bằng chính database trước khi ghi: giá trị chọn tìm theo tên, không phân biệt hoa / thường; chưa có / đã ẩn → lỗi. **Status**: ô trống = theo cha (cả chuỗi cha – con trong file), hoặc Not in use khi không có cha; thiết bị con ghi Status khác Status của cha → lỗi (`usage_follows_parent`, như Location / Level); chỉ **Tester** được In use khi không có cha, loại khác → lỗi (`usage_needs_parent`, đúng quy tắc `USAGE_NEEDS_PARENT` của database); chữ khác In use / Not in use → lỗi (`usage_invalid`). **Tags**: tên thẻ trong Configuration › Tag (không phân biệt hoa / thường), bỏ trùng, thứ tự ghi trong ô là thứ tự lưu; thẻ chưa có → một lỗi cho ô, liệt kê các thẻ đó (không tự tạo thẻ). Serial trùng (trong hệ thống hoặc trong file) chỉ cảnh báo. Báo lỗi theo số dòng Excel.
- **Tất cả hoặc không**: còn dòng lỗi thì nút Import tắt; Import kiểm tra lại từ đầu rồi ghi qua `equipment_import` trong một giao dịch, lịch sử `CREATE` nguồn `import`. Tối đa 1000 dòng, 5 MB, chỉ `.xlsx`.

**Import Excel (Golden):** cùng cách làm và giao diện ([ImportModal](../components/ui/ImportModal.tsx)) — `GET /api/golden/import/template`, `POST /api/golden/import`, ghi qua `golden_import`. Sheet `Golden`, cột: Part number ✔, Serial number ✔, UTD part number, Location ✔ (trừ khi có cha), Parent serial number (Tester hoặc Fixture; để trống = chưa gắn), Origin, Purpose, Remark. Khác Equipment: Part number là chữ tự do (không phải Configuration). Mã: [lib/goldenImport.ts](../lib/goldenImport.ts), [lib/services/goldenImport.ts](../lib/services/goldenImport.ts). Cần chạy lại `database/04_functions.sql` để có `golden_import`.

**Import Excel (Sub-equipment):** cùng cách làm — `GET /api/calibration/import/template`, `POST /api/calibration/import`, ghi qua `sub_equipment_import`. Sheet `Sub-equipment`, cột: Serial number ✔, Part number ✔ (loại sub-equipment), Jabil ID, Asset, Type (để trống hoặc đúng Type của part number), Tester serial number + Tester part number (để trống = chưa gắn), Location ✔ (trừ khi có tester), Remark. Lần hiệu chuẩn nhập trong app, không import.

**Chưa làm:** Repair làm sau theo DATABASE_MODIFIED.md.

## Tham khảo

- Modal: khi nào dùng, cỡ, đóng — [Carbon: Modal](https://carbondesignsystem.com/components/modal/usage/)
- Chuyển bản ghi bằng phím / nút trước – sau — [Linear: Peek](https://linear.app/docs/peek)
- Tránh đóng nhầm và overlay chồng overlay — [NN/G: Accidental overlay dismissal](https://www.nngroup.com/articles/accidental-overlay-dismissal/)
- Cây thu gọn, hai vùng bấm, tìm trong cây — [Primer: TreeView](https://primer.style/product/components/tree-view/guidelines/), [Spectrum: Tree view](https://spectrum.adobe.com/page/tree-view/)
- Bảng cho người dùng tự chọn cột — [Cloudscape: Table view](https://cloudscape.design/patterns/resource-management/view/table-view/)
