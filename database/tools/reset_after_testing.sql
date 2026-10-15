-- =============================================================================
-- reset_after_testing.sql — XÓA SẠCH dữ liệu thử, GIỮ tài khoản Admin và các danh sách đã seed.
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
-- Không ghi nhật ký cho dữ liệu có sẵn.
alter table public.type_groups disable trigger type_groups_write_history;
alter table public.types disable trigger types_write_history;
alter table public.levels disable trigger levels_write_history;
alter table public.departments disable trigger departments_write_history;
alter table public.locations disable trigger locations_write_history;
alter table public.tags disable trigger tags_write_history;
alter table public.calibration_vendors disable trigger calibration_vendors_write_history;
alter table public.part_numbers disable trigger part_numbers_write_history;
alter table public.calibration_configurations disable trigger calibration_configurations_write_history;

-- -----------------------------------------------------------------------------
-- 1. DÒNG HỆ THỐNG (bắt buộc)
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
  ('5f325a3d-3870-43b4-95e7-3f6fad6cedc4', 'Station', 'tester', '649e189b-d55f-434c-87e2-374fd3525c14', 1, true),
  ('88e47919-74ad-4a11-92ec-282836b28ae3', 'Base', 'base', 'e4b6f679-e7af-42f6-9be2-6399e594430f', 2, true),
  ('c56359d1-16fd-4208-b8a6-4b263bc6d837', 'Fixture', 'fixture', 'a9a8840b-95b5-4706-8dde-785b267edcaa', 3, true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. DANH SÁCH CONFIGURATION CỦA SITE NÀY
-- -----------------------------------------------------------------------------

-- types
insert into public.types (id, display_name, kind, group_id, sort_order, is_active) values
  ('8d5d2f0b-c8a4-4ba8-b0ae-050fe9428f74', 'Device', 'sub_equipment', '2f2b0f0e-baa9-4a15-98bc-a27f4fd96901', 0, true)
on conflict do nothing;

-- levels
insert into public.levels (id, display_name, sort_order, is_active) values
  ('a1deaeef-b5d5-4a89-83d1-525228c2a410', 'F3 - TE Tooling Room', 0, true),
  ('e57dbbca-34eb-4b70-b7b1-054b758ac9ec', 'ICT', 1, true),
  ('2e88e5c1-ab44-48f3-97ac-7bcab14a3d77', 'Programming', 2, true),
  ('3870f90d-1f5b-4392-9db8-500e7f2d85a2', 'Final Test', 3, true),
  ('a7d0f223-7820-45dc-9cf3-5627cf1cbdc3', 'Unified FT', 3, true),
  ('a1a77967-9801-42ec-8816-7a1038533d0c', 'AOI', 4, true),
  ('832bae57-7756-4f62-8f63-e653f3df0983', 'Debug Area', 5, true),
  ('a43fc1b8-529f-4748-814d-1c7151aa24a2', 'F4 - TE Tooling room', 6, true),
  ('f92a7c59-7e74-4641-8ad6-bd637aa11bc0', 'F5 - TE Tooling room', 7, true)
on conflict do nothing;

-- departments
insert into public.departments (id, display_name, sort_order, is_active) values
  ('ac03503b-16ef-461a-8422-d64792f7b436', 'QE', 0, true),
  ('a983d923-6544-4fab-81f4-caa969432b4b', 'TE', 1, true),
  ('b96b9a10-467a-4e4f-a186-8dc08ed35a46', 'ME', 2, true)
on conflict do nothing;

-- locations
insert into public.locations (id, display_name, sort_order, is_active) values
  ('a15fb042-b330-47ef-af2e-5e82b01d781e', 'B3F5 - Bay 8B', 0, true),
  ('2b2ddeb8-c3c4-4ec2-861a-54571a9723e1', 'B3F5 - Bay 8A', 1, true),
  ('8bff57b0-ec2e-481f-ac1d-383ea9a41aab', 'B3F5 - Bay 9A', 2, true),
  ('9f95cc7e-e7ba-4c9c-a9ab-b431a802cd6d', 'B3F5 - Bay 9B', 3, true)
on conflict do nothing;

-- tags
insert into public.tags (id, display_name, sort_order, color) values
  ('62b37cd5-6ddc-41ff-95cf-790150ac0a2b', 'Normal', 0, 'green'),
  ('0acee561-4d9e-444a-adac-6e4028694255', 'Upcoming receive', 0, 'blue'),
  ('9d41eed6-f50f-48bc-9bc3-782f06209870', 'Wait for registration', 0, 'yellow'),
  ('98787f5b-3c3b-4486-a4b9-634aa6ec7c23', 'Deactivated', 4, 'gray')
on conflict do nothing;

-- calibration_vendors
insert into public.calibration_vendors (id, display_name, sort_order, is_active) values
  ('cebb50d6-9174-49cd-ba9d-1f9a9529fed3', 'Internal vendor', 0, true)
on conflict do nothing;

-- part_numbers
insert into public.part_numbers (id, display_name, type_id, manufacturer, description, level_id, sort_order, is_active) values
  ('0c793788-27e9-4f15-ade4-7f69e6cb08c0', '33210A', '8d5d2f0b-c8a4-4ba8-b0ae-050fe9428f74', null, 'Function/ Arbitrary Waveform Generator', 'a7d0f223-7820-45dc-9cf3-5627cf1cbdc3', 0, true),
  ('c564b903-a50c-4af8-bdce-d3df03a627e5', 'KEYTHLEI', '8d5d2f0b-c8a4-4ba8-b0ae-050fe9428f74', null, null, 'a7d0f223-7820-45dc-9cf3-5627cf1cbdc3', 0, true),
  ('da0e4b69-1afe-472e-9b5a-ea375179b30e', 'FI-UNI-M20', '88e47919-74ad-4a11-92ec-282836b28ae3', null, null, 'a7d0f223-7820-45dc-9cf3-5627cf1cbdc3', 1, true),
  ('7881fa85-7b54-4fb2-8eb7-d6a61e5e419d', 'ST-UNI-M10', '5f325a3d-3870-43b4-95e7-3f6fad6cedc4', null, null, 'a7d0f223-7820-45dc-9cf3-5627cf1cbdc3', 1, true),
  ('995eb50d-f3d6-4aaa-99e5-dfd9e7f96a51', 'FX-2292-M12', 'c56359d1-16fd-4208-b8a6-4b263bc6d837', null, null, 'a7d0f223-7820-45dc-9cf3-5627cf1cbdc3', 3, true)
on conflict do nothing;

-- calibration_configurations
insert into public.calibration_configurations (id, part_number_id, interval_months, warning_days) values
  ('823da19f-a8a2-438d-a5bf-77d47e2b2b8e', 'c564b903-a50c-4af8-bdce-d3df03a627e5', 6, 15)
on conflict do nothing;

alter table public.type_groups enable trigger type_groups_write_history;
alter table public.types enable trigger types_write_history;
alter table public.levels enable trigger levels_write_history;
alter table public.departments enable trigger departments_write_history;
alter table public.locations enable trigger locations_write_history;
alter table public.tags enable trigger tags_write_history;
alter table public.calibration_vendors enable trigger calibration_vendors_write_history;
alter table public.part_numbers enable trigger part_numbers_write_history;
alter table public.calibration_configurations enable trigger calibration_configurations_write_history;

-- 4. Hồ sơ Admin trở lại (phòng ban đã có lại ở bước 3). Tắt ghi nhật ký của bảng này trong lúc chèn: nhật ký không được phụ thuộc
--    vào "người thao tác" còn sót lại trong phiên làm việc (người đó có thể vừa bị xóa ở bước 2).
update _keep_admin set department_id = null
  where department_id is not null and not exists (select 1 from public.departments d where d.id = _keep_admin.department_id);
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
