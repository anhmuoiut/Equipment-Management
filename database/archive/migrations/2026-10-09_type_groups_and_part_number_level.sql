-- =============================================================================
-- Migration 2026-10-09 — Nhóm của Type (type_groups) + Level của Part Number
--
-- Dành cho database ĐÃ dựng bằng 02 → 04 trước ngày 09/10/2026 và đang có dữ liệu. Database dựng mới (02 → 04 sau
-- ngày này) đã có sẵn mọi thứ dưới đây — không cần chạy file này.
--
-- Thứ tự: chạy file này MỘT lần trong Supabase SQL Editor, rồi chạy lại 04_functions.sql (chạy lại được nhiều lần).
-- Chạy lại chính file này cũng an toàn (bỏ qua phần đã có). Cả file là một giao dịch: lỗi ở đâu thì không đổi gì cả.
--
-- Không đổi dữ liệu hiện có: Type giữ nguyên kind; mỗi Type được gán nhóm hệ thống cùng kind (Tester / Base / Fixture)
-- hoặc nhóm Sub-equipment; lịch sử không bị ghi thêm dòng nào; part number giữ Level trống cho tới khi Admin chọn.
-- =============================================================================

begin;

-- 1. type_groups — nhóm của Type (Admin tự thêm / sửa / ẩn ở Configuration › Group) ---------------------
create table if not exists public.type_groups (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  kind         text not null default 'sub_equipment',
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.user_profiles (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.user_profiles (id),
  updated_at   timestamptz not null default now(),

  constraint type_groups_kind_check check (kind in ('tester', 'base', 'fixture', 'sub_equipment'))
);
create unique index if not exists type_groups_display_name_key on public.type_groups (lower(display_name));
create unique index if not exists type_groups_system_kind_key on public.type_groups (kind) where kind <> 'sub_equipment';
create index if not exists type_groups_sort_idx on public.type_groups (sort_order, display_name);
drop trigger if exists type_groups_set_updated_at on public.type_groups;
create trigger type_groups_set_updated_at before update on public.type_groups
  for each row execute function public.set_updated_at();
comment on column public.type_groups.kind is 'tester / base / fixture (nhóm hệ thống, khóa) hoặc sub_equipment (mọi nhóm Admin thêm). Type thuộc nhóm nào thì mang kind của nhóm đó.';

-- 4 nhóm ban đầu: 3 nhóm hệ thống cùng tên với 3 Type hệ thống + nhóm Sub-equipment cho các Type Admin đã thêm.
insert into public.type_groups (display_name, kind, sort_order) values
  ('Tester',        'tester',        1),
  ('Base',          'base',          2),
  ('Fixture',       'fixture',       3),
  ('Sub-equipment', 'sub_equipment', 4)
on conflict do nothing;

-- 2. types.group_id ---------------------------------------------------------------------------------
alter table public.types add column if not exists group_id uuid references public.type_groups (id);

-- Gán nhóm theo kind hiện có. Tắt trigger của bảng types trong lúc gán để lịch sử không có thêm dòng và updated_at giữ nguyên.
alter table public.types disable trigger user;
update public.types t
set group_id = (select g.id from public.type_groups g where g.kind = t.kind order by g.sort_order, g.created_at limit 1)
where t.group_id is null;
alter table public.types enable trigger user;

alter table public.types alter column group_id set not null;
create index if not exists types_group_idx on public.types (group_id);
comment on column public.types.kind is 'tester / base / fixture (hệ thống, khóa) → bảng equipment; sub_equipment → bảng sub_equipment. Luôn bằng type_groups.kind của group_id (database tự đặt).';
comment on column public.types.group_id is 'Nhóm của Type (Configuration › Group). Admin chọn trong các nhóm kind = sub_equipment; 3 Type hệ thống giữ nhóm hệ thống tương ứng.';

-- 3. part_numbers.level_id --------------------------------------------------------------------------
alter table public.part_numbers add column if not exists level_id uuid references public.levels (id);
create index if not exists part_numbers_level_idx on public.part_numbers (level_id);
comment on column public.part_numbers.level_id is 'Level của part number (Configuration › Part Number). Form Thêm thiết bị điền sẵn Level này khi chọn part number; Level của thiết bị không đổi theo khi part number đổi Level.';

-- 4. Lịch sử cấu hình nhận thêm bảng type_groups -----------------------------------------------------
alter table public.configuration_histories drop constraint if exists configuration_histories_table_name_check;
alter table public.configuration_histories add constraint configuration_histories_table_name_check check (table_name in (
  'part_numbers', 'locations', 'types', 'type_groups', 'tags', 'levels', 'departments',
  'calibration_configurations', 'calibration_vendors'));

-- 5. Bảo mật như mọi bảng: RLS chặn hết, chỉ server (service_role) đọc / ghi ----------------------------
alter table public.type_groups enable row level security;
revoke all on public.type_groups from anon, authenticated;
grant all on public.type_groups to service_role;

commit;

-- -----------------------------------------------------------------------------
-- Kiểm tra (xong rồi chạy lại 04_functions.sql): phải ra 4+ nhóm, 0 Type chưa có nhóm, 0 Type lệch kind với nhóm.
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.type_groups) as groups,
  (select count(*) from public.types where group_id is null) as types_without_group,
  (select count(*) from public.types t join public.type_groups g on g.id = t.group_id where t.kind <> g.kind) as types_with_wrong_kind,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'part_numbers' and column_name = 'level_id') as part_number_level_column;
