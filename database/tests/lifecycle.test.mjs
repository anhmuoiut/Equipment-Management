// Vòng đời một project mới trên PGlite (không đụng Supabase thật): baseline → seed → chuyển Admin → dữ liệu thử → reset → kiểm tra.
// Chạy: npm i --no-save @electric-sql/pglite && node database/tests/lifecycle.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
const read = (...p) => readFileSync(join(root, 'database', ...p), 'utf8').replace(/\r\n/g, '\n');
const baselineFile = readdirSync(join(root, 'database', 'migrations')).filter((f) => f.endsWith('_baseline.sql'));
if (baselineFile.length !== 1) throw new Error('expected exactly one *_baseline.sql');
const baseline = read('migrations', baselineFile[0]);
const seed = read('seed.sql');
const exportAdmin = read('tools', 'export_admin_from_old.sql');
const importAdmin = read('tools', 'import_admin_to_new.sql');
const reset = read('tools', 'reset_after_testing.sql');
const verify = read('tools', 'verify_new_project.sql');

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${extra}`}`); if (!ok) failures++; };
// A script that fails inside its own begin; ... leaves the session in an aborted transaction (the SQL Editor ends the session instead): roll back.
const expectError = async (name, promise, text, db) => {
  try { await promise; check(name, false, 'no error'); } catch (e) { check(name, String(e.message ?? e).includes(text), String(e.message ?? e).slice(0, 200)); }
  if (db) await db.exec('rollback').catch(() => {});
};

// Supabase Auth's tables, trimmed — but with the traits that matter to the scripts: a GENERATED column on each table.
const AUTH = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (
    instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text unique, encrypted_password text,
    email_confirmed_at timestamptz, confirmed_at timestamptz generated always as (email_confirmed_at) stored,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz);
  create table auth.identities (
    id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null references auth.users (id) on delete cascade,
    identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
    email text generated always as (lower(identity_data ->> 'email')) stored, created_at timestamptz, updated_at timestamptz,
    unique (provider_id, provider));
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade);
`;
const newProject = async () => { const db = new PGlite(); await db.exec(AUTH); await db.exec(baseline); return db; };
const q = async (db, s, a = []) => (await db.query(s, a)).rows;
const n = async (db, s) => Number(Object.values((await q(db, s))[0])[0]);

const HASH = '$2a$10$abcdefghijklmnopqrstuuMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKa';  // not a real hash
async function addUser(db, { username, role, password = HASH, active = true, mustChange = false }) {
  const [u] = await q(db, `insert into auth.users (instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, $2, now(), '{"provider":"email"}', '{}', now(), now()) returning id`, [`${username}@jabil.local`, password]);
  await db.query(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now())`, [u.id, `${username}@jabil.local`]);
  await db.query(`insert into auth.sessions (user_id) values ($1)`, [u.id]);
  await db.query(`insert into public.user_profiles (id, username, full_name, role, is_active, must_change_password) values ($1, $2, $3, $4, $5, $6)`,
    [u.id, username, `User ${username}`, role, active, mustChange]);
  return u.id;
}
const lastResult = (results) => results[results.length - 1].rows;

// ============================================================ 1. seed.sql on a fresh baseline
const fresh = await newProject();
const seedCounts = { type_groups: 4, types: 4, levels: 9, departments: 3, locations: 4, tags: 4, calibration_vendors: 1, part_numbers: 4, calibration_configurations: 1 };
await fresh.exec(seed);
for (const [t, expected] of Object.entries(seedCounts)) check(`seed: ${t} has ${expected} rows`, (await n(fresh, `select count(*) as n from public.${t}`)) === expected);
check('seed: leaves no log rows (history triggers were off while inserting)',
  (await n(fresh, `select (select count(*) from public.configuration_histories) + (select count(*) from public.asset_logs) + (select count(*) from public.user_histories) as n`)) === 0);
check('seed: the history triggers are switched back ON afterwards',
  (await n(fresh, `select count(*) as n from pg_trigger where tgname ~ '_write_history$' and tgenabled <> 'O'`)) === 0);
