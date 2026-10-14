-- =============================================================================
-- verify_new_project.sql — kiểm tra project Supabase MỚI sau khi dựng (baseline + seed + Admin). CHỈ ĐỌC.
--
-- Chạy trong SQL Editor của project mới. Có hai kết quả:
--   Kết quả 1: mỗi dòng một kiểm tra (14 dòng), cột ok phải là true hết.
--   Kết quả 2: số dòng từng bảng so với expected_after_setup — đúng cho project vừa dựng xong, CHƯA có dữ liệu thật.
--              Sau khi nhập dữ liệu thật các bảng dữ liệu tăng lên là bình thường: chỉ đọc kết quả này ngay sau khi dựng hoặc sau reset.
-- =============================================================================

with fn as (
  select p.oid, p.proname from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
), rel as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.reloptions from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
)
select * from (
  select 1 as n, 'tables in public (expected 18)' as check_name, 18::bigint as expected,
         (select count(*) from rel where relkind = 'r') as actual
  union all select 2, 'tables WITHOUT row level security', 0, (select count(*) from rel where relkind = 'r' and not relrowsecurity)
  union all select 3, 'RLS policies (none by design: only the server reads)', 0,
         (select count(*) from pg_policies where schemaname = 'public')
  union all select 4, 'functions in public (expected 54)', 54, (select count(*) from fn)
  union all select 5, 'functions anon/authenticated CAN execute', 0,
         (select count(*) from fn where has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))
  union all select 6, 'functions service_role can NOT execute', 0,
         (select count(*) from fn where not has_function_privilege('service_role', oid, 'EXECUTE'))
  union all select 7, 'tables/views anon or authenticated can read or write', 0,
         (select count(*) from rel where has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE')
                                      or has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE'))
  union all select 8, 'views that are security_invoker (expected 2)', 2,
         (select count(*) from rel where relkind = 'v' and 'security_invoker=true' = any (coalesce(reloptions, '{}')))
  union all select 9, 'views in public (expected 2: recent_actions, sub_equipment_calibration)', 2, (select count(*) from rel where relkind = 'v')
  union all select 10, 'triggers in public (expected 57)', 57,
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid in (select oid from rel))
  union all select 11, 'system types present (Tester, Base, Fixture)', 3,
         (select count(*) from public.types where kind in ('tester', 'base', 'fixture'))
  union all select 12, 'active Admin accounts (expected >= 1)', 1,
         (select least(1, count(*)) from public.user_profiles where role = 'admin' and is_active)
  union all select 13, 'profiles without a matching auth.users row', 0,
         (select count(*) from public.user_profiles p where not exists (select 1 from auth.users u where u.id = p.id))
  union all select 14, 'Admins that can sign in (auth user has a password)', 1,
         (select least(1, count(*)) from public.user_profiles p join auth.users u on u.id = p.id
          where p.role = 'admin' and p.is_active and coalesce(u.encrypted_password, '') <> '')
) checks
cross join lateral (select (case when n in (12, 14) then actual >= expected else actual = expected end) as ok) r
order by n;

-- Kết quả 2 — số dòng từng bảng ngay sau khi dựng (seed.sql + một Admin).
select table_name, expected_after_setup, actual, (actual = expected_after_setup) as ok
from (
select 'user_profiles' as table_name, 1 as expected_after_setup, (select count(*) from public.user_profiles) as actual
union all select 'user_histories', 1, (select count(*) from public.user_histories)
union all select 'departments', 3, (select count(*) from public.departments)
union all select 'type_groups', 4, (select count(*) from public.type_groups)
union all select 'types', 4, (select count(*) from public.types)
union all select 'part_numbers', 4, (select count(*) from public.part_numbers)
union all select 'locations', 4, (select count(*) from public.locations)
union all select 'tags', 4, (select count(*) from public.tags)
union all select 'levels', 9, (select count(*) from public.levels)
union all select 'calibration_configurations', 1, (select count(*) from public.calibration_configurations)
union all select 'calibration_vendors', 1, (select count(*) from public.calibration_vendors)
union all select 'configuration_histories', 0, (select count(*) from public.configuration_histories)
union all select 'equipment', 0, (select count(*) from public.equipment)
union all select 'sub_equipment', 0, (select count(*) from public.sub_equipment)
union all select 'calibrations', 0, (select count(*) from public.calibrations)
union all select 'golden_boards', 0, (select count(*) from public.golden_boards)
union all select 'asset_logs', 0, (select count(*) from public.asset_logs)
union all select 'error_log', 0, (select count(*) from public.error_log)
) counts
order by table_name;
-- user_histories = 1 sau import_admin_to_new.sql (nhật ký "Admin migrated"); = 0 sau reset_after_testing.sql — khi đó dòng này báo ok = false là đúng.
