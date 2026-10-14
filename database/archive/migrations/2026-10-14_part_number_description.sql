-- =============================================================================
-- Migration 2026-10-14 — Mô tả chuyển từ Type sang Part Number
--
-- Configuration › Part Number có thêm cột Mô tả (`part_numbers.description`); Configuration › Type bỏ cột Mô tả
-- (`types.description`). Dành cho database ĐÃ dựng bằng 02 → 04 trước ngày 14/10/2026 và đang có dữ liệu. Database dựng mới
-- (02 → 04 sau ngày này) đã có sẵn đúng như vậy — không cần chạy file này.
--
-- !! XÓA DỮ LIỆU: bước 2 xóa cột `types.description` cùng mọi mô tả đã nhập ở Type — không khôi phục được sau khi chạy.
-- !! Part number mới có mô tả TRỐNG; mô tả của Type KHÔNG tự chuyển sang part number (hai thứ khác nghĩa).
-- !! Cần giữ mô tả Type thì xuất ra trước (Configuration › Type › Xuất Excel, hoặc chạy backup) rồi mới chạy file này.
--
-- Thứ tự: chạy file này MỘT lần trong Supabase SQL Editor TRƯỚC khi triển khai app mới. Trong lúc database mới còn chạy với
-- app cũ, mô tả nhập ở Type bị bỏ qua (app_write chỉ ghi cột còn tồn tại) — không có lỗi, chỉ không lưu.
-- Không cần chạy lại 04_functions.sql (không hàm nào nhắc tới cột này). Chạy lại chính file này cũng an toàn (bỏ qua phần
-- đã làm). Cả file là một giao dịch: lỗi ở đâu thì không đổi gì cả.
--
-- Lịch sử cấu hình (`configuration_histories`) giữ nguyên: các dòng cũ có `description` của Type vẫn đọc được.
-- =============================================================================

begin;

-- 1. part_numbers.description — mới, trống, không bắt buộc ------------------------------------------------
alter table public.part_numbers add column if not exists description text;
comment on column public.part_numbers.description is 'Mô tả part number (Configuration › Part Number). Không bắt buộc, tối đa 1000 ký tự (app kiểm tra).';

-- 2. types.description — bỏ (XÓA DỮ LIỆU, xem đầu file) ------------------------------------------------------
do $$
declare
  v_count integer;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'types' and column_name = 'description') then
    execute 'select count(*) from public.types where nullif(btrim(description), '''') is not null' into v_count;
    raise notice 'Xóa types.description: % Type đang có mô tả sẽ mất mô tả.', v_count;
    alter table public.types drop column description;
  end if;
end $$;

commit;

-- -----------------------------------------------------------------------------
-- Kiểm tra: part_number_description = 1 và type_description = 0.
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'part_numbers' and column_name = 'description') as part_number_description,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'types' and column_name = 'description') as type_description;
