-- =============================================================================
-- reset_after_testing.sql — XÓA SẠCH dữ liệu thử, GIỮ tài khoản Admin và các danh sách đã seed.
-- (File này được sinh từ reset_after_testing.template.sql + seed.sql bằng `node database/tools/build-reset.mjs` — đừng sửa tay.)
--
-- Dùng sau khi test project MỚI (preview) và TRƯỚC khi đưa vào dùng thật. Chạy trong SQL Editor của project MỚI.
--   1. Đổi 'ADMIN_USERNAME' (một chỗ, ngay bên dưới) thành username Admin cần giữ.
--   2. Run. Cả file là một giao dịch: lỗi ở đâu thì không đổi gì cả.
--
-- XÓA HẾT: mọi thiết bị (Equipment / Sub-equipment / Golden), lần hiệu chuẩn, mọi nhật ký (asset_logs, configuration_histories,
--          user_histories, error_log), mọi tài khoản trừ Admin (cả dòng đăng nhập Supabase Auth và phiên đăng nhập của họ).
-- LÀM LẠI: các danh sách Configuration đúng như seed.sql (sửa / thêm / ẩn trong lúc test đều bị hoàn lại).
-- GIỮ:     tài khoản Admin (cùng id, mật khẩu, quyền) — vẫn đăng nhập được.
--
-- KHÔNG BAO GIỜ chạy trên project đang có dữ liệu thật. File dừng lại nếu không tìm thấy Admin.
-- =============================================================================

begin;

-- >>> ĐỔI Ở ĐÂY: username của Admin được giữ lại.
create temp table _reset_params on commit drop as select 'ADMIN_USERNAME'::text as admin_username;

do $$
declare
  v_name text := (select admin_username from _reset_params);
begin
  if v_name = 'ADMIN_USERNAME' then
    raise exception 'RESET_NOT_CONFIGURED: đổi ADMIN_USERNAME thành username Admin cần giữ';
  end if;
  if not exists (select 1 from public.user_profiles p join auth.users u on u.id = p.id
                 where p.username = v_name and p.role = 'admin' and p.is_active) then
    raise exception 'RESET_ADMIN_NOT_FOUND: không có Admin đang hoạt động tên "%" — chưa xóa gì', v_name;
  end if;
end
$$;

-- Giữ lại bản sao hồ sơ Admin (người tạo / người sửa không còn nên để trống).
create temp table _keep_admin on commit drop as
  select * from public.user_profiles where username = (select admin_username from _reset_params);
update _keep_admin set created_by = null, updated_by = null;

-- 1. Xóa mọi dòng của mọi bảng trong public. TRUNCATE không chạy trigger từng dòng, nên bảng nhật ký (chỉ thêm) cũng xóa được
--    và việc xóa không tự ghi thêm nhật ký. Liệt kê đủ 18 bảng trong MỘT lệnh vì chúng tham chiếu lẫn nhau.
truncate table
  public.asset_logs, public.calibrations, public.golden_boards, public.sub_equipment, public.equipment,
  public.calibration_configurations, public.part_numbers, public.types, public.type_groups, public.tags,
  public.levels, public.locations, public.calibration_vendors, public.departments,
  public.configuration_histories, public.user_histories, public.error_log, public.user_profiles;

-- 2. Mọi người dùng Supabase Auth trừ Admin (identities, sessions, refresh tokens xóa theo).
delete from auth.users where id <> (select id from _keep_admin);

-- 3. Danh sách Configuration như seed.sql.
-- @@SEED@@

-- 4. Hồ sơ Admin trở lại (phòng ban đã có lại ở bước 3). Tắt ghi nhật ký của bảng này trong lúc chèn: nhật ký không được phụ thuộc
--    vào "người thao tác" còn sót lại trong phiên làm việc (người đó có thể vừa bị xóa ở bước 2).
alter table public.user_profiles disable trigger user_profiles_write_history;
insert into public.user_profiles select * from _keep_admin;
alter table public.user_profiles enable trigger user_profiles_write_history;

-- 5. Xóa mọi nhật ký còn sót để nhật ký trống hẳn.
truncate table public.asset_logs, public.configuration_histories, public.user_histories, public.error_log;

commit;

-- Kiểm tra nhanh: users = 1 · auth_users = 1 · mọi bảng dữ liệu = 0 · các danh sách bằng seed.sql.
select
  (select count(*) from public.user_profiles) as users,
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.equipment) + (select count(*) from public.sub_equipment) + (select count(*) from public.golden_boards)
    + (select count(*) from public.calibrations) as assets_and_calibrations,
  (select count(*) from public.asset_logs) + (select count(*) from public.configuration_histories)
    + (select count(*) from public.user_histories) + (select count(*) from public.error_log) as log_rows,
  (select count(*) from public.locations) as locations,
  (select count(*) from public.part_numbers) as part_numbers,
  (select count(*) from public.types) as types,
  (select count(*) from public.tags) as tags;
