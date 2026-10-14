-- =============================================================================
-- Baseline migration 2026-10-15 — toàn bộ database của Equipment Management trong MỘT file.
--
-- Dựng database MỚI (project Supabase trống) bằng đúng một lần chạy file này trong SQL Editor (dán cả file → Run).
-- Cả file là một giao dịch: lỗi ở đâu thì không tạo gì cả. Thứ tự các bước dựng project: docs/DEPLOY.md.
--
--   Phần A  Bảng, ràng buộc, chỉ mục, trigger toàn vẹn dữ liệu, RLS bật cho mọi bảng (không có policy: chỉ server đọc / ghi).
--   Phần B  Hàm và trigger nghiệp vụ: nhật ký tự động (write_history), app_write, cây tài sản (Move / Swap / Detach / Check-out…),
--           import Excel, Overview, Dashboard (view recent_actions), Calibration (view sub_equipment_calibration).
--
-- Bảo mật: mọi hàm và view là SECURITY INVOKER; anon / authenticated không có quyền gì; chỉ service_role (server) gọi được.
-- Dữ liệu bắt buộc (3 loại hệ thống + danh sách Configuration) KHÔNG nằm ở đây: database/seed.sql.
--
-- Thay đổi về sau: thêm file mới trong database/migrations (YYYYMMDDHHMMSS_tên.sql), không sửa file này.
-- File này thay cho 01–04 và sáu migration cũ (lưu ở database/archive/).
-- =============================================================================

begin;

-- =============================================================================
-- PHẦN A — BẢNG, RÀNG BUỘC, CHỈ MỤC
-- =============================================================================

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
-- kind: loại hệ thống mà mọi Type thuộc nhóm này mang — types.kind luôn theo nhóm (mục 3b bên dưới (phần hàm / trigger)).
-- 3 nhóm hệ thống Tester / Base / Fixture (database/seed.sql) khóa như 3 Type hệ thống; nhóm Admin thêm luôn là kind = sub_equipment.
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
-- kind: tester / base / fixture là 3 loại hệ thống (database/seed.sql, khóa — mục 3b bên dưới (phần hàm / trigger));
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
-- type_id: loại của mọi thiết bị mang part number này (mục 3b bên dưới (phần hàm / trigger)).
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
-- Xóa thật; đang được dùng thì không xóa được (mục 3e bên dưới (phần hàm / trigger)). ------------
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
-- warning_days để tính Due soon (mục 4 bên dưới (phần hàm / trigger)).
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
-- (mục 3b bên dưới (phần hàm / trigger)). Quy tắc cha–con: mục 3 bên dưới (phần hàm / trigger).
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
comment on column public.equipment.tag_ids is 'Thẻ (tags.id) người dùng chọn; database kiểm tra mọi lần ghi (mục 3e bên dưới (phần hàm / trigger)).';
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
comment on column public.golden_boards.usage is 'Chỉ In use được khi đã gắn vào cha (mục 3d bên dưới (phần hàm / trigger)).';

-- =============================================================================
-- 5b. ASSET_LOGS — nhật ký thay đổi chung của equipment / sub_equipment / golden_boards
--     (lịch sử hiệu chuẩn nằm ở đây với asset_type = sub_equipment, action = CALIBRATE…).
--     Database tự ghi bằng trigger (mục 1 bên dưới (phần hàm / trigger)). Chỉ thêm, không sửa / xóa.
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

-- =============================================================================
-- PHẦN B — HÀM VÀ TRIGGER NGHIỆP VỤ
-- =============================================================================

-- =============================================================================
-- 0. NGỮ CẢNH GIAO DỊCH — ai thao tác, hành động, ghi chú, nguồn
--    (set_config(..., true) chỉ sống trong giao dịch hiện tại)
-- =============================================================================
create or replace function public.ctx(p_key text) returns text
language sql stable set search_path = '' as $$
  select nullif(current_setting('app.' || p_key, true), '')
$$;

create or replace function public.set_ctx(p_key text, p_value text) returns void
language sql set search_path = '' as $$
  select set_config('app.' || p_key, coalesce(p_value, ''), true)
$$;

-- =============================================================================
-- 1. NHẬT KÝ TỰ ĐỘNG
-- =============================================================================

-- Cột FK → chữ hiển thị tại thời điểm thay đổi.
create or replace function public.history_ref_label(p_column text, p_id uuid) returns text
language plpgsql stable set search_path = '' as $$
declare
  v text;
begin
  if p_id is null then return null; end if;
  case p_column
    when 'part_number_id' then select display_name into v from public.part_numbers where id = p_id;
    when 'type_id'        then select display_name into v from public.types where id = p_id;
    when 'group_id'       then select display_name into v from public.type_groups where id = p_id;
    when 'level_id'       then select display_name into v from public.levels where id = p_id;
    when 'location_id'    then select display_name into v from public.locations where id = p_id;
    when 'department_id'  then select display_name into v from public.departments where id = p_id;
    when 'vendor_id'      then select display_name into v from public.calibration_vendors where id = p_id;
    when 'parent_id', 'tester_id' then
      select serial_number into v from public.equipment where id = p_id;
      if v is null then  -- thiết bị đã bị xóa (ví dụ cha bị xóa cùng cây): SN gần nhất trong nhật ký
        select l.label into v from public.asset_logs l
        where l.asset_type = 'equipment' and l.asset_id = p_id order by l.created_at desc limit 1;
      end if;
    else v := null;
  end case;
  return coalesce(v, p_id::text);
end;
$$;

