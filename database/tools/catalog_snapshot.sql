-- Ảnh chụp catalog (CHỈ ĐỌC) của schema public: bảng, ràng buộc, chỉ mục, trigger, hàm (kèm md5 thân hàm), view, policy, quyền, extension,
-- event trigger, bucket. Chạy trong SQL Editor, lấy ô JSON duy nhất. Dùng để so project mới với project cũ (hoặc với bản dựng từ baseline).
select jsonb_build_object(
  'server_version', current_setting('server_version'),
  'extensions', (select jsonb_agg(extname || ' ' || extversion order by extname) from pg_extension),
  'relations', (
    select jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind, 'rls', c.relrowsecurity,
                                        'force_rls', c.relforcerowsecurity, 'options', c.reloptions, 'acl', c.relacl::text)
                     order by c.relname)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S')),
  'constraints', (
    select jsonb_agg(conrelid::regclass::text || ' :: ' || conname || ' :: ' || pg_get_constraintdef(oid)
                     order by conrelid::regclass::text, conname)
    from pg_constraint where connamespace = 'public'::regnamespace),
  'indexes', (
    select jsonb_agg(jsonb_build_object('def', i.indexdef, 'scans', coalesce(s.idx_scan, 0)) order by i.tablename, i.indexname)
    from pg_indexes i
    left join pg_stat_user_indexes s on s.schemaname = i.schemaname and s.indexrelname = i.indexname
    where i.schemaname = 'public'),
  'triggers', (
    select jsonb_agg(jsonb_build_object('table', tgrelid::regclass::text, 'name', tgname, 'enabled', tgenabled,
                                        'def', pg_get_triggerdef(oid)) order by tgrelid::regclass::text, tgname)
    from pg_trigger
    where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)),
  'functions', (
    select jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text, 'returns', pg_get_function_result(p.oid),
                                        'security_definer', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text,
                                        'owner', pg_get_userbyid(p.proowner), 'body_md5', md5(pg_get_functiondef(p.oid)))
                     order by p.oid::regprocedure::text)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'views', (
    select jsonb_agg(jsonb_build_object('name', c.relname, 'definition', pg_get_viewdef(c.oid, true)) order by c.relname)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'),
  'policies', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from pg_policies p where schemaname in ('public', 'storage')),
  'enums', (
    select coalesce(jsonb_agg(t.typname), '[]'::jsonb)
    from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'),
  'event_triggers', (
    select coalesce(jsonb_agg(jsonb_build_object('name', evtname, 'event', evtevent, 'function', evtfoid::regproc::text, 'enabled', evtenabled)), '[]'::jsonb)
    from pg_event_trigger),
  'storage_buckets', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'public', public)), '[]'::jsonb) from storage.buckets),
  'row_counts', (
    select jsonb_object_agg(relname, n_live_tup) from pg_stat_user_tables where schemaname = 'public')
) as live_catalog;
-- pg_cron: if "extensions" above lists pg_cron, also run:  select jobid, schedule, command, active from cron.job;
