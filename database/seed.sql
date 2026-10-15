-- =============================================================================
-- seed.sql — DÒNG HỆ THỐNG BẮT BUỘC của project mới (chạy sau migration baseline và TRƯỚC khi có người dùng).
--
-- Ba loại Tester / Base / Fixture và các nhóm của chúng. App dựa vào chúng để biết thiết bị thuộc bảng nào và nằm dưới ai
-- (Tester ⊃ Base ⊃ Fixture): không xóa, không ẩn, không đổi kind được; Admin không tự tạo lại được nên phải có sẵn.
--
-- Mọi danh sách Configuration còn lại (Location, Level, Department, Tag, Vendor, Part number, Type của sub-equipment, Setup
-- hiệu chuẩn) KHÔNG nằm ở đây: Admin nhập tay ở Configuration sau khi đăng nhập.
-- Không có dữ liệu thiết bị, không có tài khoản, không có nhật ký. Không ghi nhật ký (trigger write_history tắt trong lúc chèn).
-- Chạy lại nhiều lần được: dòng đã có thì bỏ qua (on conflict do nothing).
-- =============================================================================

begin;

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

commit;