-- Mảng id thẻ (jsonb) → mảng tên thẻ, theo thứ tự cấu hình.
create or replace function public.history_tag_names(p_ids jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select case when p_ids is null then null else coalesce((
    select jsonb_agg(t.display_name order by t.sort_order, t.display_name)
    from public.tags t where t.id::text in (select jsonb_array_elements_text(p_ids))
  ), '[]'::jsonb) end
$$;

-- { trường: { old, new } } — chỉ trường thay đổi; FK lưu chữ hiển thị, tên bỏ đuôi _id.
create or replace function public.history_diff(p_old jsonb, p_new jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  k text;
  v_old jsonb;
  v_new jsonb;
  v_out jsonb := '{}'::jsonb;
  v_fk constant text[] := array['part_number_id', 'type_id', 'group_id', 'level_id', 'location_id',
    'department_id', 'vendor_id', 'parent_id', 'tester_id'];
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'sub_equipment_id'];
begin
  for k in select jsonb_object_keys(p_old) union select jsonb_object_keys(p_new) loop
    continue when k = any (v_skip);
    v_old := nullif(p_old -> k, 'null'::jsonb);
    v_new := nullif(p_new -> k, 'null'::jsonb);
    continue when v_old is not distinct from v_new;
    if k = 'tag_ids' then
      -- Thẻ: lưu tên thẻ (theo thứ tự cấu hình), bỏ qua khi cả hai đều rỗng.
      continue when coalesce(public.history_tag_names(v_old), '[]'::jsonb) = coalesce(public.history_tag_names(v_new), '[]'::jsonb);
      v_out := v_out || jsonb_build_object('tags', jsonb_build_object(
        'old', public.history_tag_names(v_old), 'new', public.history_tag_names(v_new)));
    elsif k = any (v_fk) then
      v_out := v_out || jsonb_build_object(
        regexp_replace(k, '_id$', ''),
        jsonb_build_object(
          'old', public.history_ref_label(k, (v_old #>> '{}')::uuid),
          'new', public.history_ref_label(k, (v_new #>> '{}')::uuid)));
    else
      v_out := v_out || jsonb_build_object(k, jsonb_build_object('old', v_old, 'new', v_new));
    end if;
  end loop;
  return v_out;
end;
$$;

-- old_value / new_value của asset_logs → lại dạng { trường: { old, new } } (view recent_actions, màn hình History).
create or replace function public.asset_log_changes(p_old jsonb, p_new jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', p_old -> k, 'new', p_new -> k)), '{}'::jsonb)
  from (select jsonb_object_keys(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as k) keys
$$;

-- action_id: mọi dòng nhật ký do CÙNG MỘT thao tác của người dùng ghi ra dùng chung một id (app đặt qua p_action_id của các hàm
-- bên dưới; hàm tự sinh nếu không truyền). Dòng ghi từ SQL tay không có id (null) và hiện như một thao tác riêng.
-- Cột action_id nằm ở phần bảng ở trên; chỉ mục (một phần) cho việc gộp theo action_id:
create index if not exists asset_logs_action_idx on public.asset_logs (action_id) where action_id is not null;
create index if not exists configuration_histories_action_idx on public.configuration_histories (action_id) where action_id is not null;
create index if not exists user_histories_action_idx on public.user_histories (action_id) where action_id is not null;

create or replace function public.write_history() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  v_id      uuid  := (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'id')::uuid;
  v_changes jsonb;
  v_keys    text[];
  v_action  text  := public.ctx('action');
  v_note    text  := public.ctx('note');
  v_source  text  := coalesce(public.ctx('source'), 'ui');
  v_action_id uuid := public.ctx('action_id')::uuid;
  v_actor   uuid;
  v_label   text;
  v_type    text;
  v_asset   uuid;
begin
  v_changes := public.history_diff(coalesce(v_old, '{}'::jsonb), coalesce(v_new, '{}'::jsonb));
  select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(v_changes) k;
  v_actor := coalesce(public.ctx('actor_id')::uuid,
    case when tg_op = 'INSERT' then (v_row ->> 'created_by')::uuid else (v_row ->> 'updated_by')::uuid end);

  -- --------------------------------------------- Equipment / Sub-equipment / Golden board
  if tg_table_name in ('equipment', 'sub_equipment', 'golden_boards') then
    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then return null; end if;
    v_label := v_row ->> 'serial_number';
    v_asset := v_id;
    v_type := case tg_table_name when 'equipment' then 'equipment' when 'sub_equipment' then 'sub_equipment' else 'golden_board' end;
    if tg_op = 'INSERT' then
      v_action := 'CREATE';
    elsif tg_op = 'DELETE' then
      v_action := 'DELETE';
    elsif coalesce(v_action, '') not in ('SWAP', 'CHECK_OUT', 'CHECK_IN') then
      v_action := case
        when ('parent' = any (v_keys) or 'tester' = any (v_keys))
             and coalesce(v_new ->> 'parent_id', v_new ->> 'tester_id') is null then 'DETACH'
        when 'parent' = any (v_keys) or 'tester' = any (v_keys) then 'MOVE'
        when v_keys = array['location'] then 'CHANGE_LOCATION'
        when v_keys = array['tags'] then 'TAGS'
        else 'UPDATE' end;
    end if;

  -- ------------------------------------------------------------------------ Calibration
  elsif tg_table_name = 'calibrations' then
    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then return null; end if;
    v_asset := (v_row ->> 'sub_equipment_id')::uuid;
    v_type := 'sub_equipment';
    select serial_number into v_label from public.sub_equipment where id = v_asset;
    -- Sub-equipment đang bị xóa (các lần hiệu chuẩn xóa theo): nhật ký DELETE của nó đã chụp lại cả dòng.
    if v_label is null then return null; end if;
    v_action := case tg_op when 'INSERT' then 'CALIBRATE' when 'DELETE' then 'CALIBRATION_REMOVE' else 'CALIBRATION_UPDATE' end;
  end if;

  if v_type is not null then
    insert into public.asset_logs (asset_type, asset_id, label, action, old_value, new_value,
                                   from_location, to_location, reason, source, user_id, action_id)
    values (v_type, v_asset, v_label, v_action,
      case when tg_op = 'INSERT' then null else (select jsonb_object_agg(e.key, e.value -> 'old') from jsonb_each(v_changes) e) end,
      case when tg_op = 'DELETE' then null else (select jsonb_object_agg(e.key, e.value -> 'new') from jsonb_each(v_changes) e) end,
      v_changes -> 'location' ->> 'old', v_changes -> 'location' ->> 'new', v_note, v_source, v_actor, v_action_id);
    return null;
  end if;

  -- ------------------------------------------------------------ Configuration
  if tg_table_name in ('part_numbers', 'locations', 'types', 'type_groups', 'tags', 'levels', 'departments',
                       'calibration_configurations', 'calibration_vendors') then
    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then return null; end if;
    if tg_table_name = 'calibration_configurations' then
      v_label := public.history_ref_label('part_number_id', (v_row ->> 'part_number_id')::uuid);
    else
      v_label := v_row ->> 'display_name';
    end if;
    v_action := case tg_op when 'INSERT' then 'CREATE' when 'DELETE' then 'DELETE' else 'UPDATE' end;
    insert into public.configuration_histories (table_name, record_id, label, action, changes, note, source, created_by, action_id)
    values (tg_table_name, v_id, v_label, v_action, v_changes, v_note, v_source, v_actor, v_action_id);

  -- -------------------------------------------------------------- User profile
  elsif tg_table_name = 'user_profiles' then
    v_label := v_row ->> 'username';
    if tg_op = 'INSERT' then
      v_action := 'CREATE';
    elsif tg_op = 'DELETE' then
      return null;
    else
      -- PASSWORD_RESET do server đặt khi Admin đặt lại mật khẩu — ghi cả khi must_change_password vốn đã true.
      if v_changes = '{}'::jsonb and v_action is distinct from 'PASSWORD_RESET' then return null; end if;
      -- Người dùng tự đổi mật khẩu (must_change_password true → false, không có action): không ghi lịch sử.
      if v_action is null and v_keys = array['must_change_password']
         and (v_new ->> 'must_change_password')::boolean = false then
        return null;
      end if;
      v_action := coalesce(v_action, case
        when 'is_active' = any (v_keys) then case when (v_new ->> 'is_active')::boolean then 'ENABLE' else 'DISABLE' end
        when 'role' = any (v_keys) then 'ROLE_CHANGE'
        else 'UPDATE' end);
    end if;
    insert into public.user_histories (user_id, label, action, changes, note, source, created_by, action_id)
    values (v_id, v_label, v_action, v_changes, v_note, v_source, v_actor, v_action_id);
  end if;

  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['equipment', 'sub_equipment', 'golden_boards', 'calibrations', 'user_profiles',
    'part_numbers', 'locations', 'types', 'type_groups', 'tags', 'levels', 'departments',
    'calibration_configurations', 'calibration_vendors'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_write_history', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.write_history()', t || '_write_history', t);
  end loop;
end
$$;

-- =============================================================================
-- 2. app_write — thêm / sửa / xóa một dòng, kèm ngữ cảnh nhật ký
--    p_op: 'insert' | 'update' | 'delete'. Chỉ ghi các cột có trong p_data.
--    Trả về dòng sau khi ghi (delete: dòng trước khi xóa).
-- =============================================================================
-- Chữ ký mới thêm p_action_id: bỏ chữ ký cũ (cùng giao dịch với create bên dưới) để không còn hai hàm trùng tên.
create or replace function public.app_write(
  p_table  text,
  p_op     text,
  p_id     uuid,
  p_data   jsonb,
  p_actor  uuid,
  p_action text default null,
  p_note   text default null,
  p_source text default 'ui',
  p_action_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_allowed text[];
  v_cols    text;
  v_vals    text;
  v_sets    text;
  v_result  jsonb;
begin
  if p_table not in ('equipment', 'sub_equipment', 'golden_boards', 'calibrations', 'user_profiles',
                     'part_numbers', 'locations', 'types', 'type_groups', 'tags', 'levels', 'departments',
                     'calibration_configurations', 'calibration_vendors') then
    raise exception 'VALIDATION_ERROR' using detail = 'table not writable: ' || p_table;
  end if;
  if p_op = 'delete' and p_table = 'user_profiles' then
    raise exception 'VALIDATION_ERROR' using detail = 'accounts are disabled, never deleted';
  end if;

  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('action', p_action);
  perform public.set_ctx('note', p_note);
  perform public.set_ctx('source', coalesce(p_source, 'ui'));

  -- id chỉ được đặt khi thêm mới (tài khoản Supabase: id = id của Supabase Auth).
  select array_agg(column_name::text) into v_allowed
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table
    and column_name not in ('created_at', 'created_by', 'updated_at', 'updated_by')
    and (column_name <> 'id' or p_op = 'insert');

  select string_agg(format('%I', k), ', '),
         string_agg(format('r.%I', k), ', '),
         string_agg(format('%I = r.%I', k, k), ', ')
  into v_cols, v_vals, v_sets
  from jsonb_object_keys(coalesce(p_data, '{}'::jsonb)) k
  where k = any (v_allowed);

  if p_op = 'insert' then
    execute format(
      'insert into public.%I as t (%s created_by, updated_by)
       select %s $2, $2 from jsonb_populate_record(null::public.%I, $1) r
       returning to_jsonb(t.*)',
      p_table, coalesce(v_cols || ', ', ''), coalesce(v_vals || ', ', ''), p_table)
    using p_data, p_actor into v_result;
  elsif p_op = 'update' then
    execute format(
      'update public.%I as t set %s updated_by = $2
       from jsonb_populate_record(null::public.%I, $1) r
       where t.id = $3
       returning to_jsonb(t.*)',
      p_table, coalesce(v_sets || ', ', ''), p_table)
    using p_data, p_actor, p_id into v_result;
  elsif p_op = 'delete' then
    execute format('delete from public.%I as t where t.id = $1 returning to_jsonb(t.*)', p_table)
    using p_id into v_result;
  else
    raise exception 'VALIDATION_ERROR' using detail = 'unknown op: ' || p_op;
  end if;

  if v_result is null then raise exception 'NOT_FOUND'; end if;
  return v_result;
end;
$$;

-- =============================================================================
-- 2b. USER MANAGEMENT — bảo vệ Admin
--     Tài khoản là người dùng Supabase Auth (user_profiles.id = auth.users.id); Admin tạo, không tự đăng ký,
--     không xóa — chỉ khóa (is_active = false). Chặn ở database, mọi đường ghi:
--       · Admin tự khóa mình hoặc tự hạ quyền mình (ADMIN_SELF_CHANGE);
--       · khóa / hạ quyền Admin cuối cùng còn hoạt động (LAST_ADMIN).
-- =============================================================================
create or replace function public.user_admin_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
    if public.ctx('actor_id') = old.id::text then raise exception 'ADMIN_SELF_CHANGE'; end if;
    if not exists (select 1 from public.user_profiles u where u.id <> old.id and u.role = 'admin' and u.is_active) then
      raise exception 'LAST_ADMIN';
    end if;
  end if;
  return new;
end;
$$;
create trigger user_profiles_admin_guard before update of role, is_active on public.user_profiles
  for each row execute function public.user_admin_guard();

-- =============================================================================
-- 3. CÂY TÀI SẢN — Tester ⊃ Base ⊃ Fixture; sub-equipment và golden board gắn vào cây
--
--    Ai được nằm dưới ai (loại = types.kind; sub_equipment / golden_board là loại của bảng riêng):
--      tester  ⊃  base · fixture · sub_equipment · golden_board
--      base    ⊃  fixture
--      fixture ⊃  golden_board
--    Tester không có cha; mọi cấp khác có thể chưa gắn (cha trống = đang nằm kho).
--    Database chặn gắn sai (PARENT_TYPE_INVALID), mọi đường ghi.
--
--    Quy tắc Status (Usage):
--      · Chỉ Tester được In use khi không có cha; mọi loại khác cần cha (USAGE_NEEDS_PARENT). Mục 3d.
--      · Gắn vào cha / Move: tài sản lấy Usage của cha mới, nhánh con đi theo; Move LUÔN được, kể cả khi In use.
--        Không còn cha (Detach, cha bị xóa) → Not in use.
--      · Check-out RIÊNG một con cần cha In use (PARENT_NOT_IN_USE).
--    Con (cả nhánh) luôn đi theo khi Move / Swap / Đổi vị trí. Xóa một thiết bị: con trực tiếp thành chưa gắn
--    (Not in use), nhật ký DETACH, ghi chú parent_deleted:<SN>; muốn giữ con ở lại chỗ cũ thì Detach con trước.
--    Khóa ngoại equipment.parent_id là RESTRICT: không có đường nào xóa cả cây một cách âm thầm.
--
--    Chỉ có 6 hàm thao tác, dùng chung cho cả 3 loại tài sản qua p_type: asset_change_location, asset_move,
--    asset_detach, asset_swap, asset_delete, asset_set_usage (+ 3 hàm import). Mọi hàm có p_dry_run.
-- =============================================================================

-- Loại (types.kind) của một equipment.
create or replace function public.equipment_kind(p_id uuid) returns text
language sql stable set search_path = '' as $$
  select t.kind from public.equipment e join public.types t on t.id = e.type_id where e.id = p_id
$$;

-- Con thuộc loại p_child có được nằm dưới cha thuộc loại p_parent không.
create or replace function public.asset_parent_allowed(p_child text, p_parent text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_parent
    when 'tester'  then p_child in ('base', 'fixture', 'sub_equipment', 'golden_board')
    when 'base'    then p_child = 'fixture'
    when 'fixture' then p_child = 'golden_board'
    else false end
$$;

-- Con trực tiếp của một equipment, ở cả 3 bảng. asset_type: equipment / sub_equipment / golden_board.
create or replace function public.asset_children(p_type text, p_id uuid) returns table (asset_type text, id uuid)
language sql stable set search_path = '' as $$
  select 'equipment'::text, e.id from public.equipment e where p_type = 'equipment' and e.parent_id = p_id
  union all
  select 'sub_equipment'::text, s.id from public.sub_equipment s where p_type = 'equipment' and s.tester_id = p_id
  union all
  select 'golden_board'::text, g.id from public.golden_boards g where p_type = 'equipment' and g.parent_id = p_id
$$;

-- Một tài sản và toàn bộ con cháu, ở cả 3 bảng.
create or replace function public.asset_subtree(p_type text, p_id uuid) returns table (asset_type text, id uuid)
language sql stable set search_path = '' as $$
  with recursive tree (t, i) as (
    select p_type, p_id
    union all
    select c.asset_type, c.id from tree join lateral public.asset_children(tree.t, tree.i) c on true
  )
  select t, i from tree
$$;

create or replace function public.asset_usage(p_type text, p_id uuid) returns text
language sql stable set search_path = '' as $$
  select case p_type
    when 'equipment'     then (select usage from public.equipment where id = p_id)
    when 'sub_equipment' then (select usage from public.sub_equipment where id = p_id)
    when 'golden_board'  then (select usage from public.golden_boards where id = p_id) end
$$;

create or replace function public.asset_serial(p_type text, p_id uuid) returns text
language sql stable set search_path = '' as $$
  select case p_type
    when 'equipment'     then (select serial_number from public.equipment where id = p_id)
    when 'sub_equipment' then (select serial_number from public.sub_equipment where id = p_id)
    when 'golden_board'  then (select serial_number from public.golden_boards where id = p_id) end
$$;

-- Cha trực tiếp (equipment.parent_id / sub_equipment.tester_id / golden_boards.parent_id).
create or replace function public.asset_parent(p_type text, p_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select case p_type
    when 'equipment'     then (select parent_id from public.equipment where id = p_id)
    when 'sub_equipment' then (select tester_id from public.sub_equipment where id = p_id)
    when 'golden_board'  then (select parent_id from public.golden_boards where id = p_id) end
$$;

-- Khóa dòng của tài sản để thao tác; false nếu không tồn tại. Cũng kiểm tra p_type.
create or replace function public.asset_lock(p_type text, p_id uuid) returns boolean
language plpgsql set search_path = '' as $$
declare
  v uuid;
begin
  if p_type = 'equipment' then
    select id into v from public.equipment where id = p_id for update;
  elsif p_type = 'sub_equipment' then
    select id into v from public.sub_equipment where id = p_id for update;
  elsif p_type = 'golden_board' then
    select id into v from public.golden_boards where id = p_id for update;
  else
    raise exception 'VALIDATION_ERROR' using detail = 'unknown asset type';
  end if;
  return v is not null;
end;
$$;

-- Con cháu (không gồm chính nó) đổi vị trí theo equipment p_id — cả sub-equipment và golden board;
-- ghi chú "theo thiết bị cha".
create or replace function public.equipment_cascade_location(p_id uuid, p_actor uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_location uuid;
  v_serial   text;
begin
  select location_id, serial_number into v_location, v_serial from public.equipment where id = p_id;
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', 'via_parent:' || v_serial);
  update public.equipment set location_id = v_location, updated_by = p_actor
  where location_id is distinct from v_location
    and id in (select s.id from public.asset_subtree('equipment', p_id) s where s.asset_type = 'equipment' and s.id <> p_id);
  update public.sub_equipment set location_id = v_location, updated_by = p_actor
  where location_id is distinct from v_location
    and id in (select s.id from public.asset_subtree('equipment', p_id) s where s.asset_type = 'sub_equipment');
  update public.golden_boards set location_id = v_location, updated_by = p_actor
  where location_id is distinct from v_location
    and id in (select s.id from public.asset_subtree('equipment', p_id) s where s.asset_type = 'golden_board');
  perform public.set_ctx('note', null);
end;
$$;

-- Con cháu (không gồm chính nó) lấy Usage của tài sản p_id — cả 3 bảng; ghi chú "theo thiết bị cha".
create or replace function public.asset_cascade_usage(p_type text, p_id uuid, p_actor uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_usage  text := public.asset_usage(p_type, p_id);
  v_serial text := public.asset_serial(p_type, p_id);
begin
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', 'via_parent:' || v_serial);
  update public.equipment e set usage = v_usage, updated_by = p_actor
  where e.usage is distinct from v_usage
    and e.id in (select s.id from public.asset_subtree(p_type, p_id) s
                 where s.asset_type = 'equipment' and not (s.asset_type = p_type and s.id = p_id));
  update public.sub_equipment e set usage = v_usage, updated_by = p_actor
  where e.usage is distinct from v_usage
    and e.id in (select s.id from public.asset_subtree(p_type, p_id) s
                 where s.asset_type = 'sub_equipment' and not (s.asset_type = p_type and s.id = p_id));
  update public.golden_boards e set usage = v_usage, updated_by = p_actor
  where e.usage is distinct from v_usage
    and e.id in (select s.id from public.asset_subtree(p_type, p_id) s
                 where s.asset_type = 'golden_board' and not (s.asset_type = p_type and s.id = p_id));
  perform public.set_ctx('note', null);
end;
$$;

-- ---- Kết quả của hàm thao tác + xem trước (dry run) --------------------------------------
-- Mọi hàm thao tác (asset_*, các hàm import) nhận p_dry_run (mặc định false) và trả CÙNG một dạng jsonb:
--   { "dry_run": bool, "count": <số tài sản có thay đổi>, "deleted": <số tài sản bị xóa>,
--     "usage_changes": [ { asset_type, asset_id, label, from, to } ],   -- tài sản nào đổi Status, ví dụ in_use → not_in_use
--     "changes": [ { asset_type, asset_id, label, action, from_location, to_location, reason, old_value, new_value } ] }
-- p_dry_run = true: chạy ĐÚNG như thật — cùng kiểm tra, cùng mã lỗi (EQUIPMENT_IN_USE, SWAP_NO_CHANGE…) — rồi hoàn tác
-- toàn bộ; "changes" là những gì SẼ được ghi (màn hình "Kết quả" xem trước trước khi bấm nút chính).
-- Hàm import chỉ trả "count" (changes để trống, file có thể hàng nghìn dòng).

-- Các dòng asset_logs đã có trong giao dịch này (để biết thao tác vừa rồi ghi thêm những gì).
create or replace function public.asset_log_marks() returns uuid[]
language sql set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.asset_logs where created_at = transaction_timestamp()
$$;

create or replace function public.asset_op_result(p_marks uuid[], p_dry_run boolean, p_with_changes boolean default true) returns jsonb
language sql set search_path = '' as $$
  with new_logs as (
    select * from public.asset_logs l
    where l.created_at = transaction_timestamp() and l.id <> all (p_marks)
  )
  select jsonb_build_object(
    'dry_run', p_dry_run,
    'count', (select count(distinct (n.asset_type, n.asset_id)) from new_logs n),
    'deleted', (select count(*) from new_logs n where n.action = 'DELETE'),
    'usage_changes', coalesce((
        select jsonb_agg(jsonb_build_object('asset_type', u.asset_type, 'asset_id', u.asset_id, 'label', u.label,
                                            'from', u.old_usage, 'to', u.new_usage) order by u.asset_type, u.label, u.asset_id)
        from (select distinct n.asset_type, n.asset_id, n.label, n.old_value ->> 'usage' as old_usage, n.new_value ->> 'usage' as new_usage
              from new_logs n
              where n.action not in ('CREATE', 'DELETE') and n.old_value ? 'usage' and n.new_value ? 'usage') u), '[]'::jsonb),
    'changes', case when p_with_changes then coalesce((
        select jsonb_agg(jsonb_build_object(
          'asset_type', n.asset_type, 'asset_id', n.asset_id, 'label', n.label, 'action', n.action,
          'from_location', n.from_location, 'to_location', n.to_location, 'reason', n.reason,
          'old_value', n.old_value, 'new_value', n.new_value) order by n.asset_type, n.label, n.action, n.asset_id, n.reason)
        from new_logs n), '[]'::jsonb)
      else '[]'::jsonb end)
$$;

-- ---- 6 hàm thao tác cho cả 3 loại tài sản (p_type: equipment / sub_equipment / golden_board) ----
-- Sub-equipment và golden board là "lá" của cây: không có con.

-- Đổi vị trí — chỉ tài sản chưa gắn cha; đang In use thì không đổi được (EQUIPMENT_IN_USE).
-- Con cháu (cả sub-equipment, golden board) luôn đi theo.
create or replace function public.asset_change_location(
  p_type text, p_id uuid, p_location_id uuid, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_result jsonb;
begin
  if p_dry_run then
    begin
      v_result := public.asset_change_location(p_type, p_id, p_location_id, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if not public.asset_lock(p_type, p_id) then raise exception 'NOT_FOUND'; end if;
  if public.asset_parent(p_type, p_id) is not null then raise exception 'LOCATION_INHERITED_READ_ONLY'; end if;
  if public.asset_usage(p_type, p_id) = 'in_use' then raise exception 'EQUIPMENT_IN_USE'; end if;
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'ui');
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  if p_type = 'equipment' then
    update public.equipment set location_id = p_location_id, updated_by = p_actor where id = p_id;
    perform public.equipment_cascade_location(p_id, p_actor);
  elsif p_type = 'sub_equipment' then
    update public.sub_equipment set location_id = p_location_id, updated_by = p_actor where id = p_id;
  else
    update public.golden_boards set location_id = p_location_id, updated_by = p_actor where id = p_id;
  end if;
  return public.asset_op_result(v_marks, false);
end;
$$;

-- Gắn vào cha / đổi cha (Move). LUÔN được (chỉ theo quy tắc cây), kể cả khi đang In use: tài sản lấy vị trí, Level (equipment)
-- và Usage của cha mới, cả nhánh con đi theo — nên In use → Not in use khi cha mới Not in use (xem usage_changes của kết quả).
-- Cha mới phải đúng loại (PARENT_TYPE_INVALID); danh sách cha hợp lệ: valid_parents.
create or replace function public.asset_move(
  p_type text, p_id uuid, p_parent_id uuid, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_loc    uuid;
  v_usage  text;
  v_result jsonb;
begin
  if p_dry_run then
    begin
      v_result := public.asset_move(p_type, p_id, p_parent_id, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if not public.asset_lock(p_type, p_id) then raise exception 'NOT_FOUND'; end if;
  if p_type = 'equipment' and p_parent_id = p_id then raise exception 'PARENT_TYPE_INVALID'; end if;
  select location_id, usage into v_loc, v_usage from public.equipment where id = p_parent_id;
  if not found then raise exception 'PARENT_NOT_FOUND'; end if;
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'ui');
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  if p_type = 'equipment' then
    update public.equipment set parent_id = p_parent_id, location_id = v_loc, usage = v_usage, updated_by = p_actor where id = p_id;
    perform public.equipment_cascade_location(p_id, p_actor);
    perform public.asset_cascade_usage('equipment', p_id, p_actor);
  elsif p_type = 'sub_equipment' then
    update public.sub_equipment set tester_id = p_parent_id, updated_by = p_actor where id = p_id;
  else
    update public.golden_boards set parent_id = p_parent_id, updated_by = p_actor where id = p_id;
  end if;
  return public.asset_op_result(v_marks, false);
end;
$$;

-- Tách khỏi cha — giữ vị trí hiện tại; tài sản (và con cháu) về Not in use. Được cả khi đang In use.
create or replace function public.asset_detach(
  p_type text, p_id uuid, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_result jsonb;
begin
  if p_dry_run then
    begin
      v_result := public.asset_detach(p_type, p_id, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if not public.asset_lock(p_type, p_id) then raise exception 'NOT_FOUND'; end if;
  if public.asset_parent(p_type, p_id) is null then raise exception 'EQUIPMENT_HAS_NO_PARENT'; end if;
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'ui');
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  if p_type = 'equipment' then
    update public.equipment set parent_id = null, usage = 'not_in_use', updated_by = p_actor where id = p_id;
    perform public.asset_cascade_usage('equipment', p_id, p_actor);
  elsif p_type = 'sub_equipment' then
    update public.sub_equipment set tester_id = null, updated_by = p_actor where id = p_id;
  else
    update public.golden_boards set parent_id = null, updated_by = p_actor where id = p_id;
  end if;
  return public.asset_op_result(v_marks, false);
end;
$$;

-- Đổi chỗ hai tài sản CÙNG loại: equipment cùng Type, sub-equipment cùng Type (SWAP_TYPE_MISMATCH), golden board bất kỳ.
-- Mỗi bên nhận cha + vị trí của bên kia; equipment còn đổi Usage cho nhau (Usage đi theo chỗ), sub-equipment / golden
-- board lấy Usage của cha mới (Not in use nếu cha trống). Con cháu luôn đi theo. Nhật ký mỗi bên một dòng SWAP,
-- ghi chú swap_with:<SN>. Không thay đổi gì (cùng cha, cùng vị trí) → SWAP_NO_CHANGE.
-- Danh sách tài sản hợp lệ để swap: swap_candidates.
create or replace function public.asset_swap(
  p_type text, p_a uuid, p_b uuid, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_result jsonb;
  a_type uuid; a_parent uuid; a_loc uuid; a_usage text; a_serial text;
  b_type uuid; b_parent uuid; b_loc uuid; b_usage text; b_serial text;
begin
  if p_dry_run then
    begin
      v_result := public.asset_swap(p_type, p_a, p_b, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if p_a = p_b then raise exception 'VALIDATION_ERROR' using detail = 'cannot swap an asset with itself'; end if;
  if not public.asset_lock(p_type, p_a) or not public.asset_lock(p_type, p_b) then raise exception 'NOT_FOUND'; end if;
  if p_type = 'equipment' then
    select type_id, parent_id, location_id, usage, serial_number into a_type, a_parent, a_loc, a_usage, a_serial from public.equipment where id = p_a;
    select type_id, parent_id, location_id, usage, serial_number into b_type, b_parent, b_loc, b_usage, b_serial from public.equipment where id = p_b;
  elsif p_type = 'sub_equipment' then
    select type_id, tester_id, location_id, usage, serial_number into a_type, a_parent, a_loc, a_usage, a_serial from public.sub_equipment where id = p_a;
    select type_id, tester_id, location_id, usage, serial_number into b_type, b_parent, b_loc, b_usage, b_serial from public.sub_equipment where id = p_b;
  else
    select parent_id, location_id, serial_number into a_parent, a_loc, a_serial from public.golden_boards where id = p_a;
    select parent_id, location_id, serial_number into b_parent, b_loc, b_serial from public.golden_boards where id = p_b;
  end if;
  if a_type is distinct from b_type then raise exception 'SWAP_TYPE_MISMATCH'; end if;
  if a_parent is not distinct from b_parent and a_loc = b_loc then raise exception 'SWAP_NO_CHANGE'; end if;

  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'ui');
  perform public.set_ctx('action', 'SWAP');
  perform public.set_ctx('note', 'swap_with:' || b_serial);
  if p_type = 'equipment' then
    update public.equipment set parent_id = b_parent, location_id = b_loc, usage = b_usage, updated_by = p_actor where id = p_a;
    perform public.set_ctx('note', 'swap_with:' || a_serial);
    update public.equipment set parent_id = a_parent, location_id = a_loc, usage = a_usage, updated_by = p_actor where id = p_b;
  elsif p_type = 'sub_equipment' then
    update public.sub_equipment set tester_id = b_parent, location_id = b_loc, updated_by = p_actor where id = p_a;
    perform public.set_ctx('note', 'swap_with:' || a_serial);
    update public.sub_equipment set tester_id = a_parent, location_id = a_loc, updated_by = p_actor where id = p_b;
  else
    update public.golden_boards set parent_id = b_parent, location_id = b_loc, updated_by = p_actor where id = p_a;
    perform public.set_ctx('note', 'swap_with:' || a_serial);
    update public.golden_boards set parent_id = a_parent, location_id = a_loc, updated_by = p_actor where id = p_b;
  end if;
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  if p_type = 'equipment' then
    perform public.equipment_cascade_location(p_a, p_actor);
    perform public.equipment_cascade_location(p_b, p_actor);
    perform public.asset_cascade_usage('equipment', p_a, p_actor);
    perform public.asset_cascade_usage('equipment', p_b, p_actor);
  end if;
  return public.asset_op_result(v_marks, false);
end;
$$;

-- Xóa tài sản thật (đang In use thì chặn: EQUIPMENT_IN_USE). Con trực tiếp (equipment, sub-equipment, golden board) luôn
-- được GIỮ và thành chưa gắn: Not in use (cả nhánh của con theo), nhật ký DETACH, ghi chú parent_deleted:<SN>; không tự gắn
-- lên ông. Lần hiệu chuẩn của sub-equipment xóa theo (nhật ký DELETE đã chụp lại cả dòng).
create or replace function public.asset_delete(
  p_type text, p_id uuid, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_serial text;
  v_result jsonb;
  r        record;
begin
  if p_dry_run then
    begin
      v_result := public.asset_delete(p_type, p_id, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if not public.asset_lock(p_type, p_id) then raise exception 'NOT_FOUND'; end if;
  if public.asset_usage(p_type, p_id) = 'in_use' then raise exception 'EQUIPMENT_IN_USE'; end if;
  v_serial := public.asset_serial(p_type, p_id);
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'ui');
  perform public.set_ctx('action', null);
  for r in select c.asset_type as t, c.id as i from public.asset_children(p_type, p_id) c loop
    perform public.set_ctx('note', 'parent_deleted:' || v_serial);
    if r.t = 'equipment' then
      update public.equipment set parent_id = null, usage = 'not_in_use', updated_by = p_actor where id = r.i;
      perform public.asset_cascade_usage('equipment', r.i, p_actor);
    elsif r.t = 'sub_equipment' then
      update public.sub_equipment set tester_id = null, updated_by = p_actor where id = r.i;
    else
      update public.golden_boards set parent_id = null, updated_by = p_actor where id = r.i;
    end if;
  end loop;
  perform public.set_ctx('note', null);
  if p_type = 'equipment' then
    delete from public.equipment where id = p_id;
  elsif p_type = 'sub_equipment' then
    delete from public.sub_equipment where id = p_id;
  else
    delete from public.golden_boards where id = p_id;
  end if;
  return public.asset_op_result(v_marks, false);
end;
$$;

-- Check-out / Check-in: p_usage = 'in_use' (Check-out) hoặc 'not_in_use' (Check-in) cho các tài sản
-- p_refs ([{"type": "equipment", "id": "<id>"}, …]) VÀ toàn bộ con cháu của chúng (cả 3 bảng), trong một
-- giao dịch. Nhật ký: CHECK_OUT / CHECK_IN kèm ghi chú p_note. Không tài sản nào đổi → USAGE_NO_CHANGE.
-- Check-out RIÊNG một con thì cha phải In use (PARENT_NOT_IN_USE) — trừ khi cha cũng nằm trong lần Check-out này.
-- (Đây là chỗ duy nhất dùng PARENT_NOT_IN_USE: Move không bị chặn vì In use.)
create or replace function public.asset_set_usage(
  p_refs jsonb, p_usage text, p_actor uuid, p_note text default null, p_dry_run boolean default false, p_action_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_total  integer := 0;
  v_count  integer;
  v_parent uuid;
  v_result jsonb;
  r        record;
begin
  if p_dry_run then
    begin
      v_result := public.asset_set_usage(p_refs, p_usage, p_actor, p_note, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if p_usage not in ('in_use', 'not_in_use') then
    raise exception 'VALIDATION_ERROR' using detail = 'usage must be in_use or not_in_use';
  end if;
  if jsonb_typeof(p_refs) is distinct from 'array' or jsonb_array_length(p_refs) = 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'no assets';
  end if;
  for r in select x ->> 'type' as t, (x ->> 'id')::uuid as i from jsonb_array_elements(p_refs) x loop
    if r.t not in ('equipment', 'sub_equipment', 'golden_board') then
      raise exception 'VALIDATION_ERROR' using detail = 'unknown asset type';
    end if;
    if public.asset_serial(r.t, r.i) is null then raise exception 'NOT_FOUND'; end if;
  end loop;
  if p_usage = 'in_use' then
    for r in select x ->> 'type' as t, (x ->> 'id')::uuid as i from jsonb_array_elements(p_refs) x loop
      continue when public.asset_usage(r.t, r.i) = 'in_use';
      v_parent := public.asset_parent(r.t, r.i);
      if v_parent is not null and public.asset_usage('equipment', v_parent) <> 'in_use' and not exists (
        select 1 from jsonb_array_elements(p_refs) x,
          lateral public.asset_subtree(x ->> 'type', (x ->> 'id')::uuid) s
        where s.asset_type = 'equipment' and s.id = v_parent
      ) then
        raise exception 'PARENT_NOT_IN_USE' using detail = public.asset_serial('equipment', v_parent);
      end if;
    end loop;
  end if;
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'ui');
  perform public.set_ctx('action', case p_usage when 'in_use' then 'CHECK_OUT' else 'CHECK_IN' end);
  perform public.set_ctx('note', p_note);

  with refs as (select x ->> 'type' as t, (x ->> 'id')::uuid as i from jsonb_array_elements(p_refs) x),
       tree as (select distinct s.asset_type, s.id from refs, lateral public.asset_subtree(refs.t, refs.i) s)
  update public.equipment e set usage = p_usage, updated_by = p_actor
  from tree where tree.asset_type = 'equipment' and tree.id = e.id and e.usage is distinct from p_usage;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  with refs as (select x ->> 'type' as t, (x ->> 'id')::uuid as i from jsonb_array_elements(p_refs) x),
       tree as (select distinct s.asset_type, s.id from refs, lateral public.asset_subtree(refs.t, refs.i) s)
  update public.sub_equipment e set usage = p_usage, updated_by = p_actor
  from tree where tree.asset_type = 'sub_equipment' and tree.id = e.id and e.usage is distinct from p_usage;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  with refs as (select x ->> 'type' as t, (x ->> 'id')::uuid as i from jsonb_array_elements(p_refs) x),
       tree as (select distinct s.asset_type, s.id from refs, lateral public.asset_subtree(refs.t, refs.i) s)
  update public.golden_boards e set usage = p_usage, updated_by = p_actor
  from tree where tree.asset_type = 'golden_board' and tree.id = e.id and e.usage is distinct from p_usage;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  if v_total = 0 then raise exception 'USAGE_NO_CHANGE'; end if;
  return public.asset_op_result(v_marks, false);
end;
$$;

-- Thêm equipment con (form, Thêm thiết bị con, Import) → lấy Usage của cha đang In use / Not in use.
-- Cha chưa có (Import: dòng cha nằm sau trong cùng file) → giữ giá trị mặc định.
create or replace function public.equipment_usage_from_parent() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_usage text;
begin
  if new.parent_id is not null then
    select usage into v_usage from public.equipment where id = new.parent_id;
    if found then new.usage := v_usage; end if;
  end if;
  return new;
end;
$$;

-- ---- Import Excel — thêm nhiều dòng trong MỘT giao dịch: lỗi một dòng thì không dòng nào được ghi.
-- Server đã kiểm tra từng dòng trước khi gọi; p_dry_run kiểm tra lại cả file bằng chính database (mọi trigger)
-- rồi hoàn tác. Nhật ký: CREATE cho từng dòng, source = import. Kết quả: "count" = số dòng.

-- equipment: server đặt sẵn id để dòng con trỏ được tới dòng cha trong cùng file (parent_id), và đặt location_id của
-- dòng con = vị trí của cha. Quy tắc cha–con kiểm tra sau khi cả file đã vào bảng. Server cũng đã quyết usage (Status: theo cha,
-- hoặc ô Status, hoặc Not in use) và tag_ids; thiếu thì Not in use và không có thẻ (app cũ không gửi hai trường này).
create or replace function public.equipment_import(p_rows jsonb, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_result jsonb;
begin
  if p_dry_run then
    begin
      v_result := public.equipment_import(p_rows, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'no rows';
  end if;
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'import');
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  insert into public.equipment
    (id, serial_number, jabil_id, part_number_id, asset, type_id, level_id, location_id, parent_id, remark,
     usage, tag_ids, created_by, updated_by)
  select coalesce(r.id, gen_random_uuid()), r.serial_number, r.jabil_id, r.part_number_id, r.asset, r.type_id, r.level_id,
         r.location_id, r.parent_id, r.remark, coalesce(r.usage, 'not_in_use'), coalesce(r.tag_ids, '{}'), p_actor, p_actor
  from jsonb_populate_recordset(null::public.equipment, p_rows) r;
  return public.asset_op_result(v_marks, false, false);
end;
$$;

create or replace function public.sub_equipment_import(p_rows jsonb, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_result jsonb;
begin
  if p_dry_run then
    begin
      v_result := public.sub_equipment_import(p_rows, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'no rows';
  end if;
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'import');
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  insert into public.sub_equipment
    (serial_number, jabil_id, part_number_id, asset, type_id, tester_id, location_id, remark, created_by, updated_by)
  select r.serial_number, r.jabil_id, r.part_number_id, r.asset, r.type_id, r.tester_id, r.location_id, r.remark,
         p_actor, p_actor
  from jsonb_populate_recordset(null::public.sub_equipment, p_rows) r;
  return public.asset_op_result(v_marks, false, false);
end;
$$;

create or replace function public.golden_import(p_rows jsonb, p_actor uuid, p_dry_run boolean default false, p_action_id uuid default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_marks  uuid[] := public.asset_log_marks();
  v_result jsonb;
begin
  if p_dry_run then
    begin
      v_result := public.golden_import(p_rows, p_actor, false, p_action_id);
      raise exception 'dry run' using errcode = 'DRY01';
    exception when sqlstate 'DRY01' then
      return jsonb_set(v_result, '{dry_run}', 'true');
    end;
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'no rows';
  end if;
  perform public.set_ctx('actor_id', p_actor::text);
  perform public.set_ctx('action_id', coalesce(p_action_id, gen_random_uuid())::text);
  perform public.set_ctx('source', 'import');
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', null);
  insert into public.golden_boards
    (part_number, serial_number, utd_part_number, parent_id, location_id, origin, purpose, remark, created_by, updated_by)
  select r.part_number, r.serial_number, r.utd_part_number, r.parent_id, r.location_id, r.origin, r.purpose, r.remark,
         p_actor, p_actor
  from jsonb_populate_recordset(null::public.golden_boards, p_rows) r;
  return public.asset_op_result(v_marks, false, false);
end;
$$;

-- ---- Tra cứu cho màn hình thao tác (chỉ đọc) ------------------------------------------------

-- Cha hợp lệ để gắn một tài sản vào (ô "Thiết bị cha" / "Tester" / "Gắn vào" và màn hình Move): equipment đúng loại cha
-- theo quy tắc cha–con. Tài sản có sẵn: p_type + p_id; thêm mới (chưa có id): p_type + p_kind (tester / base / fixture khi
-- p_type = equipment). Không chặn theo Usage: Move luôn được. `usage_after` = Status của tài sản SAU khi gắn vào cha đó
-- (tài sản lấy Usage của cha) để modal hiển thị, ví dụ "In use → Not in use". p_q: lọc theo serial / part number.
create or replace function public.valid_parents(
  p_type text, p_id uuid default null, p_kind text default null, p_q text default null, p_limit integer default 50
) returns table (
  id uuid, kind text, serial_number text, part_number text, type_name text,
  location_id uuid, location text, usage text, usage_after text
)
language plpgsql stable set search_path = '' as $$
declare
  v_child text;
  v_like  text := case when nullif(btrim(p_q), '') is null then null
                  else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
begin
  if p_type = 'equipment' then
    v_child := coalesce(p_kind, case when p_id is null then null else public.equipment_kind(p_id) end);
    if v_child is null then raise exception 'VALIDATION_ERROR' using detail = 'kind required'; end if;
  elsif p_type in ('sub_equipment', 'golden_board') then
    v_child := p_type;
  else
    raise exception 'VALIDATION_ERROR' using detail = 'unknown asset type';
  end if;
  return query
  select e.id, t.kind, e.serial_number, pn.display_name, t.display_name, e.location_id, l.display_name, e.usage, e.usage
  from public.equipment e
  join public.types t on t.id = e.type_id
  join public.part_numbers pn on pn.id = e.part_number_id
  join public.locations l on l.id = e.location_id
  where public.asset_parent_allowed(v_child, t.kind)
    and (v_like is null or e.serial_number ilike v_like or pn.display_name ilike v_like)
  order by e.serial_number, e.id
  limit greatest(coalesce(p_limit, 50), 1);
end;
$$;

-- Tài sản có thể Swap với p_id (màn hình Swap chỉ liệt kê các dòng này): equipment cùng Type, sub-equipment cùng Type,
-- golden board bất kỳ; không gồm chính nó. `same_place` = cùng cha và cùng vị trí với p_id → Swap sẽ báo SWAP_NO_CHANGE.
create or replace function public.swap_candidates(
  p_type text, p_id uuid, p_q text default null, p_limit integer default 50
) returns table (
  asset_type text, id uuid, kind text, serial_number text, part_number text, type_name text,
  parent_id uuid, parent_serial text, location_id uuid, location text, usage text, same_place boolean
)
language plpgsql stable set search_path = '' as $$
declare
  v_like text := case when nullif(btrim(p_q), '') is null then null
                 else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_type uuid;
  v_parent uuid;
  v_loc uuid;
begin
  if p_type = 'equipment' then
    select e.type_id, e.parent_id, e.location_id into v_type, v_parent, v_loc from public.equipment e where e.id = p_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    return query
    select 'equipment'::text, e.id, t.kind, e.serial_number, pn.display_name, t.display_name,
           e.parent_id, par.serial_number, e.location_id, l.display_name, e.usage,
           (e.parent_id is not distinct from v_parent and e.location_id = v_loc)
    from public.equipment e
    join public.types t on t.id = e.type_id
    join public.part_numbers pn on pn.id = e.part_number_id
    join public.locations l on l.id = e.location_id
    left join public.equipment par on par.id = e.parent_id
    where e.type_id = v_type and e.id <> p_id
      and (v_like is null or e.serial_number ilike v_like or pn.display_name ilike v_like)
    order by e.serial_number, e.id limit greatest(coalesce(p_limit, 50), 1);
  elsif p_type = 'sub_equipment' then
    select s.type_id, s.tester_id, s.location_id into v_type, v_parent, v_loc from public.sub_equipment s where s.id = p_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    return query
    select 'sub_equipment'::text, s.id, 'sub_equipment'::text, s.serial_number, pn.display_name, t.display_name,
           s.tester_id, par.serial_number, s.location_id, l.display_name, s.usage,
           (s.tester_id is not distinct from v_parent and s.location_id = v_loc)
    from public.sub_equipment s
    join public.types t on t.id = s.type_id
    join public.part_numbers pn on pn.id = s.part_number_id
    join public.locations l on l.id = s.location_id
    left join public.equipment par on par.id = s.tester_id
    where s.type_id = v_type and s.id <> p_id
      and (v_like is null or s.serial_number ilike v_like or pn.display_name ilike v_like)
    order by s.serial_number, s.id limit greatest(coalesce(p_limit, 50), 1);
  elsif p_type = 'golden_board' then
    select g.parent_id, g.location_id into v_parent, v_loc from public.golden_boards g where g.id = p_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    return query
    select 'golden_board'::text, g.id, 'golden_board'::text, g.serial_number, g.part_number, null::text,
           g.parent_id, par.serial_number, g.location_id, l.display_name, g.usage,
           (g.parent_id is not distinct from v_parent and g.location_id = v_loc)
    from public.golden_boards g
    join public.locations l on l.id = g.location_id
    left join public.equipment par on par.id = g.parent_id
    where g.id <> p_id
      and (v_like is null or g.serial_number ilike v_like or g.part_number ilike v_like)
    order by g.serial_number, g.id limit greatest(coalesce(p_limit, 50), 1);
  else
    raise exception 'VALIDATION_ERROR' using detail = 'unknown asset type';
  end if;
end;
$$;

-- Serial trùng: mọi tài sản (cả 3 bảng) có cùng serial — đã cắt khoảng trắng, không phân biệt hoa/thường.
-- Giao diện gọi trước khi lưu; trùng thì hiện cảnh báo nhưng vẫn lưu được. p_exclude_*: bỏ chính bản ghi đang sửa.
-- Dùng index lower(serial_number) của từng bảng.
create or replace function public.serial_matches(
  p_serial text, p_exclude_type text default null, p_exclude_id uuid default null
) returns table (asset_type text, id uuid, serial_number text, part_number text, location text)
language sql stable set search_path = '' as $$
  select 'equipment'::text, e.id, e.serial_number, pn.display_name, l.display_name
  from public.equipment e
  join public.part_numbers pn on pn.id = e.part_number_id
  join public.locations l on l.id = e.location_id
  where lower(e.serial_number) = lower(btrim(p_serial))
    and (p_exclude_type is distinct from 'equipment' or e.id is distinct from p_exclude_id)
  union all
  select 'sub_equipment'::text, s.id, s.serial_number, pn.display_name, l.display_name
  from public.sub_equipment s
  join public.part_numbers pn on pn.id = s.part_number_id
  join public.locations l on l.id = s.location_id
  where lower(s.serial_number) = lower(btrim(p_serial))
    and (p_exclude_type is distinct from 'sub_equipment' or s.id is distinct from p_exclude_id)
  union all
  select 'golden_board'::text, g.id, g.serial_number, g.part_number, l.display_name
  from public.golden_boards g
  join public.locations l on l.id = g.location_id
  where lower(g.serial_number) = lower(btrim(p_serial))
    and (p_exclude_type is distinct from 'golden_board' or g.id is distinct from p_exclude_id)
$$;

-- =============================================================================
-- 3a. SERIAL — database tự cắt khoảng trắng hai đầu (so sánh serial trùng cũng trim).
--     Serial KHÔNG UQ: trùng chỉ cảnh báo trước khi lưu (server kiểm tra cả 3 bảng).
-- =============================================================================
create or replace function public.serial_trim() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.serial_number := btrim(new.serial_number);
  return new;
end;
$$;
create trigger equipment_00_serial_trim before insert or update of serial_number on public.equipment
  for each row execute function public.serial_trim();
create trigger sub_equipment_00_serial_trim before insert or update of serial_number on public.sub_equipment
  for each row execute function public.serial_trim();
create trigger golden_boards_00_serial_trim before insert or update of serial_number on public.golden_boards
  for each row execute function public.serial_trim();

-- =============================================================================
-- 3b. TYPE — theo Part Number, và quy tắc cha–con
--     equipment / sub_equipment luôn mang đúng Type của part number (cả hai bắt buộc), dù ghi từ form,
--     Import Excel hay script (Type gửi lên bị thay). Type phải đúng loại của bảng: equipment dùng
--     kind tester / base / fixture, sub_equipment dùng kind sub_equipment (TYPE_KIND_INVALID).
--     Type của part number chỉ đổi được khi chưa thiết bị nào dùng part number đó (PART_NUMBER_IN_USE) — nên không
--     phải lan Type sang thiết bị. Type của một equipment không đổi sau khi tạo: đổi part number của nó chỉ sang
--     part number cùng Type (TYPE_KIND_INVALID). Setup hiệu chuẩn chỉ cho part number kind sub_equipment.
--     3 loại hệ thống (tester / base / fixture) không xóa, không ẩn, không đổi kind.
--     Nhóm của Type (type_groups, Configuration › Group): types.kind luôn bằng kind của nhóm (types_00_group_kind), nên
--     Type của Admin (kind sub_equipment) chỉ đổi giữa các nhóm sub_equipment — sang nhóm hệ thống thì types_system_lock
--     chặn (TYPE_SYSTEM_LOCKED). 3 nhóm hệ thống khóa như 3 Type: không xóa, không ẩn, không đổi kind.
-- =============================================================================
create or replace function public.asset_type_from_part_number() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_type uuid;
  v_kind text;
begin
  select pn.type_id, t.kind into v_type, v_kind
  from public.part_numbers pn join public.types t on t.id = pn.type_id
  where pn.id = new.part_number_id;
  if found then
    if tg_table_name = 'equipment' and v_kind not in ('tester', 'base', 'fixture') then
      raise exception 'TYPE_KIND_INVALID';
    end if;
    if tg_table_name = 'sub_equipment' and v_kind <> 'sub_equipment' then
      raise exception 'TYPE_KIND_INVALID';
    end if;
    if tg_op = 'UPDATE' and tg_table_name = 'equipment' and old.type_id is distinct from v_type then
      raise exception 'TYPE_KIND_INVALID';
    end if;
    new.type_id := v_type;
  end if;
  return new;
end;
$$;
create trigger equipment_01_type_from_part_number
  before insert or update of part_number_id, type_id on public.equipment
  for each row execute function public.asset_type_from_part_number();
create trigger sub_equipment_01_type_from_part_number
  before insert or update of part_number_id, type_id on public.sub_equipment
  for each row execute function public.asset_type_from_part_number();

-- Đổi Type của part number khi đã có thiết bị dùng → PART_NUMBER_IN_USE.
create or replace function public.part_number_type_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.equipment where part_number_id = new.id)
     or exists (select 1 from public.sub_equipment where part_number_id = new.id) then
    raise exception 'PART_NUMBER_IN_USE';
  end if;
  return new;
end;
$$;
create trigger part_numbers_type_guard
  before update of type_id on public.part_numbers
  for each row when (new.type_id is distinct from old.type_id)
  execute function public.part_number_type_guard();

create or replace function public.types_system_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.kind <> 'sub_equipment' then raise exception 'TYPE_SYSTEM_LOCKED'; end if;
    return old;
  end if;
  if new.kind is distinct from old.kind then raise exception 'TYPE_SYSTEM_LOCKED'; end if;
  if old.kind <> 'sub_equipment' and not new.is_active then raise exception 'TYPE_SYSTEM_LOCKED'; end if;
  return new;
end;
$$;
create trigger types_system_lock before update or delete on public.types
  for each row execute function public.types_system_lock();

-- Type luôn mang kind của nhóm. Chạy trước types_system_lock (tên 00_ đứng trước theo thứ tự chữ cái): đổi nhóm sang nhóm khác
-- kind thì kind đổi theo và types_system_lock chặn. Sửa riêng cột kind không qua trigger này → vẫn bị types_system_lock chặn.
-- Thêm Type không nói nhóm (script, Import…): lấy nhóm đầu tiên cùng kind (kind mặc định sub_equipment; đang dùng trước, rồi theo thứ tự).
create or replace function public.types_group_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.group_id is null and tg_op = 'INSERT' then
    select g.id into new.group_id from public.type_groups g where g.kind = new.kind
    order by g.is_active desc, g.sort_order, g.created_at limit 1;
  end if;
  select g.kind into new.kind from public.type_groups g where g.id = new.group_id;
  return new;
end;
$$;
create trigger types_00_group_kind before insert or update of group_id on public.types
  for each row execute function public.types_group_kind();

-- 3 nhóm hệ thống (tester / base / fixture) không xóa, không ẩn, không đổi kind; nhóm Admin thêm thì ẩn / sửa tự do
-- (xóa nhóm đang có Type thì khóa ngoại chặn; app chỉ cho ẩn).
create or replace function public.type_groups_system_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.kind <> 'sub_equipment' then raise exception 'TYPE_SYSTEM_LOCKED'; end if;
    return old;
  end if;
  if new.kind is distinct from old.kind then raise exception 'TYPE_SYSTEM_LOCKED'; end if;
  if old.kind <> 'sub_equipment' and not new.is_active then raise exception 'TYPE_SYSTEM_LOCKED'; end if;
  return new;
end;
$$;
create trigger type_groups_system_lock before update or delete on public.type_groups
  for each row execute function public.type_groups_system_lock();

-- Quy tắc cha–con của equipment (kiểm tra SAU câu lệnh để Import Excel có dòng cha nằm sau trong cùng file):
-- cha phải đúng loại (asset_parent_allowed). Loại của một equipment không đổi nên con hiện có luôn còn hợp lệ.
create or replace function public.equipment_parent_rule() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_kind text;
begin
  if new.parent_id is not null then
    select t.kind into v_kind from public.types t where t.id = new.type_id;
    if not public.asset_parent_allowed(v_kind, public.equipment_kind(new.parent_id)) then
      raise exception 'PARENT_TYPE_INVALID';
    end if;
  end if;
  return null;
end;
$$;
create trigger equipment_parent_rule after insert or update of parent_id on public.equipment
  for each row execute function public.equipment_parent_rule();

-- Sub-equipment (cột tester_id) và golden board (cột parent_id): cha phải là equipment đúng loại; có cha thì
-- luôn cùng vị trí với cha; gắn vào cha / đổi cha thì lấy Usage của cha; không còn cha thì Not in use.
-- tg_argv[0] = tên cột cha, tg_argv[1] = loại của bảng (sub_equipment / golden_board).
create or replace function public.leaf_from_parent() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_parent uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_old    uuid := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> tg_argv[0])::uuid end;
  v_kind   text;
  v_loc    uuid;
  v_usage  text;
begin
  if v_parent is not null then
    select e.location_id, e.usage, t.kind into v_loc, v_usage, v_kind
    from public.equipment e join public.types t on t.id = e.type_id where e.id = v_parent;
    if not found then raise exception 'PARENT_NOT_FOUND'; end if;
    if not public.asset_parent_allowed(tg_argv[1], v_kind) then raise exception 'PARENT_TYPE_INVALID'; end if;
    new.location_id := v_loc;
    if tg_op = 'INSERT' or v_parent is distinct from v_old then new.usage := v_usage; end if;
  elsif tg_op = 'UPDATE' and v_old is not null then
    new.usage := 'not_in_use';
  end if;
  return new;
end;
$$;
create trigger sub_equipment_02_from_parent before insert or update of tester_id, location_id on public.sub_equipment
  for each row execute function public.leaf_from_parent('tester_id', 'sub_equipment');
create trigger golden_boards_01_from_parent before insert or update of parent_id, location_id on public.golden_boards
  for each row execute function public.leaf_from_parent('parent_id', 'golden_board');

-- =============================================================================
-- 3c. EQUIPMENT — Level theo thiết bị cha (như vị trí)
--     Có cha → luôn mang Level của cha, dù ghi từ form, Đổi cha, Swap, Import hay
--     script (Level gửi lên bị thay). Không có cha → Level chọn tay; Tách khỏi cha
--     giữ Level đang có. Cha đổi Level → cả cây equipment con đổi theo; nhật ký của con ghi
--     ghi chú via_parent:<SN>. Sub-equipment và golden board không có Level.
-- =============================================================================
create or replace function public.equipment_level_from_parent() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_level uuid;
begin
  if new.parent_id is not null then
    -- Cha chưa có (Import: dòng cha nằm sau trong cùng file) → giữ giá trị server đã đặt theo cha.
    select level_id into v_level from public.equipment where id = new.parent_id;
    if found then new.level_id := v_level; end if;
  end if;
  return new;
end;
$$;
create trigger equipment_02_level_from_parent
  before insert or update of parent_id, level_id on public.equipment
  for each row execute function public.equipment_level_from_parent();

create trigger equipment_03_usage_from_parent before insert on public.equipment
  for each row execute function public.equipment_usage_from_parent();

-- Chạy trước equipment_write_history (theo thứ tự tên) → trả lại ngữ cảnh để nhật ký
-- của chính thiết bị giữ đúng hành động / ghi chú (ví dụ SWAP, swap_with:<SN>).
create or replace function public.equipment_level_cascade() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_action text := public.ctx('action');
  v_note   text := public.ctx('note');
begin
  perform public.set_ctx('action', null);
  perform public.set_ctx('note', 'via_parent:' || new.serial_number);
  update public.equipment
     set level_id = new.level_id, updated_by = coalesce(public.ctx('actor_id')::uuid, new.updated_by)
   where parent_id = new.id and level_id is distinct from new.level_id;
  perform public.set_ctx('action', v_action);
  perform public.set_ctx('note', v_note);
  return null;
end;
$$;
-- Không dùng "update of level_id": Đổi cha / Swap đổi Level qua trigger trên (cột không
-- nằm trong câu update) — vẫn phải lan xuống con.
create trigger equipment_level_cascade
  after update on public.equipment
  for each row when (new.level_id is distinct from old.level_id)
  execute function public.equipment_level_cascade();

-- =============================================================================
-- 3d. USAGE cần cha — quy tắc cố định cho cả 3 bảng
--     Chỉ Tester được In use khi không có cha. Base / Fixture / sub-equipment / golden board cần cha mới In use được
--     (USAGE_NEEDS_PARENT) — dù Check-out, Swap hay script. Tách khỏi cha (hoặc cha bị xóa) → Not in use.
-- =============================================================================
create or replace function public.asset_usage_rule() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.usage = 'in_use'
     and coalesce(to_jsonb(new) ->> 'parent_id', to_jsonb(new) ->> 'tester_id') is null
     and not exists (select 1 from public.types t
                     where t.id = (to_jsonb(new) ->> 'type_id')::uuid and t.kind = 'tester') then
    raise exception 'USAGE_NEEDS_PARENT';
  end if;
  return new;
end;
$$;
-- Tên trigger của equipment xếp sau equipment_03_usage_from_parent → thấy giá trị cuối cùng.
create trigger equipment_04_usage_rule before insert or update of usage, parent_id on public.equipment
  for each row execute function public.asset_usage_rule();
create trigger sub_equipment_03_usage_rule before insert or update of usage, tester_id on public.sub_equipment
  for each row execute function public.asset_usage_rule();
create trigger golden_boards_02_usage_rule before insert or update of usage, parent_id on public.golden_boards
  for each row execute function public.asset_usage_rule();

-- =============================================================================
-- 3e. THẺ (tags) — equipment / sub_equipment / golden_boards
--     Mỗi bản ghi chọn nhiều thẻ (cột tag_ids uuid[]). Database kiểm tra mọi lần ghi: bỏ trùng, thẻ phải
--     có thật (VALIDATION_ERROR). Thẻ đang được dùng thì không xóa được (TAG_IN_USE).
-- =============================================================================
create or replace function public.tag_ids_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Bỏ trùng, giữ thứ tự chọn đầu tiên.
  select coalesce(array_agg(x order by ord), '{}') into new.tag_ids
  from (select u.x, min(u.ord) as ord from unnest(coalesce(new.tag_ids, '{}')) with ordinality as u(x, ord) group by u.x) d;
  if exists (select 1 from unnest(new.tag_ids) i where not exists (select 1 from public.tags t where t.id = i)) then
    raise exception 'VALIDATION_ERROR' using detail = 'unknown tag';
  end if;
  return new;
end;
$$;
create trigger equipment_05_tags_check before insert or update of tag_ids on public.equipment
  for each row execute function public.tag_ids_check();
create trigger sub_equipment_04_tags_check before insert or update of tag_ids on public.sub_equipment
  for each row execute function public.tag_ids_check();
create trigger golden_boards_03_tags_check before insert or update of tag_ids on public.golden_boards
  for each row execute function public.tag_ids_check();

create or replace function public.tag_delete_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.equipment where old.id = any (tag_ids))
     or exists (select 1 from public.sub_equipment where old.id = any (tag_ids))
     or exists (select 1 from public.golden_boards where old.id = any (tag_ids)) then
    raise exception 'TAG_IN_USE';
  end if;
  return old;
end;
$$;
create trigger tags_delete_check before delete on public.tags
  for each row execute function public.tag_delete_check();

-- =============================================================================
-- 4. CALIBRATION
--    due_date = calibrated_at + chu kỳ của part number (Configuration › Hiệu chuẩn › Setup), tính khi THÊM một lần
--    hiệu chuẩn (hoặc khi sửa calibrated_at). Admin đổi chu kỳ chỉ áp dụng cho các lần hiệu chuẩn SAU: due_date đã
--    tính không bao giờ tự đổi. Part number chưa có Setup: due_date do người nhập (bắt buộc).
-- =============================================================================
create or replace function public.calibration_compute_due() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_interval integer;
begin
  if tg_op = 'UPDATE' and new.calibrated_at = old.calibrated_at then return new; end if;
  select cc.interval_months into v_interval
  from public.sub_equipment s
  join public.calibration_configurations cc on cc.part_number_id = s.part_number_id
  where s.id = new.sub_equipment_id;
  if v_interval is not null then
    new.due_date := (new.calibrated_at + make_interval(months => v_interval))::date;
  elsif new.due_date is null then
    raise exception 'CALIBRATION_INTERVAL_MISSING';
  end if;
  return new;
end;
$$;
create trigger calibrations_compute_due before insert or update of calibrated_at on public.calibrations
  for each row execute function public.calibration_compute_due();

-- Setup hiệu chuẩn chỉ cho part number loại sub_equipment.
create or replace function public.calibration_configuration_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.part_numbers pn join public.types t on t.id = pn.type_id
    where pn.id = new.part_number_id and t.kind = 'sub_equipment'
  ) then
    raise exception 'TYPE_KIND_INVALID';
  end if;
  return new;
end;
$$;
create trigger calibration_configurations_kind before insert or update of part_number_id on public.calibration_configurations
  for each row execute function public.calibration_configuration_kind();

-- Calibration Status của từng sub-equipment — tính khi đọc, không lưu. Dựa vào lần hiệu chuẩn mới nhất:
--   chưa hiệu chuẩn lần nào → not_calibrated · lần mới nhất không đạt (fail) → failed
--   quá hạn → overdue · còn ≤ warning_days ngày (mặc định 30) → due_soon · còn lại → valid
-- Ngày "hôm nay" theo giờ Việt Nam.
create or replace view public.sub_equipment_calibration with (security_invoker = true) as
select s.id as sub_equipment_id,
       c.id as calibration_id, c.calibrated_at, c.due_date, c.vendor_id, c.cert_no, c.cert_file_url, c.result,
       cc.interval_months, cc.warning_days,
       case
         when c.id is null then 'not_calibrated'
         when c.result = 'fail' then 'failed'
         when c.due_date < d.today then 'overdue'
         when c.due_date - d.today <= coalesce(cc.warning_days, 30) then 'due_soon'
         else 'valid' end as status
from public.sub_equipment s
cross join (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today) d
left join lateral (
  select x.* from public.calibrations x where x.sub_equipment_id = s.id
  order by x.calibrated_at desc, x.created_at desc limit 1
) c on true
left join public.calibration_configurations cc on cc.part_number_id = s.part_number_id;

-- =============================================================================
-- 5. OVERVIEW — bảng thẻ theo Location
--    overview_board(p_usage, p_kind, p_q): mỗi CỘT là một tài sản GỐC (không có cha), các cột nhóm theo Location
--    (sắp theo locations.sort_order). Kết quả phẳng, mỗi dòng một THẺ. MỖI CỘT TỐI ĐA 3 THẺ, TÍNH CẢ THẺ GỐC (v_max_cards):
--      · thẻ gốc (depth 0) của mọi cột luôn được giữ lại, kèm
--      · tối đa 2 thẻ khác chọn trong CẢ cây của cột (không chỉ con trực tiếp: Tester → Base → Fixture → Golden); thẻ cha cần
--        để đường cây không đứt cũng tính vào 2 (Fixture dưới Base = Base + Fixture = hết chỗ).
--    Thứ tự chọn: thẻ khớp bộ lọc (chỉ khi có bộ lọc) → cảnh báo hiệu chuẩn (overdue / failed rồi due_soon)
--    → Base → Fixture → Golden → Sub-equipment → serial. Ba thẻ cùng thứ hạng thì lấy theo serial, nên kết quả luôn ổn định.
--    Chọn lần lượt: thẻ nào còn vừa chỗ (cùng các thẻ cha còn thiếu của nó) thì lấy, không vừa thì bỏ qua xét thẻ kế tiếp.
--    Ngoại lệ DUY NHẤT: thẻ KHỚP bộ lọc đứng đầu luôn hiện (cùng các thẻ cha của nó) dù cột thành cao hơn 3 — để thẻ tìm được
--    không bao giờ nằm sau "+N" (ví dụ Golden board ở cấp 3 cần Base + Fixture).
--    Bộ lọc (null = bỏ qua, các bộ lọc AND với nhau): p_usage in_use / not_in_use · p_kind tester / base / fixture /
--    sub_equipment / golden_board · p_q = serial hoặc part number chứa chữ này (không phân biệt hoa thường, % và _ là chữ thường).
--    Có bộ lọc thì CHỈ giữ cột có ít nhất một tài sản khớp (thẻ gốc hoặc bất kỳ thẻ nào trong cây, kể cả thẻ không hiện),
--    và `matched` = thẻ đó khớp (để tô nổi bật). Không có bộ lọc thì `matched` luôn false. Location không còn cột nào thì không có dòng.
--    Mỗi dòng: location_id, location, root_id (khóa của cột), asset_type, id, kind, type_name (golden board: null), part_number,
--    serial_number, usage, cal_alert (xấu nhất trong thẻ và mọi con cháu của nó: failed / overdue / due_soon, null = không có),
--    parent_id, depth (0 = gốc), descendants (số con cháu ĐỦ của thẻ, kể cả thẻ không hiện), alerts (số sub-equipment có cảnh báo trong
--    thẻ và con cháu), matched, pos (vị trí trong cột theo thứ tự cây: gốc = 1, rồi từng nhánh — Base, Fixture, Golden, Sub, theo serial).
--    Gốc được xếp: Tester trước, rồi tài sản chưa gắn (Base / Fixture / Golden / Sub), mỗi nhóm theo serial.
--    Số "+N thiết bị" của một cột = descendants của thẻ gốc − (số dòng của cột − 1).
--    Tốc độ: truy vấn đọc cả ba bảng một lần nên nối băm luôn là đúng — hàm đặt `enable_nestloop = off` để kế hoạch không phụ thuộc
--    thống kê (ngay sau một lần Import Excel lớn, thống kê chưa kịp cập nhật). Đo trên 5.000 tài sản: ≈ 0,3 s dù chưa có thống kê
--    (nếu không đặt: 0,4 s khi thống kê mới nhưng 5 s khi chưa có). Phần LATERAL của view Calibration vẫn dùng nested loop vì không có cách khác.
-- =============================================================================
create or replace function public.overview_board(
  p_usage text default null, p_kind text default null, p_q text default null
) returns table (
  location_id uuid, location text, root_id uuid,
  asset_type text, id uuid, kind text, type_name text, part_number text, serial_number text,
  usage text, cal_alert text, parent_id uuid, depth integer,
  descendants integer, alerts integer, matched boolean, pos integer
)
language plpgsql stable set search_path = '' set enable_nestloop = off as $$
#variable_conflict use_column
declare
  v_like   text := case when nullif(btrim(p_q), '') is null then null
                   else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_filter boolean;
  -- Số thẻ tối đa của một cột, tính cả thẻ gốc. Đổi số này là đổi số thẻ hiện (không cần đổi gì khác).
  v_max_cards constant integer := 3;
begin
  if p_usage is not null and p_usage not in ('in_use', 'not_in_use') then
    raise exception 'VALIDATION_ERROR' using detail = 'usage must be in_use or not_in_use';
  end if;
  if p_kind is not null and p_kind not in ('tester', 'base', 'fixture', 'sub_equipment', 'golden_board') then
    raise exception 'VALIDATION_ERROR' using detail = 'unknown kind';
  end if;
  v_filter := p_usage is not null or p_kind is not null or v_like is not null;

  return query
  with recursive
  -- Mọi tài sản của ba bảng. `sib` = thứ tự giữa các thẻ cùng cha (Base, Fixture, Golden, Sub; rồi serial) — cũng là thứ tự vẽ.
  nodes as (
    select u.*, (row_number() over (
      partition by u.parent_id
      order by case u.kind when 'base' then 0 when 'fixture' then 1 when 'golden_board' then 2 when 'sub_equipment' then 3 else 4 end,
               u.serial_number, u.id))::integer as sib
    from (
      select 'equipment'::text as asset_type, e.id, t.kind, t.display_name as type_name, pn.display_name as part_number,
             e.serial_number, e.usage, e.parent_id, e.location_id, null::text as own_alert
      from public.equipment e
      join public.types t on t.id = e.type_id
      join public.part_numbers pn on pn.id = e.part_number_id
      union all
      select 'sub_equipment', s.id, 'sub_equipment', t.display_name, pn.display_name,
             s.serial_number, s.usage, s.tester_id, s.location_id,
             case when c.status in ('failed', 'overdue', 'due_soon') then c.status end
      from public.sub_equipment s
      join public.types t on t.id = s.type_id
      join public.part_numbers pn on pn.id = s.part_number_id
      left join public.sub_equipment_calibration c on c.sub_equipment_id = s.id
      union all
      select 'golden_board', g.id, 'golden_board', null, g.part_number,
             g.serial_number, g.usage, g.parent_id, g.location_id, null
      from public.golden_boards g
    ) u
  ),
  -- Cây của từng cột: gốc = tài sản không có cha. `ids` = đường từ gốc tới thẻ, `ords` = thứ tự vẽ (so sánh được theo từng phần tử).
  tree as (
    select n.asset_type, n.id, n.kind, n.type_name, n.part_number, n.serial_number, n.usage, n.parent_id, n.location_id, n.own_alert,
           n.id as root_id, 0 as depth, array[n.id] as ids, array[0] as ords
    from nodes n
    where n.parent_id is null
    union all
    select c.asset_type, c.id, c.kind, c.type_name, c.part_number, c.serial_number, c.usage, c.parent_id, c.location_id, c.own_alert,
           t.root_id, t.depth + 1, t.ids || c.id, t.ords || c.sib
    from tree t
    join nodes c on c.parent_id = t.id
    where t.asset_type = 'equipment' and t.depth < 8
  ),
  scored as (
    select t.*, coalesce(v_filter
      and (p_usage is null or t.usage = p_usage)
      and (p_kind is null or t.kind = p_kind)
      and (v_like is null or t.serial_number ilike v_like or t.part_number ilike v_like), false) as matched
    from tree t
  ),
  -- Các CTE từ đây xuống đều `materialized`: mỗi CTE tính MỘT lần rồi được nối. Không có từ khóa này Postgres nhúng CTE dùng một lần vào
  -- truy vấn ngoài và có thể tính lại nó cho từng dòng (đo thật: 5.000 tài sản chạy 20 giây, vì shown_ids bị tính lại 5.000 lần).
  -- Số liệu cả nhánh của từng thẻ (không phụ thuộc bộ lọc): số con cháu, số cảnh báo, cảnh báo xấu nhất.
  stats as materialized (
    select a.root_id, a.id,
           (count(*) - 1)::integer as descendants,
           count(d.own_alert)::integer as alerts,
           min(case d.own_alert when 'failed' then 0 when 'overdue' then 1 when 'due_soon' then 2 end) as worst
    from tree a
    join tree d on d.root_id = a.root_id and a.id = any (d.ids)
    group by a.root_id, a.id
  ),
  kept as (
    select s.root_id from scored s group by s.root_id having not v_filter or bool_or(s.matched)
  ),
  -- Ứng viên (mọi thẻ không phải thẻ gốc) theo thứ tự ưu tiên của từng cột.
  ranked as materialized (
    select s.root_id, s.id, s.ids, s.matched, row_number() over (
      partition by s.root_id
      order by not s.matched,
               case s.own_alert when 'failed' then 0 when 'overdue' then 0 when 'due_soon' then 1 else 2 end,
               case s.kind when 'base' then 0 when 'fixture' then 1 when 'golden_board' then 2 else 3 end,
               s.serial_number, s.id) as rk
    from scored s
    where s.depth > 0 and s.root_id in (select k.root_id from kept k)
  ),
  -- Chọn lần lượt theo thứ tự ưu tiên. `shown` = các thẻ KHÁC thẻ gốc đã chọn (đã gồm thẻ cha). Mỗi ứng viên mang theo các thẻ cha
  -- còn thiếu của nó (`ids[2:]` = đường từ dưới thẻ gốc tới chính nó); vừa chỗ (≤ v_max_cards - 1) thì lấy, không thì bỏ qua.
  -- Cột đầy chỗ thì thôi xét tiếp, nên thường chỉ vài vòng dù một cột có hàng trăm thẻ (đã đo: tester 400 sub-equipment).
  pick (root_id, rk, shown) as (
    select k.root_id, 0::bigint, '{}'::uuid[] from kept k
    union all
    select p.root_id, c.rk,
           case when n.cnt + cardinality(p.shown) <= v_max_cards - 1 or (cardinality(p.shown) = 0 and c.matched)
                then p.shown || n.missing else p.shown end
    from pick p
    join ranked c on c.root_id = p.root_id and c.rk = p.rk + 1
    cross join lateral (
      select coalesce(array_agg(a.id), '{}'::uuid[]) as missing, count(*)::integer as cnt
      from unnest(c.ids[2:]) as a(id) where a.id <> all (p.shown)
    ) n
    where cardinality(p.shown) < v_max_cards - 1
  ),
  chosen as materialized (select distinct on (p.root_id) p.root_id, p.shown from pick p order by p.root_id, p.rk desc),
  -- Thẻ hiện: gốc + các thẻ đã chọn (kèm thẻ cha). Danh sách id bung ra rồi nối MỘT lần — không quét lại cả cây cho từng thẻ.
  shown_ids as materialized (
    select k.root_id, k.root_id as id from kept k
    union
    select c.root_id, a.id from chosen c cross join lateral unnest(c.shown) as a(id)
  ),
  shown as materialized (
    select s.* from scored s join shown_ids si on si.root_id = s.root_id and si.id = s.id
  )
  select l.id, l.display_name, s.root_id,
         s.asset_type, s.id, s.kind, s.type_name, s.part_number, s.serial_number,
         s.usage,
         case st.worst when 0 then 'failed' when 1 then 'overdue' when 2 then 'due_soon' end,
         s.parent_id, s.depth, st.descendants, st.alerts, s.matched,
         (row_number() over (partition by s.root_id order by s.ords))::integer
  from shown s
  join stats st on st.root_id = s.root_id and st.id = s.id
  join public.locations l on l.id = s.location_id
  join scored r on r.root_id = s.root_id and r.depth = 0
  order by l.sort_order, l.display_name, l.id, r.kind <> 'tester', r.serial_number, s.root_id, s.ords;
end;
$$;

-- =============================================================================
-- 5b. CÂY TÀI SẢN — asset_tree(p_type, p_id)
--    Cây chứa một tài sản: từ tài sản GỐC của nó (đi ngược theo cha) xuống mọi con cháu, ở cả 3 bảng, trong MỘT lần gọi.
--    Dùng cho tab "Cây thiết bị" và cho chip thiết bị con / tóm tắt hiệu chuẩn của modal Equipment (docs/DETAIL_MODEL.md 4.1).
--    Mỗi dòng: asset_type, id, kind (tester / base / fixture / sub_equipment / golden_board), type_name (golden board: null),
--    part_number, serial_number, usage, cal_status (sub-equipment: Calibration Status; còn lại null), parent_id (gốc: null),
--    depth (gốc = 0), pos (vị trí theo thứ tự cây: anh em Base, Fixture, Golden, Sub rồi serial — giống overview_board).
--    Không có tài sản thì không có dòng. Chỉ đọc các dòng thuộc cây (tìm con bằng asset_children), không quét cả bảng.
-- =============================================================================
create or replace function public.asset_tree(p_type text, p_id uuid) returns table (
  asset_type text, id uuid, kind text, type_name text, part_number text, serial_number text, usage text,
  cal_status text, parent_id uuid, depth integer, pos integer
)
language sql stable set search_path = '' as $$
  with recursive
  up (t, i, n) as (
    select p_type, p_id, 0
    union all
    select 'equipment', public.asset_parent(up.t, up.i), up.n + 1
    from up
    where up.n < 8 and public.asset_parent(up.t, up.i) is not null
  ),
  top as (select up.t, up.i from up order by up.n desc limit 1),
  members (asset_type, id, parent_id, depth) as (
    select top.t, top.i, null::uuid, 0 from top
    union all
    select c.asset_type, c.id, m.id, m.depth + 1
    from members m
    join lateral public.asset_children(m.asset_type, m.id) c on true
    where m.depth < 8
  ),
  detail as (
    select m.asset_type, m.id, t.kind, t.display_name as type_name, pn.display_name as part_number,
           e.serial_number, e.usage, null::text as cal_status, m.parent_id, m.depth
    from members m
    join public.equipment e on m.asset_type = 'equipment' and e.id = m.id
    join public.types t on t.id = e.type_id
    join public.part_numbers pn on pn.id = e.part_number_id
    union all
    select m.asset_type, m.id, 'sub_equipment', t.display_name, pn.display_name,
           s.serial_number, s.usage, c.status, m.parent_id, m.depth
    from members m
    join public.sub_equipment s on m.asset_type = 'sub_equipment' and s.id = m.id
    join public.types t on t.id = s.type_id
    join public.part_numbers pn on pn.id = s.part_number_id
    left join public.sub_equipment_calibration c on c.sub_equipment_id = s.id
    union all
    select m.asset_type, m.id, 'golden_board', null, g.part_number,
           g.serial_number, g.usage, null, m.parent_id, m.depth
    from members m
    join public.golden_boards g on m.asset_type = 'golden_board' and g.id = m.id
  ),
  ranked as (
    select d.*, (row_number() over (
      partition by d.parent_id
      order by case d.kind when 'base' then 0 when 'fixture' then 1 when 'golden_board' then 2 when 'sub_equipment' then 3 else 4 end,
               d.serial_number, d.id))::integer as sib
    from detail d
  ),
  ordered as (
    select r.*, array[0] as ords from ranked r where r.depth = 0
    union all
    select r.*, o.ords || r.sib from ordered o join ranked r on r.parent_id = o.id
  )
  select o.asset_type, o.id, o.kind, o.type_name, o.part_number, o.serial_number, o.usage, o.cal_status, o.parent_id, o.depth,
         (row_number() over (order by o.ords))::integer
  from ordered o
  order by o.ords
$$;

-- =============================================================================
-- 6. DASHBOARD — thay đổi gần đây (gộp các bảng nhật ký, không lưu dữ liệu)
--    Dòng của configuration / user chỉ Admin thấy — app lọc theo nhóm quyền.
--    module: equipment / sub_equipment / golden_board / configuration / user.
--    Import Excel ghi mỗi dòng một bản ghi nhật ký cùng created_at (một giao dịch):
--    gộp thành MỘT dòng cho mỗi (module, người import, lần import); item_count = số dòng.
--    Dòng khác item_count = 1.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- recent_actions — "Thay đổi gần đây" theo THAO TÁC: MỘT thao tác của người dùng = MỘT dòng (tính khi đọc, không lưu).
--   Gộp các dòng nhật ký có cùng action_id (Swap hai thiết bị = một dòng, Move / Check-out kèm con cháu = một dòng, Import = một dòng).
--   Dòng chưa có action_id (ghi từ SQL tay): mỗi dòng là một thao tác riêng, trừ import vẫn gộp theo (module, người import, lần import).
--   Không đổi, không xóa dữ liệu nhật ký nào.
--   id          action_id (hoặc id dòng nhật ký / khóa gộp của dòng cũ)
--   module      module của bản ghi đứng đầu; modules = mọi module trong thao tác (để lọc theo module và phân quyền)
--   action      mã hành động của bản ghi đứng đầu; source, created_by lấy theo bản ghi đứng đầu; created_at = lúc bắt đầu
--   item_count  số dòng nhật ký của thao tác; records = các bản ghi bị ảnh hưởng (TỐI ĐA 50 — item_count là tổng thật)
--   search_text tên / serial của MỌI bản ghi trong thao tác (ngăn bằng chr(31)) — để tìm theo bản ghi nào cũng khớp
--   Thứ tự bản ghi: bản ghi chính (do người dùng chọn) trước, bản ghi đi theo (note via_parent: / parent_deleted:) sau; trong mỗi nhóm theo
--   THỨ TỰ GHI (ctid — bảng nhật ký chỉ thêm, không sửa / xóa nên ctid tăng dần theo lúc ghi): Swap hiện "A ⇄ B" đúng thứ tự thao tác, import
--   liệt kê theo thứ tự dòng trong file.
-- -----------------------------------------------------------------------------
create or replace view public.recent_actions with (security_invoker = true) as
with activity as (
  select l.asset_type as module, l.asset_id as object_id, l.label, l.action, l.old_value, l.new_value, null::jsonb as changes,
         l.user_id as created_by, l.created_at, l.reason as note, l.source, l.from_location, l.to_location, l.id as log_id, l.ctid as row_pos,
         coalesce(l.action_id, case when l.source = 'import'
           then md5(l.asset_type || ':' || coalesce(l.user_id::text, '') || ':' || l.created_at::text)::uuid else l.id end) as group_id
  from public.asset_logs l
  union all
  select 'configuration', c.record_id, c.label, c.action, null::jsonb, null::jsonb, c.changes,
         c.created_by, c.created_at, c.note, c.source, null::text, null::text, c.id, c.ctid,
         coalesce(c.action_id, case when c.source = 'import'
           then md5('configuration:' || coalesce(c.created_by::text, '') || ':' || c.created_at::text)::uuid else c.id end)
  from public.configuration_histories c
  union all
  select 'user', u.user_id, u.label, u.action, null::jsonb, null::jsonb, u.changes,
         u.created_by, u.created_at, u.note, u.source, null::text, null::text, u.id, u.ctid,
         coalesce(u.action_id, case when u.source = 'import'
           then md5('user:' || coalesce(u.created_by::text, '') || ':' || u.created_at::text)::uuid else u.id end)
  from public.user_histories u
), ranked as (
  select a.*, row_number() over (
    partition by a.group_id
    order by (coalesce(a.note ~ '^(via_parent|parent_deleted):', false))::int, a.row_pos, a.log_id) as rn
  from activity a
)
select r.group_id as id,
       (array_agg(r.module order by r.rn))[1] as module,
       array_agg(distinct r.module) as modules,
       (array_agg(r.action order by r.rn))[1] as action,
       (array_agg(r.source order by r.rn))[1] as source,
       (array_agg(r.created_by order by r.rn))[1] as created_by,
       min(r.created_at) as created_at,
       count(*)::integer as item_count,
       coalesce(jsonb_agg(jsonb_build_object(
         'module', r.module, 'object_id', r.object_id, 'label', r.label, 'action', r.action,
         'changes', coalesce(r.changes, public.asset_log_changes(r.old_value, r.new_value)),
         'note', r.note, 'from_location', r.from_location, 'to_location', r.to_location
       ) order by r.rn) filter (where r.rn <= 50), '[]'::jsonb) as records,
       string_agg(r.label, chr(31) order by r.rn) as search_text
from ranked r
group by r.group_id;

revoke all on public.recent_actions from public, anon, authenticated;
grant select on public.recent_actions to service_role;
revoke all on public.sub_equipment_calibration from public, anon, authenticated;
grant select on public.sub_equipment_calibration to service_role;

-- =============================================================================
-- 7. BẢO MẬT — chỉ server (service_role) gọi được
-- =============================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;

commit;
