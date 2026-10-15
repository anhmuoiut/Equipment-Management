-- =============================================================================
-- 20261016000000 — Masterlist phân trang ở database + số liệu Dashboard đếm ở database.
--
-- Chạy MỘT lần trong SQL Editor của project đã dựng từ baseline (dán cả file → Run). Cả file là một giao dịch; chạy lại được (create or
-- replace). Project dựng mới: chạy baseline, rồi file này, rồi seed.sql (thứ tự tên file).
--
--   Thêm  : hàm natural_key; view equipment_list, sub_equipment_list, golden_list; hàm dashboard_summary.
--   Không đổi bảng, không đổi dữ liệu. Mọi view SECURITY INVOKER; chỉ service_role đọc / gọi được (như các view và hàm khác).
--
-- Vì sao: ba màn hình danh sách (Equipment, Calibration, Golden) tải CẢ bảng về trình duyệt rồi mới tìm / lọc / sắp xếp, và Dashboard đọc
-- hàng nghìn dòng chỉ để đếm. Giờ server hỏi MỘT trang trên các view này (PostgREST range + count) và Dashboard gọi một hàm trả vài KB.
-- Xem docs/DATABASE.md "List views" và docs/ARCHITECTURE.md "Lists: one page at a time".
-- =============================================================================

begin;

-- =============================================================================
-- DANH SÁCH (Masterlist) — view chỉ đọc cho phân trang, tìm, lọc, sắp xếp Ở DATABASE
--     Mỗi view gom sẵn các cột cần để lọc / sắp xếp / tìm mà không có trong bảng gốc:
--       · tên của khóa ngoại (part_number, type, level, location…) và serial của cha / tester;
--       · tags_text   = tên các thẻ, ngăn bằng ", ", theo thứ tự cấu hình (đúng chuỗi cột Tags hiển thị);
--       · has_children (Equipment), các cột hiệu chuẩn + status (Calibration — từ view sub_equipment_calibration);
--       · search_text = mọi cột chữ của dòng, viết thường, ngăn bằng chr(31): MỘT ilike tìm được trên mọi cột như ô tìm kiếm cũ;
--       · *_nk        = khóa sắp xếp "tự nhiên" (SN2 < SN10, không phân biệt hoa thường) — ORDER BY cột này thay cho Intl.Collator
--                       numeric của trình duyệt trước đây. Chỉ tính khi được sắp xếp theo nó.
-- =============================================================================

