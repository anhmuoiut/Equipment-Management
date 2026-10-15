-- =============================================================================
-- reset_after_testing.sql — XÓA SẠCH dữ liệu thử, GIỮ tài khoản Admin và các dòng hệ thống.
--
-- Dùng sau khi test project MỚI (preview) và TRƯỚC khi đưa vào dùng thật. Chạy trong SQL Editor của project MỚI.
--   1. Đổi 'ADMIN_USERNAME' (một chỗ, ngay bên dưới) thành username Admin cần giữ.
--   2. Run. Cả file là một giao dịch: lỗi ở đâu thì không đổi gì cả.
--
-- XÓA HẾT: mọi thiết bị (Equipment / Sub-equipment / Golden), lần hiệu chuẩn, mọi nhật ký (asset_logs, configuration_histories,
--          user_histories, error_log), mọi tài khoản trừ Admin (cả dòng đăng nhập Supabase Auth và phiên đăng nhập của họ).
-- LÀM LẠI: chỉ các dòng hệ thống của seed.sql (3 loại Tester / Base / Fixture và 4 nhóm). MỌI danh sách Configuration khác
--          (Location, Level, Department, Tag, Vendor, Part number, Type sub-equipment, Setup hiệu chuẩn) bị xóa hết:
--          nhập Configuration thật SAU khi chạy file này. Phòng ban của Admin cũng để trống (chọn lại ở Users).
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

-- Giữ lại bản sao hồ sơ Admin (người tạo / người sửa / phòng ban không còn nên để trống).
create temp table _keep_admin on commit drop as
  select * from public.user_profiles where username = (select admin_username from _reset_params);
update _keep_admin set created_by = null, updated_by = null, department_id = null;

-- 1. Xóa mọi dòng của mọi bảng trong public. TRUNCATE không chạy trigger từng dòng, nên bảng nhật ký (chỉ thêm) cũng xóa được
--    và việc xóa không tự ghi thêm nhật ký. Liệt kê đủ 18 bảng trong MỘT lệnh vì chúng tham chiếu lẫn nhau.
truncate table
  public.asset_logs, public.calibrations, public.golden_boards, public.sub_equipment, public.equipment,
  public.calibration_configurations, public.part_numbers, public.types, public.type_groups, public.tags,
  public.levels, public.locations, public.calibration_vendors, public.departments,
  public.configuration_histories, public.user_histories, public.error_log, public.user_profiles;

-- 2. Mọi người dùng Supabase Auth trừ Admin (identities, sessions, refresh tokens xóa theo).
delete from auth.users where id <> (select id from _keep_admin);

-- 3. Dòng hệ thống như seed.sql.
-- Không ghi nhật ký cho dữ liệu có sẵn.
alter table public.type_groups disable trigger type_groups_write_history;
alter table public.types disable trigger types_write_history;

-- -----------------------------------------------------------------------------
-- DÒNG HỆ THỐNG (bắt buộc)
-- -----------------------------------------------------------------------------

-- type_groups
insert into public.type_groups (id, display_name, kind, sort_order, is_active) values
  ('649e189b-d55f-434c-87e2-374fd3525c14', 'Tester', 'tester', 1, true),
  ('e4b6f679-e7af-42f6-9be2-6399e594430f', 'Base', 'base', 2, true),
  ('a9a8840b-95b5-4706-8dde-785b267edcaa', 'Fixture', 'fixture', 3, true),
  ('2f2b0f0e-baa9-4a15-98bc-a27f4fd96901', 'Sub-equipment', 'sub_equipment', 4, true)
on conflict do nothing;

-- types
insert into public.types (id, display_name, kind, group_id, sort_order, is_active) values
  ('5f325a3d-3870-43b4-95e7-3f6fad6cedc4', 'Tester', 'tester', '649e189b-d55f-434c-87e2-374fd3525c14', 1, true),
  ('88e47919-74ad-4a11-92ec-282836b28ae3', 'Base', 'base', 'e4b6f679-e7af-42f6-9be2-6399e594430f', 2, true),
  ('c56359d1-16fd-4208-b8a6-4b263bc6d837', 'Fixture', 'fixture', 'a9a8840b-95b5-4706-8dde-785b267edcaa', 3, true)
on conflict do nothing;

alter table public.type_groups enable trigger type_groups_write_history;
alter table public.types enable trigger types_write_history;

-- 4. Hồ sơ Admin trở lại. Tắt ghi nhật ký của bảng này trong lúc chèn: nhật ký không được phụ thuộc
--    vào "người thao tác" còn sót lại trong phiên làm việc (người đó có thể vừa bị xóa ở bước 2).
alter table public.user_profiles disable trigger user_profiles_write_history;
insert into public.user_profiles select * from _keep_admin;
alter table public.user_profiles enable trigger user_profiles_write_history;

-- 5. Xóa mọi nhật ký còn sót để nhật ký trống hẳn.
truncate table public.asset_logs, public.configuration_histories, public.user_histories, public.error_log;

commit;

-- Kiểm tra nhanh: users = 1 · auth_users = 1 · mọi bảng dữ liệu = 0 · types = 3 (hệ thống) · locations / part_numbers / tags = 0.
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
