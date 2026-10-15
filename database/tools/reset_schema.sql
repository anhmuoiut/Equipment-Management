-- =============================================================================
-- reset_schema.sql — XÓA SẠCH toàn bộ schema `public` (bảng, view, hàm, trigger, chỉ mục) và MỌI DỮ LIỆU trong đó.
--
-- Dùng khi cần dựng lại project MỚI / project thử từ đầu (ví dụ chạy baseline dở dang, hoặc baseline báo "already exists").
-- Chạy trong SQL Editor của project MỚI rồi chạy lại theo thứ tự: mọi file trong database/migrations (theo tên file) → seed.sql → import_admin_to_new.sql.
--
--   1. Đổi 'NO' (một chỗ, ngay bên dưới) thành 'WIPE'.
--   2. Run. Cả file là một giao dịch: lỗi ở đâu thì không đổi gì cả.
--
-- XÓA:  mọi bảng / view / hàm của schema public, kèm toàn bộ dữ liệu (thiết bị, nhật ký, tài khoản trong user_profiles…).
-- GIỮ:  người dùng Supabase Auth (auth.users — import_admin_to_new.sql chạy lại được), extension và các schema của Supabase.
--       Muốn xóa luôn người dùng Auth: chạy thêm `delete from auth.users;`.
--
-- KHÔNG BAO GIỜ chạy trên project đang dùng thật (production) hay project CŨ. Xem tên project ở góc trên bên trái trước khi bấm Run.
-- =============================================================================

begin;

do $$
declare
  v_confirm text := 'NO';  -- >>> ĐỔI Ở ĐÂY: 'NO' -> 'WIPE'
  r record;
begin
  if v_confirm <> 'WIPE' then
    raise exception 'RESET_NOT_CONFIRMED: đổi ''NO'' thành ''WIPE'' để xác nhận xóa schema public — chưa xóa gì';
  end if;

  for r in select viewname as n from pg_views where schemaname = 'public' loop
    execute format('drop view if exists public.%I cascade', r.n);
  end loop;

  for r in select tablename as n from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.n);
  end loop;

  for r in select p.oid::regprocedure::text as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end
$$;

commit;

-- Kiểm tra: cả ba số phải bằng 0.
select
  (select count(*) from pg_tables where schemaname = 'public') as tables,
  (select count(*) from pg_views where schemaname = 'public') as views,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as functions;
