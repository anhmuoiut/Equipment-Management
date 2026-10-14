# Khung sườn ứng dụng (App Shell)

Cập nhật: 14/10/2026. Code — menu: [components/layout/AppSidebar.tsx](../components/layout/AppSidebar.tsx); danh sách con Configuration: [components/configuration/ConfigNav.tsx](../components/configuration/ConfigNav.tsx); route: `app/(app)/…`.

Khung gồm top bar, sidebar (thu gọn được, thành ngăn kéo trên điện thoại), sáng / tối và ngôn ngữ. Nội dung trong từng trang theo [DETAIL_MODEL.md](DETAIL_MODEL.md) (Masterlist full chiều rộng + Detail Modal); dữ liệu theo [DATABASE_MODIFIED.md](DATABASE_MODIFIED.md); màu, font, kích thước theo [JABIL_UI.md](JABIL_UI.md).

## 1. Menu

Bảy mục, **một cấp duy nhất**, đúng thứ tự:

| # | Menu | Icon | Đường dẫn | Ai thấy | Nội dung |
| --- | --- | --- | --- | --- | --- |
| 1 | Dashboard | `LayoutDashboard` | `/` | Mọi nhóm | Số liệu tổng hợp, sub-equipment quá hạn / sắp đến hạn hiệu chuẩn, thay đổi gần đây |
| 2 | Overview | `Network` | `/overview` | Mọi nhóm | Bảng thẻ theo Location: mỗi cột một tài sản gốc (Tester, rồi thiết bị chưa gắn), tối đa 3 thẻ mỗi cột (kể cả thẻ gốc); lọc Status / Loại, tìm SN / PN |
| 3 | Equipment | `LayoutList` | `/equipment` | Mọi nhóm | Masterlist tester / base / fixture |
| 4 | Sub-Equipment | `Gauge` | `/calibration` | Mọi nhóm | Masterlist sub-equipment kèm Calibration Status, lịch sử hiệu chuẩn (tên trên menu và tiêu đề trang là **Sub-Equipment**; đường dẫn vẫn `/calibration`) |
| 5 | Golden | `CircuitBoard` | `/golden` | Mọi nhóm | Masterlist golden board |
| — | *(đường kẻ ngăn)* | | | | |
| 6 | Configuration | `SlidersHorizontal` | `/configuration/…` | **Chỉ Admin** | Danh sách cấu hình + Error log |
| 7 | User Management | `Users` | `/users` | **Chỉ Admin** | Masterlist tài khoản |

- User và Readonly chỉ thấy 5 mục đầu (không có đường kẻ ngăn).
- Không có số đếm cạnh menu. Thiết bị quá hạn xem ở Dashboard. Không có chuông / bảng thông báo: tài khoản do Admin tạo nên không có gì cần báo.

---

## 2. Top bar, sidebar, điện thoại

| Phần | Quy tắc |
| --- | --- |
| Top bar | Logo Jabil + **Equipment Management** bên trái (một dòng); bên phải: ngôn ngữ + sáng / tối · menu tài khoản. Điện thoại: chỉ còn `☰` · thương hiệu · tài khoản (nút tròn, không mũi tên); **ngôn ngữ và sáng / tối nằm trong menu tài khoản** (English ✓ / Tiếng Việt, Chuyển sang chế độ tối) |
| Sidebar | Nền Prussian, mục đang chọn màu Picton. Desktop chỉ mở rộng / thu gọn khi bấm nút ở footer: `>>` để mở, `<<` để thu gọn; rê chuột, rời chuột và focus không đổi chiều rộng. Ghi nhớ lựa chọn. Khi thu gọn, rail rộng 96px, tên menu hiện dưới icon, căn giữa và xuống dòng nếu dài; khi mở rộng, tên nằm cạnh icon. Menu cuộn riêng để footer luôn nhìn thấy trên màn hình thấp. Phone dùng nút `☰` trên top bar, hiện logo SolarEdge ở đầu ngăn kéo và credit tác giả ở footer; ẩn nút thu gọn desktop. Không có dòng trạng thái hệ thống trang trí |
| Điện thoại / màn hẹp (dưới 768px — ngưỡng duy nhất của cả giao diện) | Sidebar ẩn, nút `☰` trên top bar mở sidebar phủ lên nội dung, chọn menu xong tự đóng. Ngăn kéo có logo SolarEdge, bảy mục theo quyền và credit ở cuối; menu cuộn riêng, giữ logo và footer nhìn thấy. |
| Tiêu đề trang | Nằm trong nội dung trang, không lặp lại trên top bar |
| Kích thước | Theo bảng "Current compact dimensions" trong [JABIL_UI.md](JABIL_UI.md) |