check('seed: the three system types are Tester / Base / Fixture', JSON.stringify((await q(fresh, `select kind from public.types where kind <> 'sub_equipment' order by sort_order`)).map((r) => r.kind)) === '["tester","base","fixture"]');
check('seed: every part number has a Type, the sub-equipment one has its calibration setup',
  (await n(fresh, `select count(*) as n from public.part_numbers where type_id is not null`)) === 4 && (await n(fresh, `select count(*) as n from public.calibration_configurations`)) === 1);
const settingsSnapshot = async (db) => JSON.stringify(await q(db, `select 'loc' as t, id, display_name, sort_order, is_active::text from public.locations
  union all select 'tag', id, display_name, sort_order, color from public.tags
  union all select 'type', id, display_name, sort_order, kind from public.types
  union all select 'pn', id, display_name, sort_order, type_id::text from public.part_numbers
  union all select 'lvl', id, display_name, sort_order, is_active::text from public.levels
  union all select 'dep', id, display_name, sort_order, is_active::text from public.departments
  union all select 'ven', id, display_name, sort_order, is_active::text from public.calibration_vendors
  union all select 'grp', id, display_name, sort_order, kind from public.type_groups order by 1, 2`));
const afterFirstSeed = await settingsSnapshot(fresh);
await fresh.exec(seed);
check('seed: running it again changes nothing', (await settingsSnapshot(fresh)) === afterFirstSeed);
await fresh.close();

// ============================================================ 2. move the Admin: export on the OLD project, import on the NEW one
const oldProject = await newProject();
await oldProject.exec(seed);
const oldAdminId = await addUser(oldProject, { username: 'admin1', role: 'admin' });
await oldProject.query(`update public.user_profiles set department_id = (select id from public.departments where display_name = 'TE'), employee_id = 'E-1' where id = $1`, [oldAdminId]);
await addUser(oldProject, { username: 'someone', role: 'user' });
const exportRes = lastResult(await oldProject.exec(exportAdmin.replace("'ADMIN_USERNAME'::text", "'admin1'::text")));
check('export: one row, one JSON cell', exportRes.length === 1 && exportRes[0].admin_export?.format === 1);
const exported = exportRes[0].admin_export;
check('export: carries the user, one identity and the profile of that admin only',
  exported.user.id === oldAdminId && exported.identities.length === 1 && exported.profile.username === 'admin1');
check('export: includes the password hash (that is why the cell must not be shared)', exported.user.encrypted_password === HASH);
check('export script is read-only (no insert / update / delete / drop / truncate)', !/\b(insert|update|delete|drop|truncate|alter)\b/i.test(exportAdmin.replace(/--.*$/gm, '')));
const wrongName = lastResult(await oldProject.exec(exportAdmin.replace("'ADMIN_USERNAME'::text", "'nobody'::text")));
check('export of an unknown username gives an empty export (import will refuse it)', wrongName[0].admin_export.user === null);
await oldProject.close();

const pasteJson = (json) => importAdmin.replace('$export$PASTE_THE_JSON_HERE$export$', () => `$export$${JSON.stringify(json)}$export$`);
const target = await newProject();
await target.exec(seed);
await expectError('import: refuses the untouched template (nothing pasted)', target.exec(importAdmin), 'IMPORT_NOT_CONFIGURED', target);
await expectError('import: refuses an export of a username that does not exist', target.exec(pasteJson(wrongName[0].admin_export)), 'IMPORT_NO_ADMIN', target);
await expectError('import: refuses an export that is not an Admin',
  target.exec(pasteJson({ ...exported, profile: { ...exported.profile, role: 'user' } })), 'IMPORT_NOT_ADMIN', target);
check('import: those refusals changed nothing', (await n(target, `select (select count(*) from auth.users) + (select count(*) from public.user_profiles) as n`)) === 0);

const imported = lastResult(await target.exec(pasteJson(exported)));
check('import: confirmation row shows an active Admin with a password, no hash printed',
  imported.length === 1 && imported[0].role === 'admin' && imported[0].is_active === true && imported[0].has_password === true && !('encrypted_password' in imported[0]));
const [u2] = await q(target, `select * from auth.users`);
check('import: same id and same password hash as the old project', u2.id === oldAdminId && u2.encrypted_password === HASH);
check('import: identity copied, and the GENERATED columns were left to the new project to compute',
  (await n(target, `select count(*) as n from auth.identities where user_id = '${oldAdminId}' and email = 'admin1@jabil.local'`)) === 1 && u2.confirmed_at !== null);
