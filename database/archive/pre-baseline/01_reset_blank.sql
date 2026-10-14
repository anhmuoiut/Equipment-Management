-- =============================================================================
-- 01_reset_blank.sql — XÓA SẠCH database (schema public) về trống.
--
-- Chạy trong Supabase SQL Editor: dán cả file → Run.
-- Xóa MỌI bảng, view, function, sequence, type trong schema public — kể cả
-- toàn bộ dữ liệu. KHÔNG hoàn tác được. Không đụng tới schema của Supabase
-- (auth, storage, extensions…).
--
-- Chạy xong thì chạy tiếp 02_schema.sql. Xem database/README.md.
-- =============================================================================

begin;

do $$
declare
  r record;
begin
  -- 1. View / materialized view
  for r in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop %s if exists public.%I cascade',
      case r.relkind when 'v' then 'view' else 'materialized view' end, r.relname);
  end loop;

  -- 2. Bảng
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop table if exists public.%I cascade', r.relname);
  end loop;

  -- 3. Sequence còn sót
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop sequence if exists public.%I cascade', r.relname);
  end loop;

  -- 4. Function / procedure / aggregate
  for r in
    select p.oid::regprocedure as signature, p.prokind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop %s if exists %s cascade',
      case r.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end,
      r.signature);
  end loop;

  -- 5. Type / domain tự tạo (enum, domain, composite, range)
  for r in
    select t.typname, t.typtype
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype in ('e', 'd', 'c', 'r')
      and (t.typtype <> 'c' or exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c'))
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('drop %s if exists public.%I cascade',
      case r.typtype when 'd' then 'domain' else 'type' end, r.typname);
  end loop;
end
$$;

commit;

-- -----------------------------------------------------------------------------
-- TÙY CHỌN — xóa luôn tài khoản Supabase Auth (email + mật khẩu).
-- Mặc định KHÔNG chạy. Chỉ bỏ comment khi Supabase project này chỉ dùng cho
-- Equipment Management. Không xóa thì tài khoản cũ vẫn còn trong Auth nhưng
-- không đăng nhập được vào app (không có dòng user_profiles).
-- -----------------------------------------------------------------------------
-- delete from auth.users;

-- -----------------------------------------------------------------------------
-- Kiểm tra: kết quả phải là 0 dòng.
-- -----------------------------------------------------------------------------
select c.relkind, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'S')
  and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
