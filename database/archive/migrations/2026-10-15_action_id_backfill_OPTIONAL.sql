-- =============================================================================
-- TÙY CHỌN — CHƯA CHẠY, CHỜ DUYỆT: gộp các thao tác CŨ (trước 15/10/2026) vào cùng một action_id
--
-- Không bắt buộc. Không chạy file này thì các dòng nhật ký cũ vẫn hiện như từng thao tác riêng ở "Thay đổi gần đây" (import cũ
-- vẫn gộp một dòng), mọi thứ mới từ giờ đã gộp đúng.
--
-- QUY TẮC (đơn giản và an toàn): các dòng nhật ký CHƯA có action_id, cùng người thao tác, cùng nguồn (source) và cùng created_at
-- CHÍNH XÁC (tới micro giây) là các dòng của CÙNG MỘT giao dịch — ví dụ hai dòng SWAP của một lần Swap, hoặc một thiết bị cùng
-- các con cháu đi theo trong một lần Move / Check-out. Mỗi giao dịch của database chỉ có một created_at, nên hai thao tác khác nhau
-- gần như không bao giờ trùng tới micro giây.
-- KHÔNG dùng cửa sổ "trong vòng 2 giây": sửa form gồm nhiều bước (nhiều giao dịch liên tiếp) cách nhau vài chục ms, nhưng cũng có
-- thể trộn nhầm hai thao tác liền nhau của cùng người — không an toàn bằng quy tắc trên. Sửa form nhiều bước CŨ vì vậy vẫn là
-- nhiều dòng; từ giờ chúng đã gộp.
--
-- !! File này SỬA dòng nhật ký (chỉ ghi thêm cột action_id, không đụng nội dung nào) nên phải tạm tắt trigger append-only
-- !! (prevent_history_change) của từng bảng, rồi bật lại — trong CÙNG MỘT giao dịch: lỗi ở đâu thì không đổi gì.
-- !! Chạy bằng tài khoản chủ bảng (Supabase SQL Editor là postgres). Cần chạy 2026-10-15_action_id.sql trước.
--
-- BƯỚC A — XEM TRƯỚC (chỉ đọc, chạy riêng, bao nhiêu thao tác / dòng sẽ được gộp):
-- =============================================================================
select count(*) as operations_to_merge, coalesce(sum(n), 0) as log_rows_affected
from (
  select count(*) as n
  from public.asset_logs
  where action_id is null
  group by user_id, source, created_at
  having count(*) > 1
) g;

-- Mẫu: 20 thao tác nhiều dòng gần nhất sẽ được gộp (kiểm tra bằng mắt rằng đúng là Swap / Move / Check-out…).
select created_at, user_id, source, count(*) as log_rows, array_agg(distinct action) as actions, array_agg(label order by label) as labels
from public.asset_logs
where action_id is null
group by user_id, source, created_at
having count(*) > 1
order by created_at desc
limit 20;

-- =============================================================================
-- BƯỚC B — GỘP (chỉ chạy sau khi duyệt bước A). asset_logs là bảng duy nhất có thao tác nhiều dòng trong một giao dịch
-- (configuration_histories / user_histories mỗi thao tác một dòng) nên chỉ cần bảng này.
-- =============================================================================
begin;

alter table public.asset_logs disable trigger asset_logs_append_only;

with ops as (
  select user_id, source, created_at, gen_random_uuid() as new_action_id
  from public.asset_logs
  where action_id is null
  group by user_id, source, created_at
  having count(*) > 1
)
update public.asset_logs l
set action_id = ops.new_action_id
from ops
where l.action_id is null
  and l.user_id is not distinct from ops.user_id
  and l.source = ops.source
  and l.created_at = ops.created_at;

alter table public.asset_logs enable trigger asset_logs_append_only;

commit;

-- Kiểm tra: trigger append-only phải đang bật (tgenabled = 'O') và không còn thao tác nhiều dòng chưa có action_id.
select (select tgenabled from pg_trigger where tgname = 'asset_logs_append_only') as append_only_trigger_enabled,
       (select count(*) from (select 1 from public.asset_logs where action_id is null
                              group by user_id, source, created_at having count(*) > 1) x) as multi_row_operations_left;
