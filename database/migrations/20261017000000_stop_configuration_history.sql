-- =============================================================================
-- 20261017000000 — Ngừng ghi lịch sử Configuration.
--
-- Chạy MỘT lần trong SQL Editor của project đã dựng từ baseline + 20261016000000 (dán cả file → Run). Cả file là một giao dịch; chạy lại
-- được. Project dựng mới: baseline, 20261016000000, file này, rồi seed.sql (thứ tự tên file).
--
--   Bỏ     : trigger *_write_history của 9 bảng cấu hình; bảng configuration_histories (và mọi dòng trong đó).
--   Đổi    : hàm write_history() (chỉ còn ghi Equipment / Sub-equipment / Golden / hiệu chuẩn / tài khoản);
--            view recent_actions (không còn nhánh Configuration — cùng cột, cùng quyền).
--   Không đổi: bảng cấu hình và dữ liệu của chúng, asset_logs, user_histories, mọi hàm khác.
--
-- Vì sao: thay đổi cấu hình của Admin (Location, Part number, Tag…) không cần lưu vết; "Thay đổi gần đây" chỉ để biết AI đã làm gì với thiết bị
-- và tài khoản. Sau file này sửa Configuration không còn ghi gì, và màn hình Configuration không còn tab History.
-- =============================================================================

begin;

-- 1. View recent_actions không đọc configuration_histories nữa (phải đổi TRƯỚC khi xóa bảng).
create or replace view public.recent_actions with (security_invoker = true) as
with activity as (
  select l.asset_type as module, l.asset_id as object_id, l.label, l.action, l.old_value, l.new_value, null::jsonb as changes,
         l.user_id as created_by, l.created_at, l.reason as note, l.source, l.from_location, l.to_location, l.id as log_id, l.ctid as row_pos,
         coalesce(l.action_id, case when l.source = 'import'
           then md5(l.asset_type || ':' || coalesce(l.user_id::text, '') || ':' || l.created_at::text)::uuid else l.id end) as group_id
  from public.asset_logs l
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

-- 2. Hết ghi: bỏ trigger trên 9 bảng cấu hình.
do $$
declare
  t text;
begin
  foreach t in array array['part_numbers', 'locations', 'types', 'type_groups', 'tags', 'levels', 'departments', 'calibration_configurations', 'calibration_vendors'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_write_history', t);
  end loop;
end
$$;

-- 3. write_history() không còn nhánh Configuration (nhánh đó không còn được gọi).
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

  -- -------------------------------------------------------------- User profile
  if tg_table_name = 'user_profiles' then
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

-- 4. Bỏ bảng lịch sử Configuration (kèm chỉ mục và trigger append-only của nó).
drop table if exists public.configuration_histories;

commit;
