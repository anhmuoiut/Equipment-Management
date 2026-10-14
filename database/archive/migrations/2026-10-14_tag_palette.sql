-- Admin tags: blue / teal / gray / purple / yellow / red.
-- Run in Supabase SQL Editor before deploying the six-color tag picker.
-- The previous UI stored purple as 'yellow'. Move those tags to 'purple'
-- once to preserve their appearance; subsequent yellow selections stay yellow.
-- Tag IDs, assignments, audit timestamps and history stay intact.
-- No need to rerun 04_functions.sql. The transaction can safely be rerun.

begin;

do $$
declare
  v_timestamp_trigger_enabled boolean;
  v_history_trigger_enabled boolean;
begin
  -- The expanded constraint also records that legacy colors have been converted.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tags'::regclass and conname = 'tags_color_check'
      and pg_get_constraintdef(oid) like '%''purple''%'
  ) then
    alter table public.tags drop constraint if exists tags_color_check;
    alter table public.tags add constraint tags_color_check
      check (color in ('green', 'yellow', 'red', 'blue', 'gray', 'purple'));

    select exists (
      select 1 from pg_trigger where tgrelid = 'public.tags'::regclass
        and tgname = 'tags_set_updated_at' and tgenabled = 'O'
    ) into v_timestamp_trigger_enabled;
    select exists (
      select 1 from pg_trigger where tgrelid = 'public.tags'::regclass
        and tgname = 'tags_write_history' and tgenabled = 'O'
    ) into v_history_trigger_enabled;
    if v_timestamp_trigger_enabled then
      alter table public.tags disable trigger tags_set_updated_at;
    end if;
    if v_history_trigger_enabled then
      alter table public.tags disable trigger tags_write_history;
    end if;
    update public.tags set color = 'purple' where color = 'yellow';
    if v_timestamp_trigger_enabled then
      alter table public.tags enable trigger tags_set_updated_at;
    end if;
    if v_history_trigger_enabled then
      alter table public.tags enable trigger tags_write_history;
    end if;
  end if;
end $$;

comment on column public.tags.color is 'Màu thẻ pastel: green (xanh ngọc) / yellow / red / blue / gray / purple.';

commit;

-- Verify: the constraint must include all six keys, including purple.
select pg_get_constraintdef(oid) as tag_color_palette
from pg_constraint where conrelid = 'public.tags'::regclass and conname = 'tags_color_check';