const [p2] = await q(target, `select * from public.user_profiles`);
check('import: same role and permissions, employee id kept, creators cleared, department kept (it is in the seed)',
  p2.id === oldAdminId && p2.role === 'admin' && p2.is_active === true && p2.employee_id === 'E-1' && p2.created_by === null && p2.updated_by === null && p2.department_id !== null);
const [h] = await q(target, `select action, source, note from public.user_histories`);
check('import: leaves one history row, marked as a script import', h?.action === 'CREATE' && h?.source === 'script' && /migrated/i.test(h?.note ?? ''), JSON.stringify(h));
await target.exec(pasteJson(exported));
check('import: running it twice is harmless', (await n(target, `select count(*) as n from auth.users`)) === 1 && (await n(target, `select count(*) as n from public.user_profiles`)) === 1);

// verify_new_project.sql: two result sets — the checks, then the per-table row counts
const runVerify = async (db) => { const [checks, counts] = await db.exec(verify); return { total: checks.rows.length, bad: checks.rows.filter((r) => !r.ok), counts: counts.rows }; };
const v1 = await runVerify(target);
check('verify_new_project.sql: the 14 checks all ran (an empty result must not count as a pass)', v1.total === 14, String(v1.total));
check('verify_new_project.sql: every check passes on the new project', v1.bad.length === 0, JSON.stringify(v1.bad));
check('verify_new_project.sql: row counts equal the expectation right after setup (seed + the migrated Admin)', v1.counts.length === 18 && v1.counts.every((r) => r.ok), JSON.stringify(v1.counts.filter((r) => !r.ok)));

// ============================================================ 3. test data, then the reset
const tester = await addUser(target, { username: 'tester1', role: 'user' });
const readonly = await addUser(target, { username: 'viewer', role: 'readonly' });
await target.exec(`select set_config('app.actor_id', '${tester}', false)`);
const typeId = async (kind) => (await q(target, `select id from public.types where kind = '${kind}'`))[0].id;
const loc = (await q(target, `select id from public.locations order by sort_order limit 1`))[0].id;
await target.query(`insert into public.part_numbers (display_name, type_id) values ('TEST-PN', $1)`, [await typeId('tester')]);
const pn = (await q(target, `select id from public.part_numbers where display_name = 'TEST-PN'`))[0].id;
await target.query(`insert into public.equipment (serial_number, part_number_id, location_id, level_id) values ('TEST-1', $1, $2, (select id from public.levels limit 1))`, [pn, loc]);
await target.query(`insert into public.golden_boards (part_number, serial_number, location_id) values ('GB', 'TEST-GB', $1)`, [loc]);
await target.query(`insert into public.locations (display_name) values ('Added while testing')`);
await target.query(`update public.tags set display_name = 'Renamed while testing', color = 'red' where display_name = 'Normal'`);
await target.query(`update public.locations set is_active = false where display_name like 'B3F5 - Bay 9%'`);
await target.query(`insert into public.error_log (request_id, message) values ('req_test', 'boom')`);
check('(setup) the test left data, extra users and logs behind',
  (await n(target, `select count(*) from public.equipment`)) === 1 && (await n(target, `select count(*) from auth.users`)) === 3
  && (await n(target, `select (select count(*) from public.asset_logs) + (select count(*) from public.configuration_histories) + (select count(*) from public.error_log)`)) > 0);

await expectError('reset: refuses to run until the admin username is set', target.exec(reset), 'RESET_NOT_CONFIGURED', target);
await expectError('reset: refuses (and deletes nothing) when the named Admin does not exist', target.exec(reset.replace("'ADMIN_USERNAME'::text", "'ghost'::text")), 'RESET_ADMIN_NOT_FOUND', target);
await expectError('reset: refuses to keep an account that is not an Admin', target.exec(reset.replace("'ADMIN_USERNAME'::text", "'viewer'::text")), 'RESET_ADMIN_NOT_FOUND', target);
check('reset: those refusals deleted nothing', (await n(target, `select count(*) from public.equipment`)) === 1 && (await n(target, `select count(*) from auth.users`)) === 3);

