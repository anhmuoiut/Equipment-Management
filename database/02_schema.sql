-- =============================================================================
-- 02_schema.sql — TẠO database theo docs/DATABASE_MODIFIED.md.
--
-- Chạy sau 01_reset_blank.sql, trong Supabase SQL Editor: dán cả file → Run.
-- Cả file chạy trong một giao dịch: lỗi ở đâu thì không tạo gì cả.
-- Cần schema auth của Supabase (user_profiles.id trỏ tới auth.users).
--
-- File này chỉ tạo bảng, ràng buộc, index và trigger toàn vẹn dữ liệu cơ bản.
-- Nghiệp vụ nhiều bước (ghi log, đổi vị trí cả cây, Move / Swap / Detach, quy tắc
-- cha–con, tự tính due_date, view…) nằm trong 04_functions.sql.
--
-- Thứ tự: 0 hàm dùng chung · 1 User Management · 2 Configuration ·
--         3 Equipment · 4 Sub-equipment + Calibration · 5 Golden board + asset_logs ·
--         6 Hệ thống (error_log) · 7 Bảo mật
-- =============================================================================

begin;

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- =============================================================================
-- 0. HÀM DÙNG CHUNG
-- =============================================================================

-- Tự cập nhật updated_at mỗi khi sửa dòng.
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Bảng lịch sử chỉ được thêm, không sửa / xóa.
create function public.prevent_history_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'HISTORY_IS_APPEND_ONLY'
    using detail = format('Rows in %I cannot be updated or deleted', tg_table_name);
end;
$$;

-- =============================================================================
-- 1. USER MANAGEMENT
-- =============================================================================

-- user_profiles — tài khoản ---------------------------------------------------
-- Mỗi tài khoản là một người dùng Supabase Auth (id = auth.users.id). Admin tạo; không tự đăng ký, không duyệt.
-- Đăng nhập bằng username: server đổi thành email nội bộ <username>@jabil.local (không gửi email).
create table public.user_profiles (
  id                   uuid primary key references auth.users (id) on delete restrict,
  username             text not null,
  full_name            text not null,
  employee_id          text,
  department_id        uuid,  -- FK departments: thêm ở mục 2 (departments tạo sau)
  role                 text not null default 'readonly',
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  created_by           uuid references public.user_profiles (id),
  created_at           timestamptz not null default now(),
  updated_by           uuid references public.user_profiles (id),
  updated_at           timestamptz not null default now(),

  constraint user_profiles_username_format check (username ~ '^[a-z0-9][a-z0-9._+-]{0,63}$'),
  constraint user_profiles_role_check check (role in ('admin', 'user', 'readonly'))
);
create unique index user_profiles_username_key on public.user_profiles (username);
create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

comment on table public.user_profiles is 'Tài khoản = một người dùng Supabase Auth. Không xóa, chỉ khóa (is_active = false). Quyền vào app = có dòng ở đây VÀ is_active.';
comment on column public.user_profiles.id is 'Trùng id của auth.users. Khóa ngoại RESTRICT: không xóa được tài khoản Auth còn dòng ở đây (tránh mất created_by / updated_by).';
comment on column public.user_profiles.username is 'Chữ thường; không đổi sau khi tạo. Email đăng nhập nội bộ = username@jabil.local.';
comment on column public.user_profiles.must_change_password is 'true: mật khẩu tạm (tạo mới / Admin đặt lại) — phải đổi mật khẩu mới vào được app.';

-- user_histories — lịch sử tài khoản ------------------------------------------
create table public.user_histories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,  -- cố ý không FK
  label      text not null,
  action     text not null,
  changes    jsonb not null default '{}'::jsonb,
  note       text,
  source     text not null default 'ui',
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles (id),
  action_id  uuid,  -- cùng một thao tác của người dùng = cùng action_id (view recent_actions gộp theo id này)

  constraint user_histories_action_check check (action in (
    'CREATE', 'UPDATE', 'ROLE_CHANGE', 'DISABLE', 'ENABLE', 'PASSWORD_RESET')),
  constraint user_histories_source_check check (source in ('ui', 'import', 'script'))
);
create index user_histories_object_idx  on public.user_histories (user_id, created_at desc);
create index user_histories_created_idx on public.user_histories (created_at desc);
create trigger user_histories_append_only before update or delete on public.user_histories
  for each row execute function public.prevent_history_change();