Không có cấp menu thứ hai trong sidebar.

Sidebar desktop đang mở rộng và ngăn kéo phone hiện logo [SolarEdge](../public/Icon/solaredge-logo.svg) ở phía trên menu, trên nền trắng để giữ rõ phần chữ đen/đỏ của SVG gốc. Logo chỉ ẩn khi thu gọn trên desktop; lựa chọn desktop không ảnh hưởng logo trên phone.

Footer khi sidebar desktop mở rộng hiện **Developed by Man Tran8118**, chữ 11px căn giữa phía trên nút thu gọn. Ngăn kéo phone hiện cùng dòng chữ ở footer, có khoảng đệm safe area và không có nút thu gọn desktop. Giữ nguyên dòng chữ này trong cả EN/VI; chỉ ẩn khi thu gọn trên desktop.

Chuyển trạng thái dùng spring chung cho chiều rộng, chiều cao dòng menu, vị trí icon và mũi tên footer; mở có nhịp dừng nhẹ, đóng nhanh hơn. Hai cách đặt tên menu chuyển bằng fade tuần tự, không đổi layout chữ đột ngột. Logo/credit giữ trong DOM để đóng/mở mượt và dùng `aria-hidden` khi ẩn trên desktop. Trên phone, logo và footer giữ nguyên kích thước và trượt cùng ngăn kéo. Bấm liên tiếp giữ đà chuyển động và dừng ở lựa chọn cuối; chế độ giảm chuyển động bỏ hiệu ứng. Nhịp CSS 320ms chỉ là fallback trước khi controller hoạt động.

---

## 3. Trang Configuration

Các danh sách cấu hình được chọn bằng **danh sách con bên trái trong trang**, gom theo nhóm. Bấm tên nhóm để **mở / đóng** (thả xuống) các mục bên trong:

```
┌──────────────────────────┬──────────────────────────────────────────────────┐
│ ▾ DỮ LIỆU GỐC            │ Location                                 6 dòng  │
│     Part Number          │ [🔍 Tìm…] [Tùy chọn hiển thị] [Xuất Excel] [+ Thêm]│
│   ▸ Location             │ ┌──────────────────────────────────────────────┐ │
│     Type                 │ │ No  Tên     Thứ tự                            │ │
│     Group                │ │ 1   B3F1    1                                 │ │
│     Tag                  │ │ …                                             │ │
│     Level                │ │ …                                             │ │
│     Department           │ └──────────────────────────────────────────────┘ │
│ ▸ HIỆU CHUẨN          (2)│                                                  │
│ ▸ HỆ THỐNG            (1)│                                                  │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

| Nhóm | Mục | Đường dẫn |
| --- | --- | --- |
| DỮ LIỆU GỐC | Part Number | `/configuration/part-numbers` |
| | Location | `/configuration/locations` |
| | Type | `/configuration/types` |
| | Group — nhóm của Type (Admin thêm / sửa / ẩn) | `/configuration/type-groups` |
| | Tag | `/configuration/tags` |
| | Level | `/configuration/levels` |
| | Department | `/configuration/departments` |
| HIỆU CHUẨN | Setup — part number phải hiệu chuẩn (trong các PN đang có thiết bị), chu kỳ, số ngày báo trước | `/configuration/calibration-setup` |
| | Vendor | `/configuration/calibration-vendors` |
| HỆ THỐNG | Error log | `/configuration/error-log` |

| Mục | Quy tắc |
| --- | --- |
| Mở / đóng nhóm | Bấm tên nhóm; nhóm đang đóng hiện số mục bên trong, ví dụ `(2)`. Ghi nhớ lựa chọn của từng người |
| Nhóm chứa trang đang xem | Luôn mở khi vào trang (để thấy mục đang chọn) |
| Mở menu Configuration | Vào danh sách đầu tiên (Part Number) |
| Nội dung bên phải | Masterlist + Detail Modal như mọi module |
| Error log | Chỉ xem (không thêm / sửa); vẫn có tìm kiếm, bộ lọc, xuất Excel và Detail Modal để xem chi tiết lỗi |
| Điện thoại | Danh sách con đổi thành ô chọn thả xuống ở đầu trang, các mục chia theo nhóm |

---

## 4. Đường dẫn

| Trang | Đường dẫn | Ghi chú |
| --- | --- | --- |
| Đăng nhập | `/login` | Thiết kế: [JABIL_UI.md](JABIL_UI.md) mục 3 |
| Dashboard | `/` | |
| Overview | `/overview` | `?id=<id>&type=<equipment|sub_equipment|golden_board>` mở modal của bản ghi; thêm `&tab=tree` để mở sẵn tab Cây thiết bị (chỉ khi `type=equipment`) |
| Equipment | `/equipment`, `/equipment?id={id}` | `?id=` mở modal chi tiết — dùng cho QR và chia sẻ link. `/equipment/{id}` (link cũ) chuyển sang `?id=` |
| Nhãn QR | `/equipment/{id}/label` | Trang in nhãn, không có khung ứng dụng; mã QR trỏ tới `/equipment?id={id}` |
| Sub-Equipment | `/calibration`, `/calibration?id={id}` | `/calibration/{id}` chuyển sang `?id=` |
| Golden | `/golden`, `/golden?id={id}` | `/golden/{id}` chuyển sang `?id=` |
| Configuration | `/configuration/{danh sách}` | Chỉ Admin |
| User Management | `/users`, `/users/{id}` | Chỉ Admin |
| Đổi mật khẩu | `/change-password` | **Bắt buộc** ở lần đăng nhập đầu và sau khi Admin đặt lại mật khẩu (`must_change_password`); chưa đổi thì mọi trang / API khác bị chặn. Người dùng cũng tự đổi bất cứ lúc nào từ menu tài khoản (nhập mật khẩu hiện tại). Không có khung ứng dụng |

Mở một đường dẫn không có quyền → chuyển về Dashboard (`/?denied=1`) và báo "Bạn không có quyền xem trang này". API vẫn tự kiểm tra quyền (trả 403), không dựa vào việc ẩn menu.

---

## 5. Nội dung chung của mọi trang

| Phần | Quy tắc |
| --- | --- |
| Tiêu đề trang | Tên trang, số bản ghi ngay bên dưới |
| Thân trang | Dashboard: các khối số liệu. Các trang còn lại: Masterlist + Detail Modal ([DETAIL_MODEL.md](DETAIL_MODEL.md)) |
| Đang tải / trống / lỗi | Dùng chung một kiểu khung xương, thông báo trống, thông báo lỗi |
| Thông báo kết quả | Lưu / xóa thành công hiện thông báo nhỏ góc màn hình rồi tự tắt. Lỗi hiện ngay tại chỗ thao tác, theo mã lỗi và ngôn ngữ đang chọn (`errorMessage()` — `lib/client/api.ts`); lỗi hệ thống kèm mã yêu cầu để báo Admin |
