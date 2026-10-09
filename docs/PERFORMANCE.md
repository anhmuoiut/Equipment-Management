# Hiệu năng

Ghi lại **vì sao** ứng dụng chậm, đã sửa gì, quy tắc để không chậm lại, và số đo trước / sau. Đổi một trong các cơ chế dưới đây thì sửa tài liệu này cùng lúc.

## 1. Điều quyết định tốc độ: số vòng mạng

Mọi thao tác của người dùng đi qua server Next.js rồi tới Supabase. Đo từ máy phát triển (qua proxy công ty): **một vòng mạng tới Supabase ≈ 0,25 s**. Dữ liệu còn ít nên thời gian gần như hoàn toàn là *số vòng mạng đi tuần tự*, không phải số dòng. Vì vậy:

- Truy vấn **song song** gần như miễn phí; truy vấn **nối đuôi nhau** thì cộng dồn (≈ 0,25 s mỗi bước).
- Một request API gồm: xác thực → (các truy vấn dữ liệu). Giảm số bước tuần tự là cách làm nhanh nhất.

Trước khi tối ưu, một request API thường mất **1,2–1,8 s** (xác thực ~0,5 s + dịch vụ 0,7–1,3 s, riêng đọc một thiết bị đã là 14 request HTTP tới Supabase).

## 2. Phía server

### 2.1 Xác thực: `lib/auth/session.ts` (`getCaller`)

`withAuth` (API) và `requirePageViewer` (trang) dùng **chung một hàm**. Hai việc — hỏi Supabase "token này của ai" (`getUser`) và đọc hồ sơ trong `user_profiles` — chạy **song song** thay vì lần lượt (509 → 255 ms).

Id để đọc hồ sơ sớm lấy từ token trong cookie **chưa xác thực**. Kết quả đó chỉ được dùng khi `getUser` xác nhận đúng id ấy; token giả, id lạ, cookie hỏng → bị bỏ và request bị từ chối như cũ (`session.test.ts` kiểm tra từng trường hợp). **Bảo mật không đổi**: vẫn hỏi Supabase thật ở MỌI request và vẫn kiểm tra `is_active` / role ở MỌI request.

### 2.2 Middleware: `middleware.ts`

Middleware chạy ở **mọi lần chuyển trang**. `getUser()` là một vòng mạng, nên chỉ còn dùng ở `/login` (phiên hỏng phải coi như chưa đăng nhập, nếu không `/login ↔ /` quay vòng) và trang nhãn `…/label` (không có layout kiểm tra phiên). Các trang còn lại dùng `getSession()` (đọc cookie, chỉ gọi mạng khi cần làm mới token hết hạn) vì phía sau đã có `requirePageViewer` hỏi Supabase thật; dữ liệu thì luôn đi qua `withAuth`. Trang nào được thêm NGOÀI layout `(app)` mà không tự gọi `requirePageViewer` thì phải đưa vào điều kiện `verifyHere` của middleware.

### 2.3 Dữ liệu gốc dùng chung được nhớ: `lib/services/core/lookupCache.ts`

Trước đây **mỗi** request đọc lại 9 bảng (Part Number, Location, Type, Group, Level, Department, Vendor, Tag, tên người dùng) chỉ để đổi id → chữ — kể cả khi chỉ đọc một thiết bị. Nay `loadLookups()` nhớ kết quả trong tiến trình:

- Nhiều request cùng lúc dùng chung **một** lần đọc.
- Hết hạn sau **60 giây**: sửa dữ liệu gốc từ bên ngoài ứng dụng (SQL editor, script) hiện ra chậm nhất 60 giây.
- Mọi lần ghi của ứng dụng đi qua `appWrite` (`db.ts`) → gọi `invalidateLookups()` ngay (cả khi ghi lỗi). Một lần đọc đã bắt đầu **trước** lần ghi không bao giờ được giữ lại cho request sau.
- **Quy tắc**: các `Map` trả về dùng chung cho mọi request — **chỉ đọc**, không `set` / `delete`. Thêm một bảng vào `readLookups()` thì thêm tên bảng vào `LOOKUP_TABLES`.
- Nhiều instance server: mỗi instance có bộ nhớ riêng; ghi ở instance này, instance kia thấy sau tối đa 60 giây. Kiểm tra giá trị chọn (`assertActive`) vì vậy có thể trễ tối đa 60 giây với thay đổi đến từ instance khác (database không ép `is_active`, đây chỉ là kiểm tra mềm của ứng dụng).

`withActorNames` (tên người thao tác ở tab Lịch sử) dùng lại chính dữ liệu này thay vì đọc thêm `user_profiles`.

### 2.4 Truy vấn nhúng thay cho truy vấn nối đuôi