const resetRows = lastResult(await target.exec(reset.replace("'ADMIN_USERNAME'::text", "'admin1'::text")));
const r = resetRows[0];
check('reset: summary row says 1 user, 1 auth user, no assets, no logs', Number(r.users) === 1 && Number(r.auth_users) === 1 && Number(r.assets_and_calibrations) === 0 && Number(r.log_rows) === 0, JSON.stringify(r));
check('reset: the Admin is still there — same id, same password hash, same role, can sign in',
  JSON.stringify((await q(target, `select p.id, p.role, p.is_active, u.encrypted_password from public.user_profiles p join auth.users u on u.id = p.id`))) ===
  JSON.stringify([{ id: oldAdminId, role: 'admin', is_active: true, encrypted_password: HASH }]));
check('reset: the Admin keeps the identity, the other accounts and their sessions are gone',
  (await n(target, `select count(*) from auth.identities`)) === 1 && (await n(target, `select count(*) from auth.sessions`)) === 0 /* sessions of the admin were not created in this test */
  && (await n(target, `select count(*) from auth.users where id in ('${tester}', '${readonly}')`)) === 0);
check('reset: every data table and every log table is empty',
  (await n(target, `select (select count(*) from public.equipment) + (select count(*) from public.sub_equipment) + (select count(*) from public.golden_boards)
    + (select count(*) from public.calibrations) + (select count(*) from public.asset_logs) + (select count(*) from public.configuration_histories)
    + (select count(*) from public.user_histories) + (select count(*) from public.error_log)`)) === 0);
check('reset: the Configuration lists are exactly the seed again (added rows gone, renamed / hidden rows restored)', (await settingsSnapshot(target)) === afterFirstSeed);
check('reset: the Admin\'s department is back (the seed restored it before the profile)', (await q(target, `select department_id from public.user_profiles`))[0].department_id !== null);
check('reset: history triggers are ON again, so the app keeps logging after the reset',
  (await n(target, `select count(*) as n from pg_trigger where tgname ~ '_write_history$' and tgenabled <> 'O'`)) === 0);
await target.exec(reset.replace("'ADMIN_USERNAME'::text", "'admin1'::text"));
check('reset: running it twice gives the same result', (await settingsSnapshot(target)) === afterFirstSeed && (await n(target, `select count(*) from public.user_profiles`)) === 1);

const v2 = await runVerify(target);
check('verify_new_project.sql: every check still passes after the reset', v2.total === 14 && v2.bad.length === 0, JSON.stringify(v2.bad));
check('verify_new_project.sql: after the reset the only count that differs from "just set up" is user_histories (0 — the import note is gone)',
  JSON.stringify(v2.counts.filter((r) => !r.ok).map((r) => r.table_name)) === '["user_histories"]', JSON.stringify(v2.counts.filter((r) => !r.ok)));

// the app works after the reset: a new action is logged normally (the real app sets its actor per transaction; this test set it
// for the whole session to mimic that, so clear it now that the account it pointed at is gone)
await target.exec(`select set_config('app.actor_id', '', false)`);
await target.query(`insert into public.locations (display_name) values ('After reset')`);
check('after the reset the next change is logged as usual', (await n(target, `select count(*) from public.configuration_histories where label = 'After reset'`)) === 1);
await target.close();

// ============================================================ 4. repository hygiene of the tooling
check('reset_after_testing.sql is generated from seed.sql (build-reset.mjs --check)', (() => {
  try { execFileSync('node', [join(root, 'database/tools/build-reset.mjs'), '--check'], { stdio: 'pipe' }); return true; } catch { return false; }
})());
check('committed templates keep their placeholders (no pasted secrets, no real username)',
  importAdmin.includes('PASTE_THE_JSON_HERE') && reset.includes("'ADMIN_USERNAME'") && exportAdmin.includes("'ADMIN_USERNAME'"));
check('no password hash or JWT-looking text in any committed database file', ![baseline, seed, exportAdmin, importAdmin, reset, verify]
  .some((t) => /\$2[aby]\$\d\d\$[./A-Za-z0-9]{40,}|eyJhbGciOi[A-Za-z0-9_-]{20,}|sb_secret_/.test(t)));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
