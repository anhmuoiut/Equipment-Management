-- =============================================================================
-- 03_seed.sql — DỮ LIỆU HỆ THỐNG BẮT BUỘC (chạy sau 02_schema.sql, trước 04_functions.sql).
--
-- 3 loại hệ thống: Tester, Base, Fixture. Hệ thống dựa vào chúng để biết thiết bị thuộc bảng nào và nằm
-- dưới ai (Tester ⊃ Base ⊃ Fixture): không xóa, không ẩn, không đổi `kind` được; đổi tên hiển thị thì được.
-- Mỗi loại thuộc một nhóm (type_groups): 3 nhóm hệ thống cùng tên (khóa như loại) và nhóm Sub-equipment cho các Type
-- Admin thêm; Admin tự thêm / sửa / ẩn nhóm ở Configuration › Group.
-- Mọi dữ liệu khác (Type của sub-equipment như DMM / Power supply / Card, Part Number, Location, Level,
-- Tag, Vendor…) Admin tự tạo ở Configuration.
--
-- Chạy lại nhiều lần không bị trùng (bỏ qua giá trị đã có).
-- =============================================================================

begin;

insert into public.type_groups (display_name, kind, sort_order) values
  ('Tester',        'tester',        1),
  ('Base',          'base',          2),
  ('Fixture',       'fixture',       3),
  ('Sub-equipment', 'sub_equipment', 4)
on conflict do nothing;

insert into public.types (display_name, kind, group_id, sort_order)
select v.display_name, v.kind, g.id, v.sort_order
from (values ('Tester', 'tester', 1), ('Base', 'base', 2), ('Fixture', 'fixture', 3)) as v (display_name, kind, sort_order)
join public.type_groups g on g.kind = v.kind
on conflict do nothing;

commit;

select g.display_name as "group", t.display_name as type, t.kind
from public.types t join public.type_groups g on g.id = t.group_id order by t.sort_order;