PostgREST cho gửi quan hệ trong **cùng** một truy vấn. Dùng ở:

| Chỗ | Trước | Nay |
|---|---|---|
| `getEquipment` | đọc dòng + 3 truy vấn đếm con + đọc cha (14 request) | **1 request**: `parent:parent_id(serial_number)` + `kids:equipment!parent_id(count)` + `subs:sub_equipment!tester_id(count)` + `golds:golden_boards!parent_id(count)` |
| `listSubEquipment`, `getSubEquipment`, `dashboard` | đọc danh sách rồi đọc tester | `tester:tester_id(serial_number)` trong cùng truy vấn |
| `listGolden`, `getGolden` | đọc danh sách rồi đọc cha | `parent:parent_id(serial_number)` |
| `listEquipment` | đọc `equipment` hai lần (danh sách + cờ "có con") | cờ "có con" tính từ chính danh sách; chỉ đọc thêm `sub_equipment` / `golden_boards` (cột cha) |
| `equipmentTree` | đi lên từng cấp cha | tổ tiên tối đa 4 cấp trong 1 truy vấn (cây thật chỉ có Tester ⊃ Base ⊃ Fixture); sâu hơn thì đi tiếp từng cấp |

Khi thêm dịch vụ mới: nếu cần "tên / serial của bản ghi liên quan" thì **nhúng** vào truy vấn chính, đừng đọc thêm sau khi có kết quả.

`selectAll` đọc trang đầu kèm tổng số dòng rồi tải các trang còn lại **song song** (bảng > 1000 dòng không còn mất một vòng mạng mỗi trang).

### 2.5 Giữ kết nối mở: `instrumentation.ts` → `lib/server/connections.ts`

Mặc định Node đóng kết nối rảnh sau ~4 s, nên người dùng dừng vài giây là request kế tiếp phải bắt tay TLS lại (qua proxy công ty ≈ +0,35 s **mỗi** kết nối, mà một request mở vài kết nối song song). Server đặt `undici` (bộ máy bên dưới `fetch` của Node) giữ kết nối rảnh **30 s**. `undici` là dependency trực tiếp, chạy từ `node_modules` (`serverExternalPackages` trong `next.config.mjs`). `instrumentation.ts` phải giữ đúng dạng `if (process.env.NEXT_RUNTIME === 'nodejs') { await import(…) }` — dạng khác làm bản Edge của middleware cố đóng gói `undici` và build lỗi.

Đổi file instrumentation thì phải **khởi động lại** `npm run dev`.

## 3. Phía trình duyệt

- **GET trùng nhau dùng chung một request** (`lib/client/api.ts`): React StrictMode ở dev chạy mọi effect hai lần, nhiều vùng màn hình có thể cùng mở một URL. Chỉ nhập vào request bắt đầu **sau** lần ghi gần nhất — sau khi lưu, GET mới luôn lấy dữ liệu mới.
- **Danh sách được nhớ khi quay lại trang** (`lib/client/cache.ts`, `useFetch(url, { cache: true })`, dùng bởi `useList`): quay lại một module thì hiện ngay danh sách lần trước trong lúc tải bản mới. Chỉ ở bộ nhớ của tab, **xóa khi đăng nhập / đăng xuất** (đăng xuất → đăng nhập tài khoản khác là chuyển trang mềm). Không dùng cho một bản ghi: chi tiết luôn phải là dữ liệu vừa tải.
- **Mở một dòng hiện ngay** (`ModuleWorkspace`): modal hiện bằng dòng của danh sách (cùng dạng dữ liệu với chi tiết — các dịch vụ dùng chung một `toRow`), rồi thay bằng bản vừa tải. Tải lỗi thì hiện lỗi như cũ, không để lại dữ liệu cũ trên màn hình.
- **Masterlist** (`components/ui/masterlist/Masterlist.tsx`): ô tìm kiếm cập nhật ngay còn lọc + vẽ lại chạy sau (`useDeferredValue`); chữ để tìm của mỗi dòng tính **một** lần cho mỗi lần dữ liệu đổi (không phải mỗi lần gõ phím); mỗi dòng là component `memo` nên mở modal / đổi dòng chọn chỉ vẽ lại dòng thật sự đổi; khóa sắp xếp tính một lần cho mỗi dòng; tùy chọn cột không tạo mảng mới khi nội dung giống hệt.
- `formatTime` / `formatDate` dùng chung một `Intl.DateTimeFormat` (dựng có múi giờ rất tốn).
- `app/(app)/loading.tsx`: chuyển trang trong ứng dụng hiện khung chờ ngay (thanh trên + menu giữ nguyên) thay vì đứng yên tới khi server trả lời.
- Font IBM Plex nạp bằng script trong `<head>` (`app/layout.tsx`) thay vì `<link rel="stylesheet">`: stylesheet trong HTML **chặn vẽ trang** tới khi `fonts.googleapis.com` trả lời (0,3–0,8 s mỗi lần mở trang đo được, lâu hơn nhiều nếu mạng công ty chậm hoặc chặn).
- Đã bỏ CSS không còn dùng (thông báo, đăng ký, bộ chọn Usage cũ, `.eyebrow`, `.dp-preview`, `.grid-cols-2`) và 54 khóa i18n mồ côi. Khóa số nhiều (`_one` / `_other`) do i18next tự chọn theo `count` — **đừng** xóa dù tìm không thấy tên khóa đầy đủ trong code.

