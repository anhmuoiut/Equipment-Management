// Local Postgres verification; does not connect to Supabase.
// npm i --no-save @electric-sql/pglite && node database/tests/tag_palette.test.mjs
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
const migration = readFileSync(join(root, 'database/migrations/2026-10-14_tag_palette.sql'), 'utf8');
const schema = readFileSync(join(root, 'database/02_schema.sql'), 'utf8');
let checks = 0;
const check = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };

const db = new PGlite();
try {
  await db.exec(`
    create table public.tags (
      id uuid primary key default gen_random_uuid(), display_name text not null,
      color text not null, updated_at timestamptz not null default now(),
      constraint tags_color_check check (color in ('green','yellow','red','blue','gray'))
    );
    create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end $$;
    create trigger tags_set_updated_at before update on public.tags
      for each row execute function public.set_updated_at();
    insert into public.tags (display_name,color,updated_at) values
      ('Legacy purple','yellow','2000-01-01'),('Existing red','red','2000-01-01'),('Neutral','gray','2000-01-01');
    create table public.assigned_tags (tag_id uuid references public.tags(id));
    insert into public.assigned_tags select id from public.tags where color = 'yellow';
    create table public.configuration_histories (old_value jsonb);
    insert into public.configuration_histories values ('{"color":"yellow"}');
    create function public.write_history() returns trigger language plpgsql as $$
      begin insert into public.configuration_histories values (to_jsonb(old)); return null; end $$;
    create trigger tags_write_history after update on public.tags
      for each row execute function public.write_history();
  `);
  const before = (await db.query('select * from public.tags order by display_name')).rows;
  await db.exec(migration);
  const after = (await db.query('select * from public.tags order by display_name')).rows;
  check('legacy purple keeps its appearance under the explicit purple key', after.find(r => r.display_name === 'Legacy purple').color === 'purple');
  check('other colors remain intact', after.find(r => r.display_name === 'Existing red').color === 'red' && after.find(r => r.display_name === 'Neutral').color === 'gray');
  check('tag IDs and audit timestamps are preserved', before.every((r,i) => r.id === after[i].id && new Date(r.updated_at).getTime() === new Date(after[i].updated_at).getTime()));
  check('assigned tag IDs remain valid', (await db.query('select t.color from public.assigned_tags a join public.tags t on t.id = a.tag_id')).rows[0].color === 'purple');
  check('existing history is preserved', (await db.query('select old_value from public.configuration_histories')).rows[0].old_value.color === 'yellow');
  check('migration does not create fake user edits', (await db.query('select count(*)::int as n from public.configuration_histories')).rows[0].n === 1);
  for (const color of ['blue','green','gray','purple','yellow','red']) {
    await db.query('insert into public.tags(display_name,color) values ($1,$2)', [`New ${color}`,color]);
  }
  check('all six colors can be saved', (await db.query("select count(*)::int as n from public.tags where display_name like 'New %'")).rows[0].n === 6);
  await assert.rejects(db.query("insert into public.tags(display_name,color) values ('Bad','#FF0000')"), /tags_color_check/);
  checks++; console.log('PASS arbitrary HEX values are rejected');
  await db.exec(migration);
  check('rerunning the migration preserves newly selected yellow', (await db.query("select color from public.tags where display_name = 'New yellow'")).rows[0].color === 'yellow');
  check('timestamp trigger remains enabled', (await db.query("select tgenabled from pg_trigger where tgname = 'tags_set_updated_at'")).rows[0].tgenabled === 'O');
  await db.exec("update public.tags set display_name = 'Edited purple' where display_name = 'Legacy purple'");
  check('later admin edits still update the timestamp', new Date((await db.query("select updated_at from public.tags where display_name = 'Edited purple'")).rows[0].updated_at).getTime() > new Date(before.find(r => r.display_name === 'Legacy purple').updated_at).getTime());
  check('later admin edits still write history', (await db.query('select count(*)::int as n from public.configuration_histories')).rows[0].n === 2);
} finally { await db.close(); }

const fresh = new PGlite();
try {
  await fresh.exec('create table public.user_profiles(id uuid primary key);');
  const table = schema.match(/create table public\.tags \([\s\S]*?\n\);/);
  assert.ok(table, 'tag table exists in the fresh schema');
  await fresh.exec(table[0]);
  await fresh.exec("insert into public.tags(display_name,color) values ('Yellow','yellow'),('Purple','purple')");
  await fresh.exec(migration);
  check('a fresh schema supports purple and leaves new yellow intact', (await fresh.query('select color from public.tags order by display_name')).rows.map(r=>r.color).join(',') === 'purple,yellow');
} finally { await fresh.close(); }
console.log(`${checks} tag palette database checks passed.`);
