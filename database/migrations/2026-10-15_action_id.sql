-- =============================================================================
-- Migration 2026-10-15 — action_id: MỘT thao tác của người dùng = MỘT dòng ở "Thay đổi gần đây"
--
-- Mỗi dòng nhật ký (asset_logs, configuration_histories, user_histories) có thêm cột `action_id` (uuid, cho phép null). Mọi dòng
-- do CÙNG MỘT thao tác của người dùng ghi ra (Swap hai thiết bị, Move kèm con cháu, Check-out cả cây, Import, sửa form gồm nhiều bước…)
-- dùng chung một action_id; Dashboard gộp theo id này (view recent_actions, tạo ở 04_functions.sql). Tab Lịch sử của từng bản ghi
-- KHÔNG đổi: vẫn mỗi bản ghi một dòng nhật ký riêng.
--
-- Dành cho database ĐÃ dựng bằng 02 → 04 trước ngày 15/10/2026. Database dựng mới (02 → 04 sau ngày này) đã có sẵn cột — không cần
-- chạy file này.
--
-- THỨ TỰ (quan trọng):
--   1. Chạy file này MỘT lần trong Supabase SQL Editor (chỉ thêm cột + chỉ mục, không đổi hành vi nào).
--   2. Chạy lại 04_functions.sql (chạy lại được; một giao dịch): trigger write_history ghi action_id, các hàm ghi dữ liệu nhận
--      `p_action_id` (chữ ký cũ bị bỏ ngay trong giao dịch đó), thêm view recent_actions.
--   3. Triển khai / khởi động lại app. App tự dò: database chưa có hàm mới / view mới thì app vẫn chạy như cũ (mỗi dòng nhật ký một
--      dòng ở Thay đổi gần đây) cho tới khi bước 1–2 xong.
--
-- Không đổi, không xóa dòng nhật ký nào: cột mới của dòng cũ là null và hiện như một thao tác riêng (riêng import cũ vẫn gộp một dòng
-- như trước). Gộp thêm các thao tác cũ (ví dụ Swap cũ) là bước TÙY CHỌN, file riêng: 2026-10-15_action_id_backfill_OPTIONAL.sql —
-- KHÔNG chạy nếu chưa duyệt. Chạy lại chính file này an toàn.
-- =============================================================================

begin;

alter table public.asset_logs add column if not exists action_id uuid;
alter table public.configuration_histories add column if not exists action_id uuid;
alter table public.user_histories add column if not exists action_id uuid;

create index if not exists asset_logs_action_idx on public.asset_logs (action_id) where action_id is not null;
create index if not exists configuration_histories_action_idx on public.configuration_histories (action_id) where action_id is not null;
create index if not exists user_histories_action_idx on public.user_histories (action_id) where action_id is not null;

comment on column public.asset_logs.action_id is 'Các dòng nhật ký do CÙNG MỘT thao tác của người dùng ghi ra có cùng action_id (app đặt, hoặc hàm database tự sinh một id cho mỗi lần gọi). Null = dòng cũ / ghi từ SQL tay: hiện như một thao tác riêng.';
comment on column public.configuration_histories.action_id is 'Như asset_logs.action_id.';
comment on column public.user_histories.action_id is 'Như asset_logs.action_id.';

commit;

-- -----------------------------------------------------------------------------
-- Kiểm tra (xong rồi chạy lại 04_functions.sql): action_id_columns phải = 3.
-- -----------------------------------------------------------------------------
select count(*) as action_id_columns
from information_schema.columns
where table_schema = 'public' and column_name = 'action_id'
  and table_name in ('asset_logs', 'configuration_histories', 'user_histories');
