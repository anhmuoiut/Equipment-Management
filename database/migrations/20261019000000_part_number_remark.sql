-- Part Number › Remark: free note on the Part Number (Configuration › Part Number), shown read-only in the Equipment and
-- Sub-equipment detail modals next to Description. Optional, up to 1000 characters (the app checks the length).
-- Run ONCE in the Supabase SQL Editor BEFORE deploying the app version that reads `remark`; safe to run again.
begin;

alter table public.part_numbers add column if not exists remark text;
comment on column public.part_numbers.remark is 'Ghi chú của part number (Configuration › Part Number). Không bắt buộc, chữ tự do, tối đa 1000 ký tự (app kiểm tra); hiện chỉ xem ở modal Equipment / Sub-equipment.';

notify pgrst, 'reload schema';

commit;
