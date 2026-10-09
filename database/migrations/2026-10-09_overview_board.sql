-- =============================================================================
-- Migration 2026-10-09 — Overview dạng thẻ: bỏ hai hàm của cây cũ
--
-- Overview đổi từ cây tải từng nhánh sang bảng thẻ theo Location. Hàm mới `overview_board` và `asset_tree` (cây của modal
-- Equipment) nằm trong 04_functions.sql; hai hàm cũ `overview_children` và `overview_unattached_count` không còn trong 04
-- (database dựng mới không có chúng) nhưng `create or replace` không tự xóa chúng khỏi database đang có — file này xóa.
-- App cũ gọi `overview_children` ở cả trang Overview LẪN modal Equipment (chip thiết bị con, tóm tắt hiệu chuẩn).
--
-- THỨ TỰ (chỉ cho database ĐÃ dựng trước ngày này; database dựng mới không cần file này):
--   1. Chạy lại 04_functions.sql — thêm `overview_board` và `asset_tree`. Hai hàm cũ vẫn còn nên app cũ vẫn chạy.
--   2. Triển khai phiên bản app mới (Overview dạng thẻ; modal Equipment lấy con từ `asset_tree`).
--   3. Chạy file này — SAU khi bước 2 xong, vì app cũ gọi hai hàm sẽ bị xóa (Overview và modal Equipment báo lỗi nếu xóa sớm).
--
-- File từ chối chạy (không xóa gì) nếu bước 1 chưa làm. Chạy lại file này cũng an toàn (bỏ qua hàm đã không còn).
-- Không đụng bảng nào, không đổi dữ liệu.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.overview_board(text,text,text)') is null or to_regprocedure('public.asset_tree(text,uuid)') is null then
    raise exception 'Chạy lại 04_functions.sql trước (thiếu overview_board hoặc asset_tree) — chưa xóa gì.';
  end if;
end $$;

drop function if exists public.overview_children(text, uuid);
drop function if exists public.overview_unattached_count();

commit;

-- -----------------------------------------------------------------------------
-- Kiểm tra: old_overview_functions = 0 · overview_board = 1 · asset_tree = 1.
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('overview_children', 'overview_unattached_count')) as old_overview_functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'overview_board') as overview_board,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'asset_tree') as asset_tree