## 4. Số đo

Máy phát triển, Supabase thật, mỗi số là trung vị. Đo lại bằng `npm run bench` (chỉ đọc, `scripts/bench-services.ts`).

**Server** (một vòng mạng ≈ 0,25 s):

| | Trước | Sau |
|---|---|---|
| Xác thực của một request (`getUser` + hồ sơ) | 509–536 ms | **255–260 ms** |
| `GET /api/equipment/:id` | 14 HTTP, 0,7–1,3 s | **1 HTTP, ≈ 0,25 s** |
| `GET /api/equipment`, `/calibration`, `/golden` | 13 HTTP, ≈ 0,67 s | **1–3 HTTP, ≈ 0,25 s** |
| `GET /api/options` | 9 HTTP, 0,3–0,67 s | **0 HTTP** (nhớ) |
| Một request API điển hình (xác thực + dịch vụ) | 1,2–1,8 s | **≈ 0,5 s** |
| 3 truy vấn song song sau 6–15 s rảnh (server thật) | 441 ms | **281 ms** |
| Mỗi chuyển trang trong ứng dụng | +≈ 0,27 s (middleware `getUser`) | 0 |

**Trình duyệt** (bản build production, 3000 dòng, mỗi request 300 ms, CPU chậm ×4, 5 lần):

| | Trước | Sau |
|---|---|---|
| Bấm dòng → modal hiện bản ghi | 399 ms (chờ server) | **206 ms** (không chờ) |
| Công sức luồng chính để mở một dòng | 533 ms | **358 ms** |
| Gõ tìm: phím chậm nhất → vẽ xong | 545 ms | **141 ms** |
| Gõ tìm: phím trung vị → vẽ xong | 226 ms | **46 ms** |
| Gõ tìm: khối chặn luồng chính dài nhất | 289 ms | **101 ms** |
| Quay lại danh sách đã xem | 524 ms | **~0 ms** |
| Tải danh sách lần đầu | 774 ms | 761 ms (không đổi) |

Kích thước JS không đổi đáng kể (chung 102 kB, mỗi trang 135–158 kB) — nút thắt không nằm ở bundle.

## 5. Còn lại, nên làm

- **Đặt dự án ngoài OneDrive** (ví dụ `C:\dev\equipment-management`; git đã là bản sao lưu). OneDrive đồng bộ cả `node_modules` và `.next` làm chậm biên dịch, và đã gây lỗi `ENOENT … rename '….next\cache\webpack\…\4.pack.gz_'` (cache webpack không ghi được). Đường dẫn ngắn cũng tránh giới hạn 260 ký tự của Windows (Turbopack ghi tên file rất dài; ở đường dẫn hiện tại nó có thể lỗi).
- `backups/` nặng ~493 MB (chủ yếu `next-cache-recovery`, là cache build cũ) nằm trong OneDrive; đã `.gitignore`, `tsconfig` đã loại trừ. Nên chuyển ra ngoài hoặc xóa phần cache.
- Đánh giá tốc độ thật bằng `npm run build` rồi `npm run start`, không phải `npm run dev` (dev biên dịch từng trang ở lần mở đầu: 1–9 s mỗi trang).
- Khi dữ liệu lớn (hàng chục nghìn dòng): Dashboard hiện đọc cả ba bảng để đếm — nên đếm bằng hàm / view trong database; `recent_activities` gộp ba bảng nhật ký (CTE dùng hai lần nên bị materialize) — nên thêm giới hạn thời gian; danh sách Masterlist tải hết rồi lọc ở client (đủ cho 1.000–2.000 thiết bị), quá vài chục nghìn thì cần phân trang phía server. Overview `search` đọc cả bảng `equipment` mỗi lần tìm (đã debounce 300 ms).
- Triển khai gần Supabase (cùng region) là cách giảm vòng mạng rẻ nhất: 0,25 s mỗi vòng ở máy này chủ yếu là khoảng cách + proxy.
