-- Show Configuration → Part Number metadata in the paged Sub-equipment list.
-- Existing view columns retain their names/order; the new columns are appended.
-- No asset data is copied or changed: metadata always comes from its Part Number.
begin;

create or replace view public.sub_equipment_list with (security_invoker = true) as
select s.id, s.jabil_id, s.part_number_id, s.serial_number, s.asset, s.type_id, s.tester_id, s.location_id, s.usage,
       s.remark, s.tag_ids, s.created_at, s.created_by, s.updated_at, s.updated_by,
       pn.display_name as part_number, t.display_name as type, loc.display_name as location, te.serial_number as tester_serial,
       c.calibration_id, c.calibrated_at, c.due_date, c.vendor_id, v.display_name as vendor, c.cert_no, c.cert_file_url,
       c.result, c.interval_months, c.warning_days, coalesce(c.status, 'not_calibrated') as status,
       tg.tags_text,
       lower(concat_ws(chr(31), s.serial_number, s.asset, s.jabil_id, pn.display_name, t.display_name, te.serial_number,
                       loc.display_name, v.display_name, c.cert_no, c.calibrated_at::text, c.due_date::text, tg.tags_text, s.remark,
                       pn.description, pn.manufacturer)) as search_text,
       public.natural_key(s.serial_number) as serial_nk, public.natural_key(s.jabil_id) as jabil_nk,
       public.natural_key(s.asset) as asset_nk, public.natural_key(pn.display_name) as part_nk,
       public.natural_key(t.display_name) as type_nk, public.natural_key(loc.display_name) as location_nk,
       public.natural_key(te.serial_number) as tester_nk, public.natural_key(v.display_name) as vendor_nk,
       public.natural_key(c.cert_no) as cert_nk,
       pn.description, pn.manufacturer,
       public.natural_key(pn.description) as description_nk,
       public.natural_key(pn.manufacturer) as manufacturer_nk
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

revoke all on public.sub_equipment_list from public, anon, authenticated;
grant select on public.sub_equipment_list to service_role;
notify pgrst, 'reload schema';

commit;
