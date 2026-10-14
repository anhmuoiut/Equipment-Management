-- =============================================================================
-- import_admin_to_new.sql — Bước 2/2 chuyển tài khoản Admin sang project MỚI.
--
-- Chạy trong SQL Editor của project MỚI, SAU migration baseline và seed.sql, và TRƯỚC khi có ai đăng nhập:
--   1. Dán ô JSON lấy từ export_admin_from_old.sql vào giữa hai dấu $export$ … $export$ bên dưới (thay chữ PASTE_THE_JSON_HERE).
--   2. Run. Kết quả cuối là một dòng xác nhận (không có mật khẩu).
--
-- Làm gì: chèn auth.users (cùng id, cùng mật khẩu băm), auth.identities và public.user_profiles của Admin. Chỉ các cột KHÔNG
-- phải cột tự tính (generated) và có ở cả hai phía mới được chép, nên chạy được dù hai project dùng phiên bản Auth khác nhau.
-- created_by / updated_by để trống (người tạo không được chuyển sang); department_id giữ nếu phòng ban có trong seed, không thì để trống.
-- Chạy lại an toàn: đã có thì bỏ qua. KHÔNG chạy `npm run seed:admin` cho project mới khi dùng cách này (trùng email nội bộ).
-- Phiên đăng nhập cũ không chuyển sang: Admin đăng nhập lại một lần.
--
-- !! Đừng lưu file này sau khi đã dán JSON (có mật khẩu băm). Mẫu trong git luôn giữ chữ PASTE_THE_JSON_HERE.
-- =============================================================================

do $import$
declare
  v_text   text  := $export$PASTE_THE_JSON_HERE$export$;
  j        jsonb;
  v_id     uuid;
  v_dept   uuid;
  cols     text;
  ident    jsonb;
begin
  if v_text like 'PASTE_THE_JSON_HERE%' then
    raise exception 'IMPORT_NOT_CONFIGURED: dán JSON từ export_admin_from_old.sql vào giữa hai dấu $export$';
  end if;
  j := v_text::jsonb;
  if j ->> 'format' is distinct from '1' then
    raise exception 'IMPORT_BAD_FORMAT: không phải kết quả của export_admin_from_old.sql';
  end if;
  if coalesce(j -> 'user', 'null'::jsonb) = 'null'::jsonb or coalesce(j -> 'profile', 'null'::jsonb) = 'null'::jsonb then
    raise exception 'IMPORT_NO_ADMIN: bản export không có tài khoản — kiểm tra ADMIN_USERNAME khi chạy export';
  end if;
  if j -> 'profile' ->> 'role' <> 'admin' then
    raise exception 'IMPORT_NOT_ADMIN: tài khoản trong bản export không phải Admin (role = %)', j -> 'profile' ->> 'role';
  end if;
  v_id := (j -> 'user' ->> 'id')::uuid;
  if v_id is distinct from (j -> 'profile' ->> 'id')::uuid then
    raise exception 'IMPORT_MISMATCH: id của auth.users và user_profiles khác nhau';
  end if;

  -- 1. auth.users — cột không tự tính, có trong bản export
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = 'auth' and c.table_name = 'users' and c.is_generated = 'NEVER' and (j -> 'user') ? c.column_name;
  execute format('insert into auth.users (%1$s) select %1$s from jsonb_populate_record(null::auth.users, $1) on conflict (id) do nothing',
                 cols) using j -> 'user';

  -- 2. auth.identities
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = 'auth' and c.table_name = 'identities' and c.is_generated = 'NEVER'
    and exists (select 1 from jsonb_array_elements(j -> 'identities') e where e ? c.column_name);
  for ident in select e from jsonb_array_elements(j -> 'identities') e loop
    execute format('insert into auth.identities (%1$s) select %1$s from jsonb_populate_record(null::auth.identities, $1) on conflict do nothing',
                   cols) using ident;
  end loop;

  -- 3. public.user_profiles (nhật ký ghi "script": Admin được chuyển từ project cũ)
  v_dept := (j -> 'profile' ->> 'department_id')::uuid;
  if v_dept is not null and not exists (select 1 from public.departments where id = v_dept) then v_dept := null; end if;
  perform public.set_ctx('source', 'script');
  perform public.set_ctx('note', 'Admin account migrated from the previous project');
  insert into public.user_profiles
  select * from jsonb_populate_record(null::public.user_profiles,
    (j -> 'profile') || jsonb_build_object('created_by', null, 'updated_by', null, 'department_id', v_dept))
  on conflict (id) do nothing;

  raise notice 'Admin % imported (id %).', j -> 'profile' ->> 'username', v_id;
end
$import$;

-- Xác nhận (không có mật khẩu): phải ra đúng một dòng, role = admin, is_active = true.
select p.username, p.full_name, p.role, p.is_active, p.must_change_password, u.email,
       (u.encrypted_password is not null and u.encrypted_password <> '') as has_password
from public.user_profiles p join auth.users u on u.id = p.id;
