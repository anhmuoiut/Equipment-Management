-- =============================================================================
-- seed.sql — DỮ LIỆU CÓ SẴN của project mới (chạy sau MỌI migration và TRƯỚC khi có người dùng).
--
--   1. Dòng hệ thống BẮT BUỘC: ba loại Tester / Base / Fixture và các nhóm của chúng. App dựa vào chúng để biết thiết bị
--      thuộc bảng nào và nằm dưới ai (Tester ⊃ Base ⊃ Fixture): không xóa, không ẩn, không đổi kind được.
--   2. Danh sách Configuration của site này (Location, Level, Department, Tag, Vendor, Part number, Setup hiệu chuẩn,
--      Type của sub-equipment) — xuất từ project cũ ngày 2026-10-15. Sửa / xóa dòng tùy ý trước khi chạy; Admin cũng sửa được
--      ở Configuration sau này. Nếu dùng cho một site khác: giữ phần 1, thay phần 2.
--
-- Không có dữ liệu thiết bị, không có tài khoản, không có nhật ký. Id giữ nguyên như project cũ để khóa ngoại khớp.
-- created_by để trống (không có người tạo trong project mới).
-- Chạy lại nhiều lần được: dòng đã có thì bỏ qua (on conflict do nothing).
--
-- reset_after_testing.sql chứa cùng các dòng này (bước 3): sửa file này thì sửa cả bước đó.
-- =============================================================================

begin;

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


commit;