-- =============================================================================
-- 2. CONFIGURATION — dữ liệu gốc dùng chung + cấu hình hiệu chuẩn
--    Xóa = ẩn (is_active = false), trừ tags (xóa thật khi không còn dùng), calibration_configurations
--    và 3 loại hệ thống của types (không xóa, không ẩn được).
-- =============================================================================

-- type_groups — nhóm của Type (cột Group ở Configuration › Type; Admin tự thêm / sửa / ẩn) ---------------
-- kind: loại hệ thống mà mọi Type thuộc nhóm này mang — types.kind luôn theo nhóm (04_functions.sql mục 3b).
-- 3 nhóm hệ thống Tester / Base / Fixture (03_seed.sql) khóa như 3 Type hệ thống; nhóm Admin thêm luôn là kind = sub_equipment.
create table public.type_groups (
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
create unique index type_groups_display_name_key on public.type_groups (lower(display_name));
-- Mỗi nhóm hệ thống (tester / base / fixture) đúng một dòng; kind = sub_equipment thì Admin thêm tùy ý.
create unique index type_groups_system_kind_key on public.type_groups (kind) where kind <> 'sub_equipment';
create index type_groups_sort_idx on public.type_groups (sort_order, display_name);
create trigger type_groups_set_updated_at before update on public.type_groups
  for each row execute function public.set_updated_at();

comment on column public.type_groups.kind is 'tester / base / fixture (nhóm hệ thống, khóa) hoặc sub_equipment (mọi nhóm Admin thêm). Type thuộc nhóm nào thì mang kind của nhóm đó.';

-- types — loại (tạo trước part_numbers: part number trỏ tới loại) ------------------
-- kind: tester / base / fixture là 3 loại hệ thống (03_seed.sql, khóa — 04_functions.sql mục 3b);
-- sub_equipment là loại thiết bị hiệu chuẩn (DMM, Power supply, Card…) do Admin tự thêm.
-- group_id: nhóm của Type; kind luôn bằng kind của nhóm (database tự đặt).
create table public.types (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  kind         text not null default 'sub_equipment',
  group_id     uuid not null references public.type_groups (id),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.user_profiles (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.user_profiles (id),
  updated_at   timestamptz not null default now(),

  constraint types_kind_check check (kind in ('tester', 'base', 'fixture', 'sub_equipment'))
);
create unique index types_display_name_key on public.types (lower(display_name));
-- Mỗi loại hệ thống (tester / base / fixture) đúng một dòng; kind = sub_equipment thì Admin thêm tùy ý.
create unique index types_system_kind_key on public.types (kind) where kind <> 'sub_equipment';
create index types_sort_idx on public.types (sort_order, display_name);
create index types_group_idx on public.types (group_id);
create trigger types_set_updated_at before update on public.types
  for each row execute function public.set_updated_at();

-- part_numbers — mã part --------------------------------------------------------
-- type_id: loại của mọi thiết bị mang part number này (04_functions.sql mục 3b).
create table public.part_numbers (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  type_id      uuid not null references public.types (id),
  description  text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.user_profiles (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.user_profiles (id),
  updated_at   timestamptz not null default now()
);
create unique index part_numbers_display_name_key on public.part_numbers (lower(display_name));
create index part_numbers_sort_idx on public.part_numbers (sort_order, display_name);
create index part_numbers_type_idx on public.part_numbers (type_id);
create trigger part_numbers_set_updated_at before update on public.part_numbers
  for each row execute function public.set_updated_at();

comment on column public.part_numbers.type_id is 'Loại của mọi thiết bị mang part number này — database tự đặt type_id của equipment / sub_equipment theo. kind của loại quyết định thiết bị thuộc bảng nào. Chỉ đổi được khi chưa thiết bị nào dùng part number (PART_NUMBER_IN_USE).';
comment on column public.types.kind is 'tester / base / fixture (hệ thống, khóa) → bảng equipment; sub_equipment → bảng sub_equipment. Luôn bằng type_groups.kind của group_id (database tự đặt).';
comment on column public.types.group_id is 'Nhóm của Type (Configuration › Group). Admin chọn trong các nhóm kind = sub_equipment; 3 Type hệ thống giữ nhóm hệ thống tương ứng.';

-- locations — vị trí -------------------------------------------------------------
create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.user_profiles (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.user_profiles (id),
  updated_at   timestamptz not null default now()
);
create unique index locations_display_name_key on public.locations (lower(display_name));
create index locations_sort_idx on public.locations (sort_order, display_name);
create trigger locations_set_updated_at before update on public.locations
  for each row execute function public.set_updated_at();

-- tags — thẻ (có màu) để người dùng chọn trong phần Remark của Equipment / Calibration / Golden sample.
-- Xóa thật; đang được dùng thì không xóa được (04_functions.sql mục 3e). ------------
create table public.tags (
  id              uuid primary key default gen_random_uuid(),
  display_name    text not null,
  sort_order      integer not null default 0,
  color           text not null default 'gray',
  created_by      uuid references public.user_profiles (id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.user_profiles (id),
  updated_at      timestamptz not null default now(),

  constraint tags_color_check check (color in ('green', 'yellow', 'red', 'blue', 'gray', 'purple'))
);
create unique index tags_display_name_key on public.tags (lower(display_name));
create index tags_sort_idx on public.tags (sort_order, display_name);
create trigger tags_set_updated_at before update on public.tags
  for each row execute function public.set_updated_at();

comment on column public.tags.color is 'Màu thẻ pastel: green (xanh ngọc) / yellow / red / blue / gray / purple.';

-- levels — level trên dây chuyền -------------------------------------------------
create table public.levels (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.user_profiles (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.user_profiles (id),
  updated_at   timestamptz not null default now()
);
create unique index levels_display_name_key on public.levels (lower(display_name));
create index levels_sort_idx on public.levels (sort_order, display_name);
create trigger levels_set_updated_at before update on public.levels
  for each row execute function public.set_updated_at();

-- part_numbers.level_id — Level của part number (Admin chọn trong Configuration › Part Number; không bắt buộc ở database).
-- Thêm sau khi có bảng levels. Equipment không bị ép theo: Level của thiết bị vẫn do form / thiết bị cha quyết định.
alter table public.part_numbers add column level_id uuid references public.levels (id);
create index part_numbers_level_idx on public.part_numbers (level_id);
comment on column public.part_numbers.level_id is 'Level của part number (Configuration › Part Number). Form Thêm thiết bị điền sẵn Level này khi chọn part number; Level của thiết bị không đổi theo khi part number đổi Level.';

-- departments — phòng ban --------------------------------------------------------
create table public.departments (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.user_profiles (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.user_profiles (id),
  updated_at   timestamptz not null default now()
);
create unique index departments_display_name_key on public.departments (lower(display_name));
create index departments_sort_idx on public.departments (sort_order, display_name);
create trigger departments_set_updated_at before update on public.departments
  for each row execute function public.set_updated_at();

alter table public.user_profiles
  add constraint user_profiles_department_id_fkey
  foreign key (department_id) references public.departments (id);

-- calibration_configurations — Configuration › Hiệu chuẩn › Setup (xóa thật) -----
-- Mỗi part number (loại sub_equipment) phải hiệu chuẩn một dòng: chu kỳ để tự tính due_date,
-- warning_days để tính Due soon (04_functions.sql mục 4).
create table public.calibration_configurations (
  id                uuid primary key default gen_random_uuid(),
  part_number_id    uuid not null references public.part_numbers (id) on delete restrict,
  interval_months   integer not null,
  warning_days      integer not null default 30,
  created_by        uuid references public.user_profiles (id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.user_profiles (id),
  updated_at        timestamptz not null default now(),

  constraint calibration_configurations_part_number_id_key unique (part_number_id),
  constraint calibration_configurations_interval_check check (interval_months > 0),
  constraint calibration_configurations_warning_check check (warning_days > 0)
);
create trigger calibration_configurations_set_updated_at before update on public.calibration_configurations
  for each row execute function public.set_updated_at();

-- calibration_vendors — vendor hiệu chuẩn ----------------------------------------
create table public.calibration_vendors (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.user_profiles (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.user_profiles (id),
  updated_at   timestamptz not null default now()
);
create unique index calibration_vendors_display_name_key on public.calibration_vendors (lower(display_name));
create index calibration_vendors_sort_idx on public.calibration_vendors (sort_order, display_name);
create trigger calibration_vendors_set_updated_at before update on public.calibration_vendors
  for each row execute function public.set_updated_at();

-- configuration_histories — lịch sử của 9 bảng cấu hình ------------------------
create table public.configuration_histories (
  id         uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id  uuid not null,  -- cố ý không FK
  label      text not null,
  action     text not null,
  changes    jsonb not null default '{}'::jsonb,
  note       text,
  source     text not null default 'ui',
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles (id),
  action_id  uuid,  -- cùng một thao tác của người dùng = cùng action_id (view recent_actions gộp theo id này)

  constraint configuration_histories_table_name_check check (table_name in (
    'part_numbers', 'locations', 'types', 'type_groups', 'tags', 'levels', 'departments',
    'calibration_configurations', 'calibration_vendors')),
  constraint configuration_histories_action_check check (action in ('CREATE', 'UPDATE', 'DELETE')),
  constraint configuration_histories_source_check check (source in ('ui', 'import', 'script'))
);
create index configuration_histories_object_idx  on public.configuration_histories (record_id, created_at desc);
create index configuration_histories_created_idx on public.configuration_histories (created_at desc);
create trigger configuration_histories_append_only before update or delete on public.configuration_histories
  for each row execute function public.prevent_history_change();

-- =============================================================================
-- 3. EQUIPMENT — thiết bị chính: tester / base / fixture
--    Cây: Tester ⊃ Base ⊃ Fixture (parent_id). Sub-equipment và golden board gắn vào cây
--    ở bảng riêng của chúng (mục 4, 5).
-- =============================================================================

-- equipment — tester, base, fixture ------------------------------------------------
-- Loại (tester / base / fixture) = types.kind của type_id; type_id luôn theo part number
-- (04_functions.sql mục 3b). Quy tắc cha–con: 04_functions.sql mục 3.
create table public.equipment (
  id             uuid primary key default gen_random_uuid(),
  jabil_id       text,
  part_number_id uuid not null references public.part_numbers (id),
  serial_number  text not null,
  asset          text,
  type_id        uuid not null references public.types (id),
  level_id       uuid references public.levels (id),
  location_id    uuid not null references public.locations (id),
  usage          text not null default 'not_in_use',
  remark         text,
  tag_ids        uuid[] not null default '{}',
  parent_id      uuid references public.equipment (id) on delete restrict,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.user_profiles (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.user_profiles (id),

  constraint equipment_not_own_parent check (id <> parent_id),
  constraint equipment_serial_not_blank check (btrim(serial_number) <> ''),
  constraint equipment_usage_check check (usage in ('in_use', 'not_in_use')),
  constraint equipment_remark_length check (char_length(remark) <= 1000)
);
create index equipment_part_number_idx   on public.equipment (part_number_id);
create index equipment_serial_lower_idx  on public.equipment (lower(serial_number));
create index equipment_asset_idx         on public.equipment (asset);
create index equipment_type_idx          on public.equipment (type_id);
create index equipment_tags_idx          on public.equipment using gin (tag_ids);
create index equipment_location_idx      on public.equipment (location_id);
create index equipment_parent_idx        on public.equipment (parent_id);
create index equipment_usage_idx         on public.equipment (usage);
create trigger equipment_set_updated_at before update on public.equipment
  for each row execute function public.set_updated_at();

comment on table public.equipment is 'Tester / base / fixture. Xóa thật, chỉ qua asset_delete: con trực tiếp (equipment, sub-equipment, golden board) luôn được giữ và thành chưa gắn (Not in use).';
comment on column public.equipment.serial_number is 'Không UQ — trùng chỉ cảnh báo (serial_matches kiểm tra cả 3 bảng trước khi lưu, dùng index lower(serial_number)). Database tự cắt khoảng trắng hai đầu.';
comment on column public.equipment.parent_id is 'Tester không có cha; base: cha là tester hoặc trống; fixture: cha là base hoặc tester, hoặc trống. Khóa ngoại RESTRICT: không xóa được cha khi còn con (xóa qua equipment_delete). Chỉ đổi qua Move / Swap / Detach.';
comment on column public.equipment.usage is 'Status: In use / Not in use. Hệ thống tự quản (Check-out / Check-in, Swap, Move, Detach), không có danh sách cấu hình.';
comment on column public.equipment.tag_ids is 'Thẻ (tags.id) người dùng chọn; database kiểm tra mọi lần ghi (04_functions.sql mục 3e).';
comment on column public.equipment.type_id is 'Luôn bằng part_numbers.type_id của part number thiết bị mang (database tự đặt) — không chọn tay. types.kind phải là tester / base / fixture.';

-- =============================================================================
-- 4. SUB-EQUIPMENT + CALIBRATION — phụ thuộc một chiều vào Equipment
-- =============================================================================

-- sub_equipment — thiết bị cần hiệu chuẩn, nằm trong tester ----------------------------
create table public.sub_equipment (
  id             uuid primary key default gen_random_uuid(),
  jabil_id       text,
  part_number_id uuid not null references public.part_numbers (id),
  serial_number  text not null,
  asset          text,
  type_id        uuid not null references public.types (id),
  tester_id      uuid references public.equipment (id) on delete set null,
  location_id    uuid not null references public.locations (id),
  usage          text not null default 'not_in_use',
  remark         text,
  tag_ids        uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  created_by     uuid references public.user_profiles (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.user_profiles (id),

  constraint sub_equipment_serial_not_blank check (btrim(serial_number) <> ''),
  constraint sub_equipment_usage_check check (usage in ('in_use', 'not_in_use')),
  constraint sub_equipment_remark_length check (char_length(remark) <= 1000)
);
create index sub_equipment_part_number_idx   on public.sub_equipment (part_number_id);
create index sub_equipment_serial_lower_idx  on public.sub_equipment (lower(serial_number));
create index sub_equipment_asset_idx         on public.sub_equipment (asset);
create index sub_equipment_type_idx          on public.sub_equipment (type_id);
create index sub_equipment_tester_idx        on public.sub_equipment (tester_id);
create index sub_equipment_location_idx      on public.sub_equipment (location_id);
create index sub_equipment_usage_idx         on public.sub_equipment (usage);
create index sub_equipment_tags_idx          on public.sub_equipment using gin (tag_ids);
create trigger sub_equipment_set_updated_at before update on public.sub_equipment
  for each row execute function public.set_updated_at();

comment on table public.sub_equipment is 'Thiết bị cần hiệu chuẩn (DMM, power supply, card…). Xóa thật; lịch sử hiệu chuẩn (calibrations) xóa theo.';
comment on column public.sub_equipment.tester_id is 'Tester chứa nó (equipment có types.kind = tester); trống = chưa gắn (đang nằm kho). Xóa tester → trống, không xóa sub-equipment.';
comment on column public.sub_equipment.location_id is 'Có tester thì luôn bằng vị trí của tester (database tự đặt).';
comment on column public.sub_equipment.type_id is 'Luôn bằng part_numbers.type_id (types.kind = sub_equipment). Cùng Type mới Swap được với nhau.';

-- calibrations — mỗi lần hiệu chuẩn một dòng ----------------------------------------------
create table public.calibrations (
  id               uuid primary key default gen_random_uuid(),
  sub_equipment_id uuid not null references public.sub_equipment (id) on delete cascade,
  calibrated_at    date not null,
  due_date         date not null,
  vendor_id        uuid references public.calibration_vendors (id),
  cert_no          text,
  cert_file_url    text,
  result           text not null default 'pass',
  remark           text,
  created_by       uuid references public.user_profiles (id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.user_profiles (id),
  updated_at       timestamptz not null default now(),

  constraint calibrations_due_after_calibration check (due_date >= calibrated_at),
  constraint calibrations_result_check check (result in ('pass', 'fail')),
  constraint calibrations_remark_length check (char_length(remark) <= 1000)
);
create index calibrations_sub_equipment_idx on public.calibrations (sub_equipment_id, calibrated_at desc);
create index calibrations_due_idx           on public.calibrations (due_date);
create trigger calibrations_set_updated_at before update on public.calibrations
  for each row execute function public.set_updated_at();

comment on table public.calibrations is 'Lịch sử hiệu chuẩn: mỗi lần một dòng. Lần mới nhất (calibrated_at lớn nhất) quyết định Calibration Status (not_calibrated / failed / overdue / due_soon / valid) — view sub_equipment_calibration. Xóa sub-equipment thì các lần hiệu chuẩn của nó xóa theo (cascade có chủ đích: bản ghi CALIBRATE trong asset_logs vẫn còn).';
comment on column public.calibrations.due_date is 'Part number có Setup hiệu chuẩn: tự tính = calibrated_at + interval_months (ghi đè giá trị gửi lên). Chưa có Setup: bắt buộc nhập.';
comment on column public.calibrations.cert_file_url is 'Đường dẫn tới file chứng nhận (SharePoint / OneDrive…); chưa upload lên Supabase Storage.';

-- =============================================================================
-- 5. GOLDEN BOARD
-- =============================================================================

-- golden_boards — golden board (PCBA tốt đã biết kết quả) -------------------------------
create table public.golden_boards (
  id              uuid primary key default gen_random_uuid(),
  part_number     text not null,
  serial_number   text not null,
  utd_part_number text,
  origin          text,
  purpose         text,
  parent_id       uuid references public.equipment (id) on delete set null,
  location_id     uuid not null references public.locations (id),
  usage           text not null default 'not_in_use',
  remark          text,
  tag_ids         uuid[] not null default '{}',
  created_by      uuid references public.user_profiles (id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.user_profiles (id),
  updated_at      timestamptz not null default now(),

  constraint golden_boards_serial_not_blank check (btrim(serial_number) <> ''),
  constraint golden_boards_usage_check check (usage in ('in_use', 'not_in_use')),
  constraint golden_boards_remark_length check (char_length(remark) <= 1000)
);
create index golden_boards_part_number_idx   on public.golden_boards (part_number);
create index golden_boards_serial_lower_idx  on public.golden_boards (lower(serial_number));
create index golden_boards_parent_idx        on public.golden_boards (parent_id);
create index golden_boards_location_idx      on public.golden_boards (location_id);
create index golden_boards_usage_idx         on public.golden_boards (usage);
create index golden_boards_tags_idx          on public.golden_boards using gin (tag_ids);
create trigger golden_boards_set_updated_at before update on public.golden_boards
  for each row execute function public.set_updated_at();

comment on table public.golden_boards is 'Golden board. Xóa thật.';
comment on column public.golden_boards.parent_id is 'Tester hoặc fixture chứa nó (equipment có types.kind = tester / fixture); trống = chưa gắn. Xóa cha → trống, không xóa golden board.';
comment on column public.golden_boards.location_id is 'Có cha thì luôn bằng vị trí của cha (database tự đặt).';
comment on column public.golden_boards.usage is 'Chỉ In use được khi đã gắn vào cha (04_functions.sql mục 3d).';

-- =============================================================================
-- 5b. ASSET_LOGS — nhật ký thay đổi chung của equipment / sub_equipment / golden_boards
--     (lịch sử hiệu chuẩn nằm ở đây với asset_type = sub_equipment, action = CALIBRATE…).
--     Database tự ghi bằng trigger (04_functions.sql mục 1). Chỉ thêm, không sửa / xóa.
-- =============================================================================
create table public.asset_logs (
  id            uuid primary key default gen_random_uuid(),
  asset_type    text not null,
  asset_id      uuid not null,  -- cố ý không FK: log còn lại sau khi tài sản bị xóa
  label         text not null,
  action        text not null,
  old_value     jsonb,
  new_value     jsonb,
  from_location text,
  to_location   text,
  reason        text,
  source        text not null default 'ui',
  user_id       uuid references public.user_profiles (id),
  created_at    timestamptz not null default now(),
  action_id     uuid,  -- cùng một thao tác của người dùng (Swap, Move kèm con cháu, Import…) = cùng action_id; view recent_actions gộp theo id này

  constraint asset_logs_asset_type_check check (asset_type in ('equipment', 'sub_equipment', 'golden_board')),
  constraint asset_logs_action_check check (action in (
    'CREATE', 'UPDATE', 'CHANGE_LOCATION', 'MOVE', 'SWAP', 'DETACH', 'CHECK_OUT', 'CHECK_IN', 'TAGS', 'DELETE',
    'CALIBRATE', 'CALIBRATION_UPDATE', 'CALIBRATION_REMOVE')),
  constraint asset_logs_source_check check (source in ('ui', 'import', 'script'))
);
create index asset_logs_object_idx  on public.asset_logs (asset_type, asset_id, created_at desc);
create index asset_logs_created_idx on public.asset_logs (created_at desc);
create trigger asset_logs_append_only before update or delete on public.asset_logs
  for each row execute function public.prevent_history_change();

comment on column public.asset_logs.label is 'Serial tại thời điểm thay đổi — vẫn đọc được sau khi tài sản bị xóa.';
comment on column public.asset_logs.old_value is 'Các trường đổi: { trường: giá trị cũ }. Trường FK lưu tên hiển thị. DELETE: chụp lại cả dòng.';
comment on column public.asset_logs.new_value is 'Các trường đổi: { trường: giá trị mới }. CREATE: cả dòng mới.';
comment on column public.asset_logs.reason is 'Ghi chú: lý do do user nhập (Check-out / Check-in…) hoặc mã hệ thống (via_parent:<SN>, swap_with:<SN>, parent_deleted:<SN>…).';

-- =============================================================================
-- 6. HỆ THỐNG
-- =============================================================================

-- error_log — nhật ký lỗi (tự xóa bản ghi cũ hơn 90 ngày) ----------------------------
create table public.error_log (
  id         uuid primary key default gen_random_uuid(),
  request_id text not null,
  route      text,
  user_id    uuid,  -- cố ý không FK
  error_code text,
  message    text,
  stack      text,
  created_at timestamptz not null default now(),

  constraint error_log_message_length check (char_length(message) <= 2000),
  constraint error_log_stack_length   check (char_length(stack) <= 8000)
);
create index error_log_request_idx on public.error_log (request_id);
create index error_log_created_idx on public.error_log (created_at desc);

create function public.purge_old_error_log() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.error_log where created_at < now() - interval '90 days';
  return null;
end;
$$;
create trigger error_log_purge after insert on public.error_log
  for each statement execute function public.purge_old_error_log();

-- =============================================================================
-- 7. BẢO MẬT — RLS chặn hết; chỉ server (service_role) đọc / ghi
-- =============================================================================
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end
$$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant  all on all tables    in schema public to service_role;
grant  execute on all functions in schema public to service_role;

commit;

-- -----------------------------------------------------------------------------
-- Kiểm tra: phải ra 18 bảng (BASE TABLE). View recent_activities và sub_equipment_calibration nằm ở 04_functions.sql.
-- -----------------------------------------------------------------------------
select table_type, table_name
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;