-- Khóa sắp xếp tự nhiên: chuỗi số được đệm 0 đến 24 chữ số, chữ thường. Rỗng / null → null (xếp cuối khi tăng dần, như trước).
create or replace function public.natural_key(p_text text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(string_agg(
           case when m[1] ~ '^[0-9]+$' then repeat('0', greatest(24 - length(m[1]), 0)) || m[1] else lower(m[1]) end,
           '' order by ord), '')
  from regexp_matches(coalesce(p_text, ''), '([0-9]+|[^0-9]+)', 'g') with ordinality as t(m, ord)
$$;

create or replace view public.equipment_list with (security_invoker = true) as
select e.id, e.jabil_id, e.part_number_id, e.serial_number, e.asset, e.type_id, e.usage, e.level_id, e.location_id,
       e.remark, e.tag_ids, e.parent_id, e.created_at, e.created_by, e.updated_at, e.updated_by,
       pn.display_name as part_number, t.display_name as type, t.kind,
       lv.display_name as level, loc.display_name as location,
       par.serial_number as parent_serial, tg.tags_text,
       (exists (select 1 from public.equipment c where c.parent_id = e.id)
        or exists (select 1 from public.sub_equipment s where s.tester_id = e.id)
        or exists (select 1 from public.golden_boards g where g.parent_id = e.id)) as has_children,
       lower(concat_ws(chr(31), e.serial_number, e.asset, e.jabil_id, pn.display_name, t.display_name, lv.display_name,
                       loc.display_name, par.serial_number, tg.tags_text, e.remark)) as search_text,
       public.natural_key(e.serial_number) as serial_nk, public.natural_key(e.jabil_id) as jabil_nk,
       public.natural_key(e.asset) as asset_nk, public.natural_key(pn.display_name) as part_nk,
       public.natural_key(t.display_name) as type_nk, public.natural_key(lv.display_name) as level_nk,
       public.natural_key(loc.display_name) as location_nk, public.natural_key(par.serial_number) as parent_nk
from public.equipment e
join public.part_numbers pn on pn.id = e.part_number_id
join public.types t on t.id = e.type_id
join public.locations loc on loc.id = e.location_id
left join public.levels lv on lv.id = e.level_id
left join public.equipment par on par.id = e.parent_id
left join lateral (
  select string_agg(x.display_name, ', ' order by x.sort_order, x.display_name) as tags_text
  from public.tags x where x.id = any (e.tag_ids)
) tg on true;

create or replace view public.sub_equipment_list with (security_invoker = true) as
select s.id, s.jabil_id, s.part_number_id, s.serial_number, s.asset, s.type_id, s.tester_id, s.location_id, s.usage,
       s.remark, s.tag_ids, s.created_at, s.created_by, s.updated_at, s.updated_by,
       pn.display_name as part_number, t.display_name as type, loc.display_name as location, te.serial_number as tester_serial,
       c.calibration_id, c.calibrated_at, c.due_date, c.vendor_id, v.display_name as vendor, c.cert_no, c.cert_file_url,
       c.result, c.interval_months, c.warning_days, coalesce(c.status, 'not_calibrated') as status,
       tg.tags_text,
       lower(concat_ws(chr(31), s.serial_number, s.asset, s.jabil_id, pn.display_name, t.display_name, te.serial_number,
                       loc.display_name, v.display_name, c.cert_no, c.calibrated_at::text, c.due_date::text, tg.tags_text, s.remark)) as search_text,
       public.natural_key(s.serial_number) as serial_nk, public.natural_key(s.jabil_id) as jabil_nk,
       public.natural_key(s.asset) as asset_nk, public.natural_key(pn.display_name) as part_nk,
       public.natural_key(t.display_name) as type_nk, public.natural_key(loc.display_name) as location_nk,
       public.natural_key(te.serial_number) as tester_nk, public.natural_key(v.display_name) as vendor_nk,
       public.natural_key(c.cert_no) as cert_nk
from public.sub_equipment s
join public.part_numbers pn on pn.id = s.part_number_id
join public.types t on t.id = s.type_id
join public.locations loc on loc.id = s.location_id
left join public.equipment te on te.id = s.tester_id
left join public.sub_equipment_calibration c on c.sub_equipment_id = s.id
left join public.calibration_vendors v on v.id = c.vendor_id
left join lateral (
  select string_agg(x.display_name, ', ' order by x.sort_order, x.display_name) as tags_text
  from public.tags x where x.id = any (s.tag_ids)
) tg on true;

create or replace view public.golden_list with (security_invoker = true) as
select g.id, g.part_number, g.serial_number, g.utd_part_number, g.origin, g.purpose, g.parent_id, g.location_id, g.usage,
       g.remark, g.tag_ids, g.created_at, g.created_by, g.updated_at, g.updated_by,
       loc.display_name as location, par.serial_number as parent_serial, tg.tags_text,
       lower(concat_ws(chr(31), g.serial_number, g.part_number, g.utd_part_number, loc.display_name, g.purpose, g.origin,
                       par.serial_number, tg.tags_text, g.remark)) as search_text,
       public.natural_key(g.serial_number) as serial_nk, public.natural_key(g.part_number) as part_nk,
       public.natural_key(g.utd_part_number) as utd_nk, public.natural_key(loc.display_name) as location_nk,
       public.natural_key(g.origin) as origin_nk, public.natural_key(par.serial_number) as parent_nk
from public.golden_boards g
join public.locations loc on loc.id = g.location_id
left join public.equipment par on par.id = g.parent_id
left join lateral (
  select string_agg(x.display_name, ', ' order by x.sort_order, x.display_name) as tags_text
  from public.tags x where x.id = any (g.tag_ids)
) tg on true;

-- -----------------------------------------------------------------------------
-- dashboard_summary — mọi con số của Dashboard trong MỘT lần gọi, đếm Ở DATABASE.
--   Trước đây server đọc cột nhẹ của CẢ ba bảng tài sản và view Calibration (hàng nghìn dòng) mỗi lần mở Dashboard chỉ để đếm trong JavaScript;
--   giờ trả vài KB. Quy tắc đếm giữ nguyên (docs/DATABASE.md "Dashboard"):
--     · totals / usage: số tài sản và In use / Not in use của từng loại tài sản (Equipment, Sub-equipment, Golden board);
--     · calibration: số sub-equipment theo Calibration Status (view sub_equipment_calibration — cùng nguồn với danh sách Calibration);
--     · locations / types / tags: MỌI tài sản, mỗi tài sản đếm một lần (golden board không có Type → type_id null; thẻ không còn tồn tại bị bỏ),
--       untagged = tài sản không mang thẻ nào còn tồn tại;
--     · overdue / due_soon: p_list_limit sub-equipment gần hạn nhất (hạn cũ nhất trước, rồi serial) — Dashboard chỉ vẽ vài dòng đầu;
--       số đầy đủ nằm ở `calibration`.
--   Tên (Location, Type, Tag, part number) do server ghép từ Configuration đã nhớ; ở đây chỉ có id.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_list_limit integer default 15) returns jsonb
language sql stable set search_path = '' as $$
  with assets as (
    select 'equipment'::text as kind, e.usage, e.location_id, e.type_id, e.tag_ids from public.equipment e
    union all
    select 'sub_equipment', s.usage, s.location_id, s.type_id, s.tag_ids from public.sub_equipment s
    union all
    select 'golden_board', g.usage, g.location_id, null::uuid, g.tag_ids from public.golden_boards g
  ), due as (
    select s.id, s.serial_number, s.part_number_id, s.type_id, s.location_id, te.serial_number as tester_serial, c.due_date, c.status
    from public.sub_equipment s
    join public.sub_equipment_calibration c on c.sub_equipment_id = s.id
    left join public.equipment te on te.id = s.tester_id
    where c.status in ('overdue', 'due_soon')
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'equipment', count(*) filter (where kind = 'equipment'),
        'sub_equipment', count(*) filter (where kind = 'sub_equipment'),
        'golden_board', count(*) filter (where kind = 'golden_board')) from assets),
    'usage', (select jsonb_build_object(
        'equipment', jsonb_build_object('in_use', count(*) filter (where kind = 'equipment' and usage = 'in_use'),
                                        'not_in_use', count(*) filter (where kind = 'equipment' and usage = 'not_in_use')),
        'sub_equipment', jsonb_build_object('in_use', count(*) filter (where kind = 'sub_equipment' and usage = 'in_use'),
                                            'not_in_use', count(*) filter (where kind = 'sub_equipment' and usage = 'not_in_use')),
        'golden_board', jsonb_build_object('in_use', count(*) filter (where kind = 'golden_board' and usage = 'in_use'),
                                           'not_in_use', count(*) filter (where kind = 'golden_board' and usage = 'not_in_use'))) from assets),
    'calibration', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                    from (select status, count(*) as n from public.sub_equipment_calibration group by status) x),
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', location_id, 'count', n)), '[]'::jsonb)
                  from (select location_id, count(*) as n from assets group by location_id) x),
    'types', (select coalesce(jsonb_agg(jsonb_build_object('id', type_id, 'count', n)), '[]'::jsonb)
              from (select type_id, count(*) as n from assets group by type_id) x),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('id', tag_id, 'count', n)), '[]'::jsonb)
             from (select t.id as tag_id, count(*) as n
                   from assets a cross join lateral unnest(a.tag_ids) as u(tag_id)
                   join public.tags t on t.id = u.tag_id group by t.id) x),
    'untagged', (select count(*) from assets a
                 where not exists (select 1 from unnest(a.tag_ids) as u(tag_id) join public.tags t on t.id = u.tag_id)),
    'overdue', (select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date, x.serial_number, x.id), '[]'::jsonb)
                from (select * from due where status = 'overdue' order by due_date, serial_number, id limit greatest(p_list_limit, 0)) x),
    'due_soon', (select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date, x.serial_number, x.id), '[]'::jsonb)
                 from (select * from due where status = 'due_soon' order by due_date, serial_number, id limit greatest(p_list_limit, 0)) x)
  )
$$;

-- Quyền: chỉ server (service_role) đọc view và gọi hàm. Hàm mới tạo thì phải nói lại (mặc định Supabase cho anon / authenticated gọi).
revoke all on public.equipment_list, public.sub_equipment_list, public.golden_list from public, anon, authenticated;
grant select on public.equipment_list, public.sub_equipment_list, public.golden_list to service_role;
revoke execute on function public.natural_key(text), public.dashboard_summary(integer) from public, anon, authenticated;
grant execute on function public.natural_key(text), public.dashboard_summary(integer) to service_role;

commit;
