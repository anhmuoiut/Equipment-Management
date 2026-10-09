// Kiểm tra database/02 → 04 trên PGlite (Postgres chạy trong Node, không đụng Supabase thật).
// Chạy: npm i --no-save @electric-sql/pglite && node database/tests/assets.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
const sql = (f) => readFileSync(join(root, 'database', f), 'utf8');
const noExt = (s) => s.replace(/create extension if not exists pgcrypto;[^\n]*\n/, '');
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${extra}`}`); if (!ok) failures++; };
const expectError = async (name, promise, text) => {
  try { await promise; check(name, false, 'no error'); } catch (e) { check(name, e.message.includes(text), e.message); }
};

// ============================================================ dựng mới 02 → 03 → 04 (schema auth của Supabase giả lập)
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec('create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());');
const built = await db.exec(noExt(sql('02_schema.sql')));
check('02 builds exactly 18 tables', built[built.length - 1].rows.filter((r) => r.table_type === 'BASE TABLE').length === 18);
await db.exec(sql('03_seed.sql'));
const res = await db.exec(sql('04_functions.sql'));
const v = res[res.length - 1].rows[0];
check('04 verify row', v.history_triggers == 14 && v.type_triggers == 3 && v.type_lock_triggers == 1 && v.type_group_triggers == 2 && v.tree_triggers == 3 && v.level_triggers == 2
  && v.usage_rule_triggers == 3 && v.tag_triggers == 4 && v.serial_triggers == 3 && v.calibration_triggers == 2 && v.user_guard_triggers == 1
  && v.asset_ops == 6 && v.asset_swap_args == '5' && v.dry_run_functions == 9 && v.lookup_functions == 3 && v.overview_board == 1 && v.asset_tree == 1 && v.views == 2
  && v.app_write == 1 && v.equipment_import == 1 && v.sub_equipment_import == 1 && v.golden_import == 1, JSON.stringify(v));
await db.exec(sql('04_functions.sql'));
check('04_functions.sql can be run again', true);

const q = async (s, a = []) => (await db.query(s, a)).rows;
const one = async (s, a = []) => (await q(s, a))[0];
const gone = ['equipment_change_location', 'equipment_move', 'equipment_detach', 'equipment_swap', 'equipment_delete', 'asset_swap_leaf', 'asset_reparent',
  'asset_child_refs', 'equipment_children_mode', 'asset_assert_not_in_use', 'equipment_subtree_ids', 'part_number_usage_rule_changed',
  'part_number_type_changed', 'calibration_configuration_changed', 'equipment_usage_rule', 'sub_equipment_usage_rule', 'golden_board_usage_rule',
  'overview_children', 'overview_unattached_count'];
check('the removed functions are really gone', (await q(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = any($1::text[])`, [gone])).length === 0);
check('no p_children parameter left anywhere', Number((await one(`select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and 'p_children' = any (p.proargnames)`)).n) === 0);
check('no notifications table, no signup / approval columns', (await q(`select 1 from pg_tables where schemaname = 'public' and tablename = 'notifications'`)).length === 0
  && (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' order by 1`)).map((r) => r.column_name).join(',')
    === 'created_at,created_by,department_id,employee_id,full_name,id,is_active,must_change_password,role,updated_at,updated_by,username');
check('part_numbers has no usage_needs_parent', (await q(`select 1 from information_schema.columns where table_name = 'part_numbers' and column_name = 'usage_needs_parent'`)).length === 0);

// ============================================================ U. User Management
const authUser = async () => (await one(`insert into auth.users default values returning id`)).id;
const userRow = (id) => one(`select * from public.user_profiles where id = $1`, [id]);
const ins = async (username, role, actorId, extra = {}) => {
  const id = await authUser();
  await one(`select public.app_write('user_profiles', 'insert', null, $1::jsonb, $2, null, 'test', $3) as r`,
    [JSON.stringify({ id, username, full_name: `Full ${username}`, role, ...extra }), actorId, actorId ? 'ui' : 'script']);
  return id;
};
const admin1 = await ins('admin1', 'admin', null);
const actor = admin1;
const uw = (id, data, action = null, by = actor) => one(`select public.app_write('user_profiles', 'update', $1, $2::jsonb, $3, $4, null, 'ui') as r`, [id, JSON.stringify(data), by, action]);
const hist = (id) => q(`select * from public.user_histories where user_id = $1 order by created_at, id`, [id]);

check('first admin created by the script: CREATE logged (source script)', (await hist(admin1))[0].action === 'CREATE' && (await hist(admin1))[0].source === 'script');
check('defaults: active and must change password', (await userRow(admin1)).is_active === true && (await userRow(admin1)).must_change_password === true);
await expectError('a profile needs an auth user (FK)', one(`insert into public.user_profiles (id, username, full_name) values (gen_random_uuid(), 'ghost', 'Ghost')`), 'foreign key');
await expectError('an auth user with a profile cannot be deleted (RESTRICT)', db.query(`delete from auth.users where id = $1`, [admin1]), 'foreign key');
await expectError('username must be lower-case', ins('Upper', 'user', actor), 'user_profiles_username_format');
await expectError('username is unique', ins('admin1', 'user', actor), 'user_profiles_username_key');
await expectError('role is checked', ins('badrole', 'root', actor), 'user_profiles_role_check');
await expectError('accounts are never deleted through app_write', one(`select public.app_write('user_profiles', 'delete', $1, '{}'::jsonb, $2, null, null, 'ui')`, [admin1, actor]), 'VALIDATION_ERROR');

const u1 = await ins('user1', 'user', actor, { employee_id: '100234' });
check('Admin-created account: CREATE logged with the actor', (await hist(u1))[0].action === 'CREATE' && (await hist(u1))[0].created_by === actor);
await uw(u1, { full_name: 'New Name' });
check('edit → UPDATE', (await hist(u1)).pop().action === 'UPDATE');
await uw(u1, { role: 'readonly' });
check('role change → ROLE_CHANGE', (await hist(u1)).pop().action === 'ROLE_CHANGE');
await uw(u1, { is_active: false });
check('lock → DISABLE', (await hist(u1)).pop().action === 'DISABLE');
await uw(u1, { is_active: true });
check('unlock → ENABLE', (await hist(u1)).pop().action === 'ENABLE');
const nBefore = (await hist(u1)).length;
await uw(u1, { must_change_password: false });
check('the user changing their own password (must_change_password true → false) writes no history', (await hist(u1)).length === nBefore);
await uw(u1, { must_change_password: true }, 'PASSWORD_RESET');
const pr = (await hist(u1)).pop();
check('Admin reset → PASSWORD_RESET, must_change_password back to true', pr.action === 'PASSWORD_RESET' && pr.changes.must_change_password.new === true && (await userRow(u1)).must_change_password === true);
await uw(u1, { must_change_password: true }, 'PASSWORD_RESET');
check('…and a second reset is logged even though nothing changed', (await hist(u1)).pop().action === 'PASSWORD_RESET' && (await hist(u1)).length === nBefore + 2);

// bảo vệ Admin
const admin2 = await ins('admin2', 'admin', actor);
await expectError('Admin cannot lock themselves', uw(admin1, { is_active: false }, null, admin1), 'ADMIN_SELF_CHANGE');
await expectError('Admin cannot lower their own role', uw(admin1, { role: 'user' }, null, admin1), 'ADMIN_SELF_CHANGE');
await uw(admin1, { full_name: 'Admin One' }, null, admin1);
check('…but can edit themselves', (await userRow(admin1)).full_name === 'Admin One');
await uw(admin2, { is_active: false }, null, admin1);
check('an Admin can lock another Admin while one stays active', (await userRow(admin2)).is_active === false);
await expectError('the last active Admin cannot be locked', uw(admin1, { is_active: false }, null, u1), 'LAST_ADMIN');
await expectError('the last active Admin cannot be demoted', uw(admin1, { role: 'user' }, null, u1), 'LAST_ADMIN');
await uw(admin2, { is_active: true }, null, admin1);
await uw(admin2, { role: 'user' }, null, admin1);
check('…with a second active Admin demoting is fine', (await userRow(admin2)).role === 'user');
await uw(admin2, { role: 'admin' }, null, admin1);

// ============================================================ dữ liệu chung
const type = {};
for (const t of await q(`select id, kind from public.types where kind <> 'sub_equipment'`)) type[t.kind] = t.id;
const w = (table, op, id, data, note = null, action = null) =>
  one(`select public.app_write($1, $2, $3, $4::jsonb, $5, $6, $7, 'ui') as r`, [table, op, id, JSON.stringify(data), actor, action, note]).then((x) => x.r);
type.dmm = (await w('types', 'insert', null, { display_name: 'DMM', kind: 'sub_equipment' })).id;
type.psu = (await w('types', 'insert', null, { display_name: 'PSU', kind: 'sub_equipment' })).id;
const L = {};
for (const n of ['L1', 'L2', 'L3']) L[n] = (await w('locations', 'insert', null, { display_name: n })).id;
const lvl = (await w('levels', 'insert', null, { display_name: 'ICT' })).id;
const lvl2 = (await w('levels', 'insert', null, { display_name: 'EOL' })).id;
const pn = {};
for (const [n, t] of [['PN-T', 'tester'], ['PN-B', 'base'], ['PN-F', 'fixture'], ['PN-DMM', 'dmm'], ['PN-DMM2', 'dmm'], ['PN-PSU', 'psu']]) {
  pn[n] = (await w('part_numbers', 'insert', null, { display_name: n, type_id: type[t] })).id;
}
await w('calibration_configurations', 'insert', null, { part_number_id: pn['PN-DMM'], interval_months: 6, warning_days: 30 });
await w('calibration_configurations', 'insert', null, { part_number_id: pn['PN-PSU'], interval_months: 12, warning_days: 15 });
const tag = {};
for (const [n, c, o] of [['Repair', 'yellow', 1], ['Spare', 'gray', 2], ['Waiting', 'blue', 3]]) tag[n] = (await w('tags', 'insert', null, { display_name: n, color: c, sort_order: o })).id;
const vendor = (await w('calibration_vendors', 'insert', null, { display_name: 'Internal' })).id;
const today = (await one(`select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as d`)).d;

const mkEq = (serial, p, extra = {}) => w('equipment', 'insert', null, { serial_number: serial, part_number_id: pn[p], location_id: L.L1, ...extra }).then((x) => x.id);
const mkSub = (serial, p, extra = {}) => w('sub_equipment', 'insert', null, { serial_number: serial, part_number_id: pn[p], location_id: L.L1, ...extra }).then((x) => x.id);
const mkGold = (serial, extra = {}) => w('golden_boards', 'insert', null, { serial_number: serial, part_number: 'GB-PN', location_id: L.L1, ...extra }).then((x) => x.id);
const eq = (id) => one(`select * from public.equipment where id = $1`, [id]);
const sub = (id) => one(`select * from public.sub_equipment where id = $1`, [id]);
const gold = (id) => one(`select * from public.golden_boards where id = $1`, [id]);
const logs = (t, id) => q(`select * from public.asset_logs where asset_type = $1 and asset_id = $2 order by created_at, id`, [t, id]);
const lastLog = async (t, id) => { const l = await logs(t, id); return l[l.length - 1]; };
const rpc = (name, args) => one(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args).then((x) => x.r);
const refs = (...pairs) => JSON.stringify(pairs.map(([t, id]) => ({ type: t, id })));

// ============================================================ A. loại hệ thống
await expectError('system type cannot be deleted', w('types', 'delete', type.tester, {}), 'TYPE_SYSTEM_LOCKED');
await expectError('system type cannot be hidden', w('types', 'update', type.base, { is_active: false }), 'TYPE_SYSTEM_LOCKED');
await expectError('type kind cannot change', w('types', 'update', type.dmm, { kind: 'tester' }), 'TYPE_SYSTEM_LOCKED');
await w('types', 'update', type.fixture, { display_name: 'Fixture board' });
await w('types', 'update', type.fixture, { display_name: 'Fixture' });
check('system type can be renamed', true);
await expectError('a second type of a system kind is refused', w('types', 'insert', null, { display_name: 'Tester 2', kind: 'tester' }), 'types_system_kind_key');

// ---- Type groups (Configuration › Group) and the Level of a part number
const grp = {};
for (const g of await q(`select id, display_name from public.type_groups`)) grp[g.display_name] = g.id;
check('seed: Tester / Base / Fixture / Sub-equipment groups', ['Tester', 'Base', 'Fixture', 'Sub-equipment'].every((n) => grp[n]));
check('every Type has a group and kind equals the kind of its group',
  (await q(`select 1 from public.types t join public.type_groups g on g.id = t.group_id where t.kind <> g.kind`)).length === 0
  && Number((await one(`select count(*) as n from public.types where group_id is null`)).n) === 0);
check('the three system Types sit in the system group of their kind',
  (await q(`select t.kind from public.types t join public.type_groups g on g.id = t.group_id where t.kind <> 'sub_equipment' and g.display_name = initcap(t.kind)`)).length === 3);
check('a Type added without a group gets the first group of its kind (DMM → Sub-equipment)',
  (await one(`select g.display_name from public.types t join public.type_groups g on g.id = t.group_id where t.id = $1`, [type.dmm])).display_name === 'Sub-equipment');
const gMeter = (await w('type_groups', 'insert', null, { display_name: 'Meters', sort_order: 5 })).id;
check('a group added by an Admin is a sub_equipment group', (await one(`select kind from public.type_groups where id = $1`, [gMeter])).kind === 'sub_equipment');
await expectError('group names are unique, ignoring case', w('type_groups', 'insert', null, { display_name: 'METERS' }), 'type_groups_display_name_key');
await w('types', 'update', type.dmm, { group_id: gMeter });
check('moving a sub-equipment Type to another group keeps its kind', (await one(`select kind, group_id from public.types where id = $1`, [type.dmm])).kind === 'sub_equipment'
  && (await one(`select group_id from public.types where id = $1`, [type.dmm])).group_id === gMeter);
check('the Type history shows the group by name', (await one(`select changes -> 'group' ->> 'new' as g from public.configuration_histories
  where table_name = 'types' and record_id = $1 and action = 'UPDATE' order by created_at desc limit 1`, [type.dmm])).g === 'Meters');
const gNew = (await w('types', 'insert', null, { display_name: 'Scope', group_id: gMeter })).id;
check('a Type created in a group lands in it', (await one(`select group_id from public.types where id = $1`, [gNew])).group_id === gMeter);
await expectError('a sub-equipment Type cannot move into a system group', w('types', 'update', type.psu, { group_id: grp.Tester }), 'TYPE_SYSTEM_LOCKED');
await expectError('a system Type cannot leave its system group', w('types', 'update', type.tester, { group_id: gMeter }), 'TYPE_SYSTEM_LOCKED');
await expectError('a system group cannot be hidden', w('type_groups', 'update', grp.Tester, { is_active: false }), 'TYPE_SYSTEM_LOCKED');
await expectError('a system group cannot be deleted', w('type_groups', 'delete', grp.Base, {}), 'TYPE_SYSTEM_LOCKED');
await expectError('a group cannot change kind', w('type_groups', 'update', gMeter, { kind: 'tester' }), 'TYPE_SYSTEM_LOCKED');
await expectError('a group that still has Types cannot be deleted', w('type_groups', 'delete', gMeter, {}), 'foreign key');
await w('type_groups', 'update', grp.Tester, { display_name: 'Testers' });
await w('type_groups', 'update', grp.Tester, { display_name: 'Tester' });
await w('type_groups', 'update', gMeter, { display_name: 'Meters and sources', is_active: false });
check('an Admin group can be renamed and hidden; a system group can be renamed',
  (await one(`select display_name, is_active from public.type_groups where id = $1`, [gMeter])).is_active === false);
check('group changes go to configuration_histories (type_groups)',
  Number((await one(`select count(*) as n from public.configuration_histories where table_name = 'type_groups'`)).n) >= 4);
await w('types', 'delete', gNew, {});
check('a Type of an Admin group can be deleted when nothing uses it', (await q(`select 1 from public.types where id = $1`, [gNew])).length === 0);

check('part_numbers.level_id is optional and starts empty', (await q(`select 1 from public.part_numbers where level_id is not null`)).length === 0);
await w('part_numbers', 'update', pn['PN-PSU'], { level_id: lvl });
check('a part number can carry a Level', (await one(`select level_id from public.part_numbers where id = $1`, [pn['PN-PSU']])).level_id === lvl);
check('the part number history shows the Level by name', (await one(`select changes -> 'level' ->> 'new' as l from public.configuration_histories
  where table_name = 'part_numbers' and record_id = $1 and action = 'UPDATE' order by created_at desc limit 1`, [pn['PN-PSU']])).l === 'ICT');
await w('part_numbers', 'update', pn['PN-PSU'], { level_id: null });
check('…and the Level can be cleared again', (await one(`select level_id from public.part_numbers where id = $1`, [pn['PN-PSU']])).level_id === null);
await expectError('a Level in use by a part number cannot be deleted', (async () => {
  await w('part_numbers', 'update', pn['PN-PSU'], { level_id: lvl2 });
  await w('levels', 'delete', lvl2, {});
})(), 'foreign key');
await w('part_numbers', 'update', pn['PN-PSU'], { level_id: null });
check('new types default to sub_equipment', (await one(`select kind from public.types where id = $1`, [type.psu])).kind === 'sub_equipment');

// ============================================================ B. Type theo Part Number
await expectError('equipment cannot use a sub_equipment part number', mkEq('X', 'PN-DMM'), 'TYPE_KIND_INVALID');
await expectError('sub_equipment cannot use an equipment part number', mkSub('X', 'PN-T'), 'TYPE_KIND_INVALID');
const tt = await mkEq('T1', 'PN-T', { type_id: type.fixture });
check('equipment type follows the part number (a sent type_id is ignored)', (await eq(tt)).type_id === type.tester);
await expectError('Setup only for sub_equipment part numbers', w('calibration_configurations', 'insert', null, { part_number_id: pn['PN-T'], interval_months: 6 }), 'TYPE_KIND_INVALID');
const pnSpare = (await w('part_numbers', 'insert', null, { display_name: 'PN-SPARE', type_id: type.base })).id;
await w('part_numbers', 'update', pnSpare, { type_id: type.fixture });
check('the Type of a part number nobody uses can change', (await one(`select type_id from public.part_numbers where id = $1`, [pnSpare])).type_id === type.fixture);
await expectError('…but not once a device uses it (PART_NUMBER_IN_USE)', w('part_numbers', 'update', pn['PN-T'], { type_id: type.base }), 'PART_NUMBER_IN_USE');
await expectError('…also when only a sub_equipment uses it', (async () => { await mkSub('SUSED', 'PN-DMM2'); await w('part_numbers', 'update', pn['PN-DMM2'], { type_id: type.psu }); })(), 'PART_NUMBER_IN_USE');
check('nothing was changed on the devices (no Type propagation, no via_part_number log)', (await eq(tt)).type_id === type.tester
  && Number((await one(`select count(*) as n from public.asset_logs where reason like 'via_part_number%'`)).n) === 0);
await w('equipment', 'update', tt, { part_number_id: pn['PN-T'] });
await expectError('an equipment keeps its Type: changing its part number to another Type is refused', w('equipment', 'update', tt, { part_number_id: pn['PN-B'] }), 'TYPE_KIND_INVALID');

// ============================================================ C. quy tắc cha–con, Level
const t2 = await mkEq('T2', 'PN-T');
await expectError('tester under tester refused', mkEq('T3', 'PN-T', { parent_id: t2 }), 'PARENT_TYPE_INVALID');
const b1 = await mkEq('B1', 'PN-B', { parent_id: tt });
check('base under tester ok', (await eq(b1)).parent_id === tt);
const f0 = await mkEq('F0', 'PN-F', { parent_id: t2 });
check('fixture directly under a tester ok (Base or Tester)', (await eq(f0)).parent_id === t2);
await expectError('base under base refused', mkEq('B0', 'PN-B', { parent_id: b1 }), 'PARENT_TYPE_INVALID');
await expectError('fixture under a fixture refused', mkEq('F0B', 'PN-F', { parent_id: f0 }), 'PARENT_TYPE_INVALID');
await expectError('base under a fixture refused', mkEq('B0F', 'PN-B', { parent_id: f0 }), 'PARENT_TYPE_INVALID');
const f1 = await mkEq('F1', 'PN-F', { parent_id: b1 });
check('fixture under base ok', (await eq(f1)).parent_id === b1);
const bOrphan = await mkEq('B-ORPHAN', 'PN-B');
const fOrphan = await mkEq('F-ORPHAN', 'PN-F');
check('base and fixture may have no parent (in storage)', (await eq(bOrphan)).parent_id === null && (await eq(fOrphan)).parent_id === null);
await w('equipment', 'update', tt, { level_id: lvl });
check('level cascades from tester to base and fixture', (await eq(b1)).level_id === lvl && (await eq(f1)).level_id === lvl);
await w('equipment', 'update', tt, { level_id: lvl2 });
check('level change cascades again', (await eq(f1)).level_id === lvl2);

const sub1 = await mkSub('S1', 'PN-DMM', { tester_id: tt, location_id: L.L3 });
check('sub_equipment under a tester takes the tester location', (await sub(sub1)).location_id === L.L1);
await expectError('sub_equipment under a base refused', mkSub('S-BAD', 'PN-DMM', { tester_id: b1 }), 'PARENT_TYPE_INVALID');
await expectError('sub_equipment with a missing tester refused', mkSub('S-BAD2', 'PN-DMM', { tester_id: '00000000-0000-0000-0000-000000000000' }), 'PARENT_NOT_FOUND');
const g1 = await mkGold('G1', { parent_id: f1 });
const g2 = await mkGold('G2', { parent_id: tt });
check('golden board under fixture and under tester ok', (await gold(g1)).parent_id === f1 && (await gold(g2)).parent_id === tt);
await expectError('golden board under a base refused', mkGold('G-BAD', { parent_id: b1 }), 'PARENT_TYPE_INVALID');

// ============================================================ D. Usage cần cha (quy tắc cố định)
const tUse = await mkEq('T-ALONE', 'PN-T', { usage: 'in_use' });
check('a tester may be In use with no parent', (await eq(tUse)).usage === 'in_use');
await w('equipment', 'update', tUse, { usage: 'not_in_use' });
await expectError('a base cannot be In use alone', mkEq('B-USE', 'PN-B', { usage: 'in_use' }), 'USAGE_NEEDS_PARENT');
await expectError('a fixture cannot be In use alone', mkEq('F-USE', 'PN-F', { usage: 'in_use' }), 'USAGE_NEEDS_PARENT');
await expectError('a sub_equipment cannot be In use alone', mkSub('S-USE', 'PN-DMM', { usage: 'in_use' }), 'USAGE_NEEDS_PARENT');
await expectError('a golden board cannot be In use alone', mkGold('G-USE', { usage: 'in_use' }), 'USAGE_NEEDS_PARENT');
await expectError('…also by update', w('equipment', 'update', bOrphan, { usage: 'in_use' }), 'USAGE_NEEDS_PARENT');
const trimmed = await mkEq('  PADDED  ', 'PN-B');
check('serial is trimmed on save', (await eq(trimmed)).serial_number === 'PADDED');
await expectError('blank serial refused', mkEq('   ', 'PN-B'), 'equipment_serial_not_blank');
await w('equipment', 'update', trimmed, { serial_number: '  PADDED2 ' });
check('serial is trimmed on update', (await eq(trimmed)).serial_number === 'PADDED2');
await w('equipment', 'delete', trimmed, {});

// ============================================================ E. Check-out / Check-in
const n1 = await rpc('asset_set_usage', [refs(['equipment', tt]), 'in_use', actor, 'about to run']);
check('Check-out tester: tester + base + fixture + sub + 2 golden = 6 rows', n1.count === 6 && n1.dry_run === false && n1.changes.length === 6, JSON.stringify(n1).slice(0, 200));
const inUse = async () => ({ t: (await eq(tt)).usage, b: (await eq(b1)).usage, f: (await eq(f1)).usage, s: (await sub(sub1)).usage, g1: (await gold(g1)).usage, g2: (await gold(g2)).usage });
check('everything under the tester is In use', Object.values(await inUse()).every((x) => x === 'in_use'));
const lg = await lastLog('sub_equipment', sub1);
check('Check-out is logged CHECK_OUT with the note as reason', lg.action === 'CHECK_OUT' && lg.reason === 'about to run' && lg.new_value.usage === 'in_use' && lg.old_value.usage === 'not_in_use');
await expectError('Check-out again → USAGE_NO_CHANGE', rpc('asset_set_usage', [refs(['equipment', tt]), 'in_use', actor, null]), 'USAGE_NO_CHANGE');
await expectError('a standalone golden board cannot be checked out', rpc('asset_set_usage', [refs(['golden_board', await mkGold('G-LOOSE')]), 'in_use', actor, null]), 'USAGE_NEEDS_PARENT');
const g3 = await mkGold('G3', { parent_id: f1 });
check('a golden board attached to an In use fixture is In use', (await gold(g3)).usage === 'in_use');
await expectError('In use tester cannot be deleted', rpc('asset_delete', ['equipment', tt, actor]), 'EQUIPMENT_IN_USE');
await expectError('In use tester cannot change location', rpc('asset_change_location', ['equipment', tt, L.L2, actor]), 'EQUIPMENT_IN_USE');
await rpc('asset_set_usage', [refs(['equipment', tt]), 'not_in_use', actor, null]);
check('Check-in tester → everything Not in use', Object.values(await inUse()).every((x) => x === 'not_in_use'));
check('Check-in is logged CHECK_IN', (await lastLog('golden_board', g1)).action === 'CHECK_IN');
await expectError('Check-out of a child under a Not in use parent → PARENT_NOT_IN_USE', rpc('asset_set_usage', [refs(['golden_board', g2]), 'in_use', actor, null]), 'PARENT_NOT_IN_USE');
await rpc('asset_set_usage', [refs(['equipment', tt], ['golden_board', g2]), 'in_use', actor, null]);
check('parent + child in the same Check-out is fine', (await gold(g2)).usage === 'in_use' && (await eq(tt)).usage === 'in_use');
await rpc('asset_set_usage', [refs(['golden_board', g2]), 'not_in_use', actor, null]);
check('Check-in of one child leaves the parent alone', (await gold(g2)).usage === 'not_in_use' && (await eq(tt)).usage === 'in_use');
await rpc('asset_set_usage', [refs(['equipment', tt]), 'not_in_use', actor, null]);

// ============================================================ F. đổi vị trí (con luôn đi theo)
await rpc('asset_change_location', ['equipment', tt, L.L2, actor]);
check('tester location change follows to base, fixture, sub and golden', (await eq(b1)).location_id === L.L2 && (await eq(f1)).location_id === L.L2
  && (await sub(sub1)).location_id === L.L2 && (await gold(g1)).location_id === L.L2 && (await gold(g2)).location_id === L.L2);
const locLog = await lastLog('sub_equipment', sub1);
check('child log: CHANGE_LOCATION with from/to names and via_parent', locLog.action === 'CHANGE_LOCATION' && locLog.from_location === 'L1' && locLog.to_location === 'L2' && locLog.reason === 'via_parent:T1');
await expectError('location of an attached sub_equipment is read-only', rpc('asset_change_location', ['sub_equipment', sub1, L.L1, actor]), 'LOCATION_INHERITED_READ_ONLY');
await expectError('location of an attached base is read-only', rpc('asset_change_location', ['equipment', b1, L.L1, actor]), 'LOCATION_INHERITED_READ_ONLY');
await rpc('asset_change_location', ['equipment', tt, L.L1, actor]);
await expectError('unknown asset → NOT_FOUND', rpc('asset_change_location', ['equipment', '00000000-0000-0000-0000-000000000000', L.L1, actor]), 'NOT_FOUND');
await expectError('unknown asset type → VALIDATION_ERROR', rpc('asset_change_location', ['spaceship', tt, L.L1, actor]), 'VALIDATION_ERROR');

// ============================================================ G. Move — luôn được, tài sản lấy Status của cha mới
const t3 = await mkEq('T3', 'PN-T', { location_id: L.L2 });
await rpc('asset_set_usage', [refs(['equipment', tt]), 'in_use', actor, null]);   // tt, b1, f1, sub1, g1, g2, g3 In use
{
  const mv = await rpc('asset_move', ['equipment', f1, t3, actor]);
  check('Move of an In use fixture under a Not in use tester is allowed: it and its golden boards go Not in use (usage_changes names all 3)',
    (await eq(f1)).parent_id === t3 && (await eq(f1)).usage === 'not_in_use' && (await gold(g1)).usage === 'not_in_use' && (await gold(g3)).usage === 'not_in_use'
    && mv.usage_changes.length === 3 && mv.usage_changes.every((u) => u.from === 'in_use' && u.to === 'not_in_use'), JSON.stringify(mv.usage_changes));
  check('…and takes the new location (fixture and golden boards) and the Level of the new parent', (await eq(f1)).location_id === L.L2 && (await gold(g1)).location_id === L.L2 && (await eq(f1)).level_id === null);
  const mvl = await lastLog('equipment', f1);
  check('Move is logged MOVE with the new parent and usage', mvl.action === 'MOVE' && mvl.new_value.parent === 'T3' && mvl.old_value.usage === 'in_use' && mvl.new_value.usage === 'not_in_use');
  await rpc('asset_set_usage', [refs(['equipment', t3]), 'in_use', actor, null]);
  check('Check-out of the new tester takes the whole fixture branch In use', (await eq(f1)).usage === 'in_use' && (await gold(g1)).usage === 'in_use');
  const back = await rpc('asset_move', ['equipment', f1, b1, actor]);
  check('Move back under an In use base: stays In use, location and Level of the base', (await eq(f1)).parent_id === b1 && (await eq(f1)).usage === 'in_use'
    && (await eq(f1)).location_id === L.L1 && (await eq(f1)).level_id === lvl2 && back.usage_changes.length === 0);
}
{
  const mvIdle = await rpc('asset_move', ['sub_equipment', sub1, t2, actor]);
  check('Move of an In use sub_equipment under a Not in use tester: it takes ITS Status (In use → Not in use), named in usage_changes',
    (await sub(sub1)).tester_id === t2 && (await sub(sub1)).usage === 'not_in_use' && mvIdle.usage_changes.some((u) => u.label === 'S1' && u.from === 'in_use' && u.to === 'not_in_use'));
  const mvBusy = await rpc('asset_move', ['sub_equipment', sub1, t3, actor]);
  check("…under an In use tester it becomes In use again, with that tester's location", (await sub(sub1)).usage === 'in_use' && (await sub(sub1)).location_id === L.L2
    && mvBusy.usage_changes.some((u) => u.from === 'not_in_use' && u.to === 'in_use'));
  await rpc('asset_move', ['sub_equipment', sub1, tt, actor]);
  check('…and back under the first tester', (await sub(sub1)).tester_id === tt && (await sub(sub1)).usage === 'in_use' && (await sub(sub1)).location_id === L.L1);
  await rpc('asset_set_usage', [refs(['equipment', t3]), 'not_in_use', actor, null]);
}
{
  const mvG = await rpc('asset_move', ['golden_board', g2, f0, actor]);
  check('a golden board moves to a fixture and takes its Status (In use → Not in use)', (await gold(g2)).parent_id === f0 && (await gold(g2)).usage === 'not_in_use' && mvG.usage_changes.length === 1);
  await rpc('asset_move', ['golden_board', g2, tt, actor]);
  check('…and back under the In use tester: In use', (await gold(g2)).usage === 'in_use');
}
await expectError('a tester has no valid parent (PARENT_TYPE_INVALID)', rpc('asset_move', ['equipment', tt, t2, actor]), 'PARENT_TYPE_INVALID');
await expectError('base under a base is refused', rpc('asset_move', ['equipment', b1, bOrphan, actor]), 'PARENT_TYPE_INVALID');
await expectError('fixture under a fixture is refused', rpc('asset_move', ['equipment', f1, fOrphan, actor]), 'PARENT_TYPE_INVALID');
await expectError('golden board under a base is refused', rpc('asset_move', ['golden_board', g2, b1, actor]), 'PARENT_TYPE_INVALID');
await expectError('an equipment cannot be its own parent', rpc('asset_move', ['equipment', b1, b1, actor]), 'PARENT_TYPE_INVALID');
await expectError('unknown parent → PARENT_NOT_FOUND', rpc('asset_move', ['equipment', b1, '00000000-0000-0000-0000-000000000000', actor]), 'PARENT_NOT_FOUND');
await expectError('unknown asset → NOT_FOUND', rpc('asset_move', ['equipment', '00000000-0000-0000-0000-000000000000', tt, actor]), 'NOT_FOUND');
await rpc('asset_move', ['equipment', bOrphan, tt, actor]);
check('an idle-or-busy orphan base attaches under the In use tester and its subtree follows', (await eq(bOrphan)).parent_id === tt && (await eq(bOrphan)).usage === 'in_use' && (await eq(bOrphan)).level_id === lvl2);
await rpc('asset_move', ['equipment', fOrphan, bOrphan, actor]);
const gOrph = await mkGold('G-ORPH');
await rpc('asset_move', ['golden_board', gOrph, fOrphan, actor]);
check('a golden board attached under an In use fixture is In use', (await gold(gOrph)).usage === 'in_use');

// ============================================================ H. Detach
await rpc('asset_detach', ['equipment', bOrphan, actor]);
check('detaching an In use base: base, fixture and golden board go Not in use; the subtree stays together',
  (await eq(bOrphan)).parent_id === null && (await eq(bOrphan)).usage === 'not_in_use' && (await eq(fOrphan)).usage === 'not_in_use' && (await gold(gOrph)).usage === 'not_in_use'
  && (await eq(fOrphan)).parent_id === bOrphan && (await gold(gOrph)).parent_id === fOrphan);
await rpc('asset_detach', ['sub_equipment', sub1, actor]);
check('detach: sub_equipment keeps its location, Not in use, logged DETACH', (await sub(sub1)).tester_id === null && (await sub(sub1)).usage === 'not_in_use' && (await sub(sub1)).location_id === L.L1 && (await lastLog('sub_equipment', sub1)).action === 'DETACH');
await expectError('detach a loose sub_equipment → EQUIPMENT_HAS_NO_PARENT', rpc('asset_detach', ['sub_equipment', sub1, actor]), 'EQUIPMENT_HAS_NO_PARENT');
await expectError('detach a tester → EQUIPMENT_HAS_NO_PARENT', rpc('asset_detach', ['equipment', tt, actor]), 'EQUIPMENT_HAS_NO_PARENT');
await rpc('asset_move', ['sub_equipment', sub1, tt, actor]);
await rpc('asset_set_usage', [refs(['equipment', tt]), 'not_in_use', actor, null]);

// ============================================================ I. Swap — con luôn đi theo
const tA = await mkEq('SW-TA', 'PN-T');
const tB = await mkEq('SW-TB', 'PN-T', { location_id: L.L2, level_id: lvl });
const bA = await mkEq('SW-BA', 'PN-B', { parent_id: tA });
const fA = await mkEq('SW-FA', 'PN-F', { parent_id: bA });
const fB = await mkEq('SW-FB', 'PN-F', { parent_id: tB, location_id: L.L2 });
const gA = await mkGold('SW-GA', { parent_id: fA });
const gB = await mkGold('SW-GB', { parent_id: fB });
await rpc('asset_set_usage', [refs(['equipment', tA]), 'in_use', actor, null]);
const sw = await rpc('asset_swap', ['equipment', fA, fB, actor]);
check('swap fixtures: parents exchanged', (await eq(fA)).parent_id === tB && (await eq(fB)).parent_id === bA);
check('swap fixtures: location, Level and Usage go with the place', (await eq(fA)).location_id === L.L2 && (await eq(fB)).location_id === L.L1 && (await eq(fA)).level_id === lvl
  && (await eq(fA)).usage === 'not_in_use' && (await eq(fB)).usage === 'in_use');
check('swap fixtures: the golden boards follow their fixture (location + usage)', (await gold(gA)).location_id === L.L2 && (await gold(gA)).usage === 'not_in_use'
  && (await gold(gB)).location_id === L.L1 && (await gold(gB)).usage === 'in_use');
check('swap is logged SWAP on both sides with swap_with, and usage_changes lists the 4 assets that changed Status',
  (await lastLog('equipment', fA)).reason === 'swap_with:SW-FB' && (await lastLog('equipment', fB)).reason === 'swap_with:SW-FA' && sw.usage_changes.length === 4, JSON.stringify(sw.usage_changes));
await expectError('swap fixture with base → SWAP_TYPE_MISMATCH', rpc('asset_swap', ['equipment', fA, bA, actor]), 'SWAP_TYPE_MISMATCH');
await expectError('swap with itself → VALIDATION_ERROR', rpc('asset_swap', ['equipment', fA, fA, actor]), 'VALIDATION_ERROR');
await expectError('swap with an unknown asset → NOT_FOUND', rpc('asset_swap', ['equipment', fA, '00000000-0000-0000-0000-000000000000', actor]), 'NOT_FOUND');
await expectError('two fixtures with the same parent and location → SWAP_NO_CHANGE', rpc('asset_swap', ['equipment', fB, await mkEq('SW-FC', 'PN-F', { parent_id: bA }), actor]), 'SWAP_NO_CHANGE');
{
  const sT = await rpc('asset_swap', ['equipment', tA, tB, actor]);
  check('swap two testers: locations exchanged, the whole branch goes with its tester', (await eq(tA)).location_id === L.L2 && (await eq(tB)).location_id === L.L1
    && (await eq(bA)).location_id === L.L2 && (await eq(fB)).location_id === L.L2 && (await eq(fA)).location_id === L.L1);
  check('swap two testers: Usage follows the place (each branch takes the new Usage)', (await eq(tA)).usage === 'not_in_use' && (await eq(tB)).usage === 'in_use'
    && (await eq(bA)).usage === 'not_in_use' && (await eq(fB)).usage === 'not_in_use' && (await eq(fA)).usage === 'in_use' && sT.count >= 6);
  await rpc('asset_swap', ['equipment', tA, tB, actor]);
}
await rpc('asset_set_usage', [refs(['equipment', tA]), 'not_in_use', actor, null]);

// sub_equipment: cùng Type
const sa = await mkSub('SW-SA', 'PN-DMM', { tester_id: tA });
const sb = await mkSub('SW-SB', 'PN-DMM', { tester_id: tB });
const sp = await mkSub('SW-SP', 'PN-PSU', { tester_id: tA });
await rpc('asset_set_usage', [refs(['equipment', tB]), 'in_use', actor, null]);
await rpc('asset_swap', ['sub_equipment', sa, sb, actor]);
check('swap sub_equipment of the same Type: testers exchanged, usage + location follow',
  (await sub(sa)).tester_id === tB && (await sub(sb)).tester_id === tA && (await sub(sa)).usage === 'in_use' && (await sub(sb)).usage === 'not_in_use' && (await sub(sa)).location_id === (await eq(tB)).location_id);
check('sub swap is logged SWAP with swap_with', (await lastLog('sub_equipment', sa)).action === 'SWAP' && (await lastLog('sub_equipment', sa)).reason === 'swap_with:SW-SB');
await expectError('swap sub_equipment of different Types → SWAP_TYPE_MISMATCH', rpc('asset_swap', ['sub_equipment', sa, sp, actor]), 'SWAP_TYPE_MISMATCH');
await expectError('swap sub_equipment with the same place → SWAP_NO_CHANGE', rpc('asset_swap', ['sub_equipment', sa, await mkSub('SW-SA2', 'PN-DMM', { tester_id: tB }), actor]), 'SWAP_NO_CHANGE');
const sFree = await mkSub('SW-SFREE', 'PN-DMM', { location_id: L.L3 });
await rpc('asset_swap', ['sub_equipment', sa, sFree, actor]);
check('swap with a loose sub_equipment: the attached one goes to storage (Not in use, other location), the loose one takes its place',
  (await sub(sa)).tester_id === null && (await sub(sa)).usage === 'not_in_use' && (await sub(sa)).location_id === L.L3 && (await sub(sFree)).tester_id === tB && (await sub(sFree)).usage === 'in_use');
await rpc('asset_swap', ['golden_board', gA, gB, actor]);
check('golden boards swap with each other whatever their parent (fixture ↔ fixture)', (await gold(gA)).parent_id === fB && (await gold(gB)).parent_id === fA);
const gT = await mkGold('SW-GT', { parent_id: tB });
await rpc('asset_swap', ['golden_board', gT, gA, actor]);
check('…and tester ↔ fixture', (await gold(gT)).parent_id === fB && (await gold(gA)).parent_id === tB);
await expectError('golden swap with the same place → SWAP_NO_CHANGE', rpc('asset_swap', ['golden_board', gT, await mkGold('SW-G9', { parent_id: fB }), actor]), 'SWAP_NO_CHANGE');
await rpc('asset_set_usage', [refs(['equipment', tB]), 'not_in_use', actor, null]);

// ============================================================ J. Xóa — con trực tiếp luôn về chưa gắn
const tD = await mkEq('DEL-T', 'PN-T');
const bD = await mkEq('DEL-B', 'PN-B', { parent_id: tD });
const fD = await mkEq('DEL-F', 'PN-F', { parent_id: bD });
const sD = await mkSub('DEL-S', 'PN-DMM', { tester_id: tD });
const gD = await mkGold('DEL-G', { parent_id: fD });
const gD2 = await mkGold('DEL-G2', { parent_id: tD });
await w('calibrations', 'insert', null, { sub_equipment_id: sD, calibrated_at: today });
await expectError('a raw delete of a parent that still has children is refused (RESTRICT)', db.query(`delete from public.equipment where id = $1`, [tD]), 'foreign key');
await expectError('app_write cannot wipe a tree either', w('equipment', 'delete', tD, {}), 'foreign key');
const del = await rpc('asset_delete', ['equipment', tD, actor]);
check('delete the tester: only the tester is deleted', del.deleted === 1 && (await q(`select 1 from public.equipment where id = $1`, [tD])).length === 0);
check('its direct children are kept and unattached, Not in use: base, sub_equipment and golden board', (await eq(bD)).parent_id === null && (await sub(sD)).tester_id === null && (await gold(gD2)).parent_id === null);
check('the grandchildren stay with their own parent (fixture under the base, golden under the fixture)', (await eq(fD)).parent_id === bD && (await gold(gD)).parent_id === fD);
const dl = await lastLog('golden_board', gD2);
check('the children are logged DETACH with parent_deleted:<SN> (no stayed: notes anywhere)', dl.action === 'DETACH' && dl.reason === 'parent_deleted:DEL-T'
  && Number((await one(`select count(*) as n from public.asset_logs where reason like 'stayed%'`)).n) === 0);
check('DELETE log keeps the old row', (await lastLog('equipment', tD)).action === 'DELETE' && (await lastLog('equipment', tD)).old_value.serial_number === 'DEL-T' && (await lastLog('equipment', tD)).new_value === null);
const tE = await mkEq('DEL-TE', 'PN-T');
const bE = await mkEq('DEL-BE', 'PN-B', { parent_id: tE });
const fE = await mkEq('DEL-FE', 'PN-F', { parent_id: bE });
await rpc('asset_delete', ['equipment', bE, actor]);
check('delete the base: its fixture does NOT move up to the tester, it becomes unattached', (await eq(fE)).parent_id === null);
const sCal = await mkSub('DEL-SCAL', 'PN-DMM', { tester_id: tE });
const calId = (await w('calibrations', 'insert', null, { sub_equipment_id: sCal, calibrated_at: '2026-01-10', vendor_id: vendor })).id;
await rpc('asset_delete', ['sub_equipment', sCal, actor]);
check('deleting a sub_equipment removes its calibrations and logs only DELETE for it', (await q(`select 1 from public.calibrations where id = $1`, [calId])).length === 0
  && (await lastLog('sub_equipment', sCal)).action === 'DELETE' && !(await logs('sub_equipment', sCal)).some((l) => l.action === 'CALIBRATION_REMOVE'));
await expectError('delete again → NOT_FOUND', rpc('asset_delete', ['sub_equipment', sCal, actor]), 'NOT_FOUND');
await rpc('asset_set_usage', [refs(['equipment', tE]), 'in_use', actor, null]);
await expectError('an In use asset cannot be deleted', rpc('asset_delete', ['equipment', tE, actor]), 'EQUIPMENT_IN_USE');
await rpc('asset_set_usage', [refs(['equipment', tE]), 'not_in_use', actor, null]);

// ============================================================ K. thẻ
const sT = await mkSub('TAG-S', 'PN-DMM');
await w('sub_equipment', 'update', sT, { tag_ids: [tag.Spare, tag.Repair, tag.Spare] });
const tg = (await sub(sT)).tag_ids;
check('duplicate tags removed, first order kept', tg.length === 2 && tg[0] === tag.Spare && tg[1] === tag.Repair);
const tl = await lastLog('sub_equipment', sT);
check('tag change is logged TAGS with tag names', tl.action === 'TAGS' && JSON.stringify(tl.new_value.tags) === '["Repair","Spare"]');
await w('sub_equipment', 'update', sT, { tag_ids: [tag.Repair, tag.Spare] });
check('same tags in another order write no log', (await lastLog('sub_equipment', sT)).id === tl.id);
await expectError('unknown tag refused', w('sub_equipment', 'update', sT, { tag_ids: ['00000000-0000-0000-0000-000000000001'] }), 'VALIDATION_ERROR');
await expectError('a tag in use cannot be deleted', w('tags', 'delete', tag.Repair, {}), 'TAG_IN_USE');
await w('golden_boards', 'update', g1, { tag_ids: [tag.Waiting] });
await expectError('a tag on a golden board cannot be deleted', w('tags', 'delete', tag.Waiting, {}), 'TAG_IN_USE');

// ============================================================ L. hiệu chuẩn
const sc = (id) => one(`select * from public.sub_equipment_calibration where sub_equipment_id = $1`, [id]);
const soon = (await one(`select (($1::date) - interval '6 months' + interval '10 days')::date::text as d`, [today])).d;
const old6 = (await one(`select (($1::date) - interval '7 months')::date::text as d`, [today])).d;
const s5 = await mkSub('CAL-S5', 'PN-DMM');
check('never calibrated → not_calibrated', (await sc(s5)).status === 'not_calibrated');
const c1 = await w('calibrations', 'insert', null, { sub_equipment_id: s5, calibrated_at: today, due_date: '2000-01-01', vendor_id: vendor, cert_no: 'C-9', cert_file_url: 'https://example/c9.pdf' });
const due6 = (await one(`select (($1::date) + interval '6 months')::date::text as d`, [today])).d;
check('due_date is computed from the Setup interval (the sent value is ignored)', (await one(`select due_date::text as d from public.calibrations where id = $1`, [c1.id])).d === due6);
check('calibrated today → valid', (await sc(s5)).status === 'valid');
const cl = (await logs('sub_equipment', s5)).find((l) => l.action === 'CALIBRATE');
check('CALIBRATE log: vendor name, due date, cert; no old value', cl.old_value === null && cl.new_value.vendor === 'Internal' && cl.new_value.cert_no === 'C-9' && cl.new_value.due_date === due6);
const s6 = await mkSub('CAL-S6', 'PN-DMM');
await w('calibrations', 'insert', null, { sub_equipment_id: s6, calibrated_at: soon });
check('due in 10 days (≤ warning 30) → due_soon', (await sc(s6)).status === 'due_soon');
const s7 = await mkSub('CAL-S7', 'PN-DMM');
await w('calibrations', 'insert', null, { sub_equipment_id: s7, calibrated_at: old6 });
check('past due → overdue', (await sc(s7)).status === 'overdue');
await w('calibrations', 'insert', null, { sub_equipment_id: s7, calibrated_at: today });
check('the newest calibration decides (the older overdue one is history)', (await sc(s7)).status === 'valid');
await w('calibrations', 'insert', null, { sub_equipment_id: s7, calibrated_at: today, result: 'fail' });
check('latest result fail → failed (not "not_calibrated")', (await sc(s7)).status === 'failed');
await expectError('no Setup and no due_date → CALIBRATION_INTERVAL_MISSING', w('calibrations', 'insert', null, { sub_equipment_id: await mkSub('CAL-S8', 'PN-DMM2'), calibrated_at: today }), 'CALIBRATION_INTERVAL_MISSING');
const s9 = await mkSub('CAL-S9', 'PN-DMM2');
await w('calibrations', 'insert', null, { sub_equipment_id: s9, calibrated_at: today, due_date: '2099-01-01' });
check('no Setup: the entered due_date is kept', (await one(`select due_date::text as d from public.calibrations where sub_equipment_id = $1`, [s9])).d === '2099-01-01');
await expectError('due before calibration refused', w('calibrations', 'insert', null, { sub_equipment_id: s9, calibrated_at: today, due_date: '2000-01-01' }), 'calibrations_due_after_calibration');

// đổi chu kỳ chỉ áp dụng cho lần calib SAU
const s10 = await mkSub('CAL-S10', 'PN-PSU');
const oldCal = (await w('calibrations', 'insert', null, { sub_equipment_id: s10, calibrated_at: '2025-01-01' })).id;
const newCal = (await w('calibrations', 'insert', null, { sub_equipment_id: s10, calibrated_at: '2025-06-01' })).id;
const cfg = (await one(`select id from public.calibration_configurations where part_number_id = $1`, [pn['PN-PSU']])).id;
const nLogs = (await logs('sub_equipment', s10)).length;
await w('calibration_configurations', 'update', cfg, { interval_months: 24 });
const due = async (id) => (await one(`select due_date::text as d from public.calibrations where id = $1`, [id])).d;
check('changing the interval does NOT recompute existing due dates (no recompute, no log)', (await due(newCal)) === '2026-06-01' && (await due(oldCal)) === '2026-01-01' && (await logs('sub_equipment', s10)).length === nLogs);
const nextCal = (await w('calibrations', 'insert', null, { sub_equipment_id: s10, calibrated_at: '2025-09-01' })).id;
check('…the next calibration uses the new interval', (await due(nextCal)) === '2027-09-01');
await w('calibrations', 'update', oldCal, { remark: 'checked again' });
check('editing the remark of an old calibration keeps its due_date (still the interval of its time)', (await due(oldCal)) === '2026-01-01');
await w('calibrations', 'update', oldCal, { calibrated_at: '2025-01-01', remark: 'form sends every field' });
check('…also when a form sends calibrated_at unchanged along with the remark (no recompute with the new interval)', (await due(oldCal)) === '2026-01-01');
await w('calibrations', 'update', oldCal, { calibrated_at: '2025-02-01' });
check('editing calibrated_at recomputes that one due_date', (await due(oldCal)) === '2027-02-01');
check('the Setup change itself is in configuration_histories', Number((await one(`select count(*) as n from public.configuration_histories where table_name = 'calibration_configurations' and action = 'UPDATE'`)).n) === 1);

// ============================================================ M. nhật ký, import, recent_activities
const cLog = (await logs('equipment', tt))[0];
check('CREATE log: type, label, new_value with names, to_location, user', cLog.asset_type === 'equipment' && cLog.action === 'CREATE' && cLog.label === 'T1' && cLog.old_value === null
  && cLog.new_value.serial_number === 'T1' && cLog.new_value.location === 'L1' && cLog.new_value.part_number === 'PN-T' && cLog.to_location === 'L1' && cLog.user_id === actor);
await expectError('asset_logs is append-only (update)', db.query(`update public.asset_logs set label = 'x'`), 'HISTORY_IS_APPEND_ONLY');
await expectError('asset_logs is append-only (delete)', db.query(`delete from public.asset_logs`), 'HISTORY_IS_APPEND_ONLY');
check('an update that changes nothing writes no log', await (async () => { const n = (await logs('equipment', tt)).length; await w('equipment', 'update', tt, { remark: null }); return (await logs('equipment', tt)).length === n; })());
check('configuration changes go to configuration_histories', Number((await one(`select count(*) as n from public.configuration_histories where table_name = 'part_numbers' and action = 'CREATE'`)).n) === 7);

const impT = '11111111-1111-1111-1111-111111111111';
const impB = '22222222-2222-2222-2222-222222222222';
const impF = '33333333-3333-3333-3333-333333333333';
const nImp = await rpc('equipment_import', [JSON.stringify([
  { id: impF, serial_number: 'IMP-F', part_number_id: pn['PN-F'], location_id: L.L1, parent_id: impB },
  { id: impB, serial_number: 'IMP-B', part_number_id: pn['PN-B'], location_id: L.L1, parent_id: impT },
  { id: impT, serial_number: 'IMP-T', part_number_id: pn['PN-T'], location_id: L.L1 }]), actor]);
check('equipment_import inserts a child-before-parent file in one go', nImp.count === 3 && nImp.dry_run === false && (await eq(impF)).parent_id === impB);
await expectError('equipment_import: a bad parent kind rolls the whole file back', rpc('equipment_import', [JSON.stringify([
  { serial_number: 'IMP2-T', part_number_id: pn['PN-T'], location_id: L.L1, id: '44444444-4444-4444-4444-444444444444' },
  { serial_number: 'IMP2-T2', part_number_id: pn['PN-T'], location_id: L.L1, parent_id: '44444444-4444-4444-4444-444444444444' }]), actor]), 'PARENT_TYPE_INVALID');
check('…nothing from the bad file was inserted', Number((await one(`select count(*) as n from public.equipment where serial_number like 'IMP2-%'`)).n) === 0);
// Status (usage) and Tags (tag_ids) in an import file — the server sends them; a file from before they existed still works
check('equipment_import without usage / tag_ids (an older caller) gives Not in use and no tags', (await eq(impT)).usage === 'not_in_use' && (await eq(impF)).usage === 'not_in_use'
  && (await eq(impT)).tag_ids.length === 0);
const uT = '55555555-5555-5555-5555-555555555555';
const uB = '66666666-6666-6666-6666-666666666666';
const uF = '77777777-7777-7777-7777-777777777777';
const nUse = await rpc('equipment_import', [JSON.stringify([
  { id: uF, serial_number: 'IMPU-F', part_number_id: pn['PN-F'], location_id: L.L1, parent_id: uB, usage: 'in_use', tag_ids: [tag.Spare, tag.Repair] },
  { id: uB, serial_number: 'IMPU-B', part_number_id: pn['PN-B'], location_id: L.L1, parent_id: uT, usage: 'in_use' },
  { id: uT, serial_number: 'IMPU-T', part_number_id: pn['PN-T'], location_id: L.L1, usage: 'in_use', tag_ids: [tag.Waiting] }]), actor]);
check('equipment_import saves Status: a Tester In use with its Base and Fixture (child listed first), all In use',
  nUse.count === 3 && (await eq(uT)).usage === 'in_use' && (await eq(uB)).usage === 'in_use' && (await eq(uF)).usage === 'in_use');
check('equipment_import saves tag_ids in the order sent', JSON.stringify((await eq(uF)).tag_ids) === JSON.stringify([tag.Spare, tag.Repair]) && JSON.stringify((await eq(uT)).tag_ids) === JSON.stringify([tag.Waiting]) && (await eq(uB)).tag_ids.length === 0);
await expectError('equipment_import: In use without a parent (a Base) rolls the whole file back (USAGE_NEEDS_PARENT)', rpc('equipment_import', [JSON.stringify([
  { serial_number: 'IMPU2-T', part_number_id: pn['PN-T'], location_id: L.L1, usage: 'in_use' },
  { serial_number: 'IMPU2-B', part_number_id: pn['PN-B'], location_id: L.L1, usage: 'in_use' }]), actor]), 'USAGE_NEEDS_PARENT');
await expectError('equipment_import: an unknown tag id is refused (VALIDATION_ERROR)', rpc('equipment_import', [JSON.stringify([
  { serial_number: 'IMPU3-T', part_number_id: pn['PN-T'], location_id: L.L1, tag_ids: ['99999999-9999-9999-9999-999999999999'] }]), actor]), 'VALIDATION_ERROR');
check('…nothing from those two files was inserted', Number((await one(`select count(*) as n from public.equipment where serial_number like 'IMPU2-%' or serial_number like 'IMPU3-%'`)).n) === 0);
const nSub = await rpc('sub_equipment_import', [JSON.stringify([
  { serial_number: 'IMP-S1', part_number_id: pn['PN-DMM'], location_id: L.L1, tester_id: impT },
  { serial_number: 'IMP-S2', part_number_id: pn['PN-PSU'], location_id: L.L2 }]), actor]);
const nGold = await rpc('golden_import', [JSON.stringify([
  { part_number: 'GB', serial_number: 'IMP-G1', location_id: L.L1, parent_id: impF },
  { part_number: 'GB', serial_number: 'IMP-G2', location_id: L.L2 }]), actor]);
check('sub_equipment_import / golden_import insert rows', nSub.count === 2 && nGold.count === 2);
check('imported sub_equipment under a tester takes its location', (await one(`select location_id from public.sub_equipment where serial_number = 'IMP-S1'`)).location_id === L.L1);
const act = await q(`select module, item_count from public.recent_activities where module = 'equipment' and action = 'CREATE' and note is null and item_count > 1`);
check('recent_activities groups each import (two of 3 rows above) into one line', act.length === 2 && act.every((a) => Number(a.item_count) === 3), JSON.stringify(act));
const mods = (await q(`select distinct module from public.recent_activities order by 1`)).map((x) => x.module);
check('recent_activities modules', ['configuration', 'equipment', 'golden_board', 'sub_equipment', 'user'].every((m) => mods.includes(m)) && !mods.includes('calibration'), mods.join(','));
const calAct = await one(`select changes from public.recent_activities where module = 'sub_equipment' and action = 'CALIBRATE' limit 1`);
check('recent_activities rebuilds { field: { old, new } } from asset_logs', 'old' in calAct.changes.calibrated_at && 'new' in calAct.changes.calibrated_at);
check('user histories are in recent_activities too', (await q(`select 1 from public.recent_activities where module = 'user' and action = 'DISABLE'`)).length >= 1);

// ============================================================ N. Overview
const tO = await mkEq('TO', 'PN-T');
const sO1 = await mkSub('SO1', 'PN-DMM', { tester_id: tO });
const sO2 = await mkSub('SO2', 'PN-DMM', { tester_id: tO });
const sO3 = await mkSub('SO3', 'PN-DMM', { tester_id: tO });
await w('calibrations', 'insert', null, { sub_equipment_id: sO1, calibrated_at: old6 });
await w('calibrations', 'insert', null, { sub_equipment_id: sO2, calibrated_at: soon });
await w('calibrations', 'insert', null, { sub_equipment_id: sO3, calibrated_at: today });
const bO = await mkEq('BO', 'PN-B', { parent_id: tO });
await mkGold('GO', { parent_id: tO });
// ---- overview_board(): cột = tài sản gốc, nhóm theo Location, thẻ gốc + tối đa 3 thẻ con
const bd = (u = null, k = null, t = null) => q(`select * from public.overview_board($1, $2, $3)`, [u, k, t]);
const colOf = (rows, rootId) => rows.filter((r) => r.root_id === rootId).sort((x, y) => x.pos - y.pos);
const sns = (rows) => rows.map((r) => r.serial_number);
const inLoc = (rows, name) => rows.filter((r) => r.location === name);
const rootsOf = (rows, name) => sns(inLoc(rows, name).filter((r) => r.depth === 0));
const intact = (rows) => rows.every((r) => r.depth === 0 || rows.some((p) => p.id === r.parent_id && p.depth === r.depth - 1));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const ZB1 = (await w('locations', 'insert', null, { display_name: 'ZB-First', sort_order: -20 })).id;
const ZB2 = (await w('locations', 'insert', null, { display_name: 'ZB-Second', sort_order: -10 })).id;
await w('locations', 'insert', null, { display_name: 'ZB-Empty', sort_order: -30 });
const kid = (serial, p, parent, loc) => mkEq(serial, p, { parent_id: parent, location_id: loc });
const calibrate = (subId, date, result = 'pass') => w('calibrations', 'insert', null, { sub_equipment_id: subId, calibrated_at: date, result });
{
  // ZB-First: TB1 (2 bases, 2 fixtures, 2 golden boards, 3 sub-equipment — 9 below it), TB2 (a chain Base → Fixture → Golden), 3 loose assets
  const T1 = await mkEq('TB1', 'PN-T', { location_id: ZB1 });
  const B1 = await kid('BB1', 'PN-B', T1, ZB1);
  const B2 = await kid('BB2', 'PN-B', T1, ZB1);
  const F1 = await kid('FB1', 'PN-F', B1, ZB1);
  await kid('FB2', 'PN-F', B2, ZB1);
  await mkGold('GB1', { parent_id: F1 });
  await mkGold('GBT', { parent_id: T1 });
  const SO = await mkSub('SB-over', 'PN-DMM', { tester_id: T1 });
  const SS = await mkSub('SB-soon', 'PN-DMM', { tester_id: T1 });
  const SK = await mkSub('SB-ok', 'PN-DMM', { tester_id: T1 });
  await calibrate(SO, old6); await calibrate(SS, soon); await calibrate(SK, today);
  const T2 = await mkEq('TB2', 'PN-T', { location_id: ZB1 });
  const BX = await kid('BX', 'PN-B', T2, ZB1);
  const FX = await kid('FX', 'PN-F', BX, ZB1);
  await mkGold('GX', { parent_id: FX });
  await mkEq('LOOSE-B', 'PN-B', { location_id: ZB1 });
  await mkSub('LOOSE-S', 'PN-DMM2', { location_id: ZB1 });
  await mkGold('LOOSE-G', { location_id: ZB1 });
  // ZB-Second: TB3 (plain) and TB4 (a Base and four sub-equipment: failed, overdue, due soon, valid)
  await mkEq('TB3', 'PN-T', { location_id: ZB2 });
  const T4 = await mkEq('TB4', 'PN-T', { location_id: ZB2 });
  await kid('B4', 'PN-B', T4, ZB2);
  const S4 = {};
  for (const n of ['S4a', 'S4b', 'S4c', 'S4d']) S4[n] = await mkSub(n, 'PN-DMM', { tester_id: T4 });
  await calibrate(S4.S4a, today, 'fail'); await calibrate(S4.S4b, old6); await calibrate(S4.S4c, soon); await calibrate(S4.S4d, today);

  // ---------------------------------------------------------------- no filter
  const all = await bd();
  const c1 = colOf(all, T1);
  check('board: TB1 column = the root + 2 cards, 3 in all: the alerts first (overdue, then due soon) beat every Base / Fixture / Golden; drawn by serial',
    same(sns(c1), ['TB1', 'SB-over', 'SB-soon']), sns(c1).join(','));
  check('board: no unfiltered column has more than 3 cards, the root included', [...new Set(all.map((r) => r.root_id))].every((id) => colOf(all, id).length <= 3));
  const r1 = c1[0];
  check('board: root row — depth 0, pos 1, no parent, its own column key, Type / PN / SN, Location, matched false',
    r1.depth === 0 && r1.pos === 1 && r1.parent_id === null && r1.root_id === r1.id && r1.asset_type === 'equipment' && r1.kind === 'tester' && r1.type_name === 'Tester'
    && r1.part_number === 'PN-T' && r1.serial_number === 'TB1' && r1.location === 'ZB-First' && r1.location_id === ZB1 && r1.usage === 'not_in_use' && r1.matched === false, JSON.stringify(r1));
  check('board: "+N" = descendants of the root (9, the WHOLE tree) − the 2 shown below it = 7; alerts = 2; root cal_alert = the worst below it (overdue)',
    r1.descendants === 9 && r1.alerts === 2 && r1.cal_alert === 'overdue' && r1.descendants - (c1.length - 1) === 7, JSON.stringify(r1));
  const cSO = c1.find((r) => r.serial_number === 'SB-over'); const cSS = c1.find((r) => r.serial_number === 'SB-soon');
  check('board: a sub-equipment card carries its own cal_alert, Type name, PN, depth 1 and parent', cSO.cal_alert === 'overdue' && cSS.cal_alert === 'due_soon' && cSO.asset_type === 'sub_equipment'
    && cSO.kind === 'sub_equipment' && cSO.type_name === 'DMM' && cSO.part_number === 'PN-DMM' && cSO.depth === 1 && cSO.parent_id === T1 && cSO.alerts === 1 && cSO.descendants === 0);
  check('board: neither a Base nor the "valid" sub-equipment is shown while two alerts need the room', !c1.some((r) => ['BB1', 'BB2', 'SB-ok'].includes(r.serial_number)));
  check('board: the tree of a column is never broken (every card\'s parent is in the column)', intact(c1));
  check('board: with no filter nothing is "matched"', all.every((r) => r.matched === false));

  const c2 = colOf(all, T2);
  check('board: a chain Tester → Base → Fixture → Golden: the Base and the Fixture under it fill the 3 cards exactly (a Fixture needs its Base); the Golden is "+1"',
    same(sns(c2), ['TB2', 'BX', 'FX']) && same(c2.map((r) => r.depth), [0, 1, 2]) && c2[2].parent_id === c2[1].id && c2[1].parent_id === c2[0].id
    && c2[0].descendants === 3 && c2[0].descendants - (c2.length - 1) === 1 && c2[1].kind === 'base' && c2[1].descendants === 2 && c2[1].cal_alert === null && c2[1].alerts === 0);
  const c4 = colOf(all, T4);
  check('board: failed and overdue come first (same rank, by serial) and take the room before due soon, a Base and a valid sub: those are "+3"',
    same(sns(c4), ['TB4', 'S4a', 'S4b']) && c4[0].descendants === 5 && c4[0].descendants - (c4.length - 1) === 3 && c4[0].alerts === 3, sns(c4).join(','));
  check('board: cal_alert distinguishes failed from overdue and the root shows the worst (failed)', c4[0].cal_alert === 'failed' && c4[1].cal_alert === 'failed' && c4[2].cal_alert === 'overdue');

  check('board: inside a Location the roots are Testers first, then loose assets (Base / Golden / Sub), each by serial',
    same(rootsOf(all, 'ZB-First'), ['TB1', 'TB2', 'LOOSE-B', 'LOOSE-G', 'LOOSE-S']), rootsOf(all, 'ZB-First').join(','));
  const loose = all.filter((r) => ['LOOSE-B', 'LOOSE-G', 'LOOSE-S'].includes(r.serial_number));
  check('board: a loose asset is a column of its own: no parent, not a tester, nothing below it',
    loose.length === 3 && loose.every((r) => r.parent_id === null && r.depth === 0 && r.kind !== 'tester' && r.descendants === 0 && r.root_id === r.id && r.pos === 1));
  const locOrder = [...new Set(all.map((r) => r.location))];
  check('board: Locations in sort_order (negative first), an empty Location never appears, each Location is one block of rows',
    locOrder[0] === 'ZB-First' && locOrder[1] === 'ZB-Second' && !locOrder.includes('ZB-Empty') && locOrder.includes('L1')
    && all.every((r, i) => i === 0 || r.location === all[i - 1].location || all.findIndex((x) => x.location === r.location) === i), locOrder.join(','));
  check('board: a column lives in exactly one Location', [...new Set(all.map((r) => r.root_id))].every((id) => new Set(colOf(all, id).map((r) => r.location_id)).size === 1));
  const hdr = (rows, name) => {
    const rs = inLoc(rows, name).filter((r) => r.depth === 0);
    return [rs.filter((r) => r.kind === 'tester').length, rs.filter((r) => r.usage === 'in_use').length, rs.reduce((n, r) => n + r.alerts, 0)];
  };
  check('board: the section header numbers come from the root rows — testers · In use · ⚠ (sub-equipment with an alert): ZB-First 2 · 0 · 2, ZB-Second 2 · 0 · 3',
    same(hdr(all, 'ZB-First'), [2, 0, 2]) && same(hdr(all, 'ZB-Second'), [2, 0, 3]), JSON.stringify([hdr(all, 'ZB-First'), hdr(all, 'ZB-Second')]));

  // ---------------------------------------------------------------- the 3-card limit
  {
    // QZ-B1 and QZ-S3 match "mm"; QZ-F2 matches too but hangs under NN-B2 (unmatched): it would need NN-B2 + QZ-F2 = 2 cards, only 1 is left
    const ZB3 = (await w('locations', 'insert', null, { display_name: 'ZB-Third', sort_order: -5 })).id;
    const T5 = await mkEq('TB5', 'PN-T', { location_id: ZB3 });
    await kid('QZ-B1', 'PN-B', T5, ZB3);
    const NB = await kid('NN-B2', 'PN-B', T5, ZB3);
    await kid('QZ-F2', 'PN-F', NB, ZB3);
    await mkSub('QZ-S3', 'PN-DMM', { tester_id: T5 });
    const c5 = colOf(await bd(null, null, 'qz'), T5);
    check('board 3-card limit: a card that does not fit (QZ-F2 needs its Base as well) is skipped and the next that fits (QZ-S3) is taken; the first matched card is always shown',
      same(sns(c5), ['TB5', 'QZ-B1', 'QZ-S3']) && same(c5.filter((r) => r.matched).map((r) => r.serial_number), ['QZ-B1', 'QZ-S3']) && c5[0].descendants === 4, sns(c5).join(','));
    const u5 = colOf(await bd(), T5);
    check('board 3-card limit: with no filter the same column is the root + two Bases (kind order, then serial), and the Fixture and the Sub are "+2"',
      same(sns(u5), ['TB5', 'NN-B2', 'QZ-B1']) && u5[0].descendants - (u5.length - 1) === 2, sns(u5).join(','));
  }

  // ---------------------------------------------------------------- filters
  await expectError('board: bad usage filter', q(`select * from public.overview_board('maybe')`), 'VALIDATION_ERROR');
  await expectError('board: bad kind filter', q(`select * from public.overview_board(null, 'robot')`), 'VALIDATION_ERROR');

  const sx = await bd(null, null, 'gx');
  check('board search (SN, case-insensitive): only the column holding the match stays, the match is highlighted, the chain above it shows',
    same(rootsOf(sx, 'ZB-First'), ['TB2']) && !sx.some((r) => r.location === 'ZB-Second') && same(colOf(sx, T2).filter((r) => r.matched).map((r) => r.serial_number), ['GX'])
    && same(sns(colOf(sx, T2)), ['TB2', 'BX', 'FX', 'GX']) && colOf(sx, T2)[0].descendants === 3);
  check('board: the ONE exception to the 3-card limit — the first matched card always shows with its parents, so a Golden at level 3 makes a 4-card column',
    colOf(sx, T2).length === 4 && colOf(sx, T2)[3].depth === 3 && colOf(sx, T2)[3].matched === true);
  const sk = colOf(await bd(null, null, ' sb-OK '), T1);
  check('board search finds a card that normally hides behind "+N" (SB-ok is the 5th by priority): matched cards are chosen BEFORE alerts, and ranked by serial after',
    same(sns(sk), ['TB1', 'SB-ok', 'SB-over']) && same(sk.filter((r) => r.matched).map((r) => r.serial_number), ['SB-ok']) && sk[0].descendants === 9, sns(sk).join(','));
  check('board search by part number (PN-DMM2 → the loose sub-equipment only, in ZB-First; ZB-Second drops out)',
    same(rootsOf(await bd(null, null, 'dmm2'), 'ZB-First'), ['LOOSE-S']) && !(await bd(null, null, 'dmm2')).some((r) => r.location === 'ZB-Second'));
  check('board search: "%" and "_" are plain characters, not wildcards (a wildcard would match every card)', (await bd(null, null, '%')).filter((r) => r.location.startsWith('ZB')).length === 0 && (await bd(null, null, '_')).filter((r) => r.location.startsWith('ZB')).length === 0);
  check('board search: blank text is no filter', (await bd(null, null, '   ')).length === (await bd()).length);

  const gk = await bd(null, 'golden_board');
  const gT1 = colOf(gk, T1);
  check('board kind filter (golden_board): only columns holding a golden board; the matched cards come first and pull their fixture and base so the tree is not cut',
    same(rootsOf(gk, 'ZB-First'), ['TB1', 'TB2', 'LOOSE-G']) && !gk.some((r) => r.location === 'ZB-Second')
    && same(sns(gT1), ['TB1', 'BB1', 'FB1', 'GB1']) && same(gT1.map((r) => r.depth), [0, 1, 2, 3]) && intact(gT1)
    && same(gT1.filter((r) => r.matched).map((r) => r.serial_number), ['GB1']), sns(gT1).join(','));
  check('board kind filter: the pulled-in parents are not "matched"; the other golden board (GBT) waits behind "+N" because the parents of the first took the room; "+N" counts the whole tree (9 − 3 shown = 6)',
    gT1.filter((r) => ['BB1', 'FB1'].includes(r.serial_number)).every((r) => r.matched === false) && !gT1.some((r) => r.serial_number === 'GBT') && gT1[0].descendants - (gT1.length - 1) === 6);
  check('board kind filter (tester): every tester column, matched = the testers', (await bd(null, 'tester')).filter((r) => r.matched).every((r) => r.kind === 'tester' && r.depth === 0));

  // Status: check TB1 out (it and everything below go In use), look at both filters, then undo
  await rpc('asset_set_usage', [refs(['equipment', T1]), 'in_use', actor, null]);
  const iu = await bd('in_use');
  check('board In use filter: only the In use tree stays (ZB-Second has none → the Location disappears); every card of it is matched',
    same(rootsOf(iu, 'ZB-First'), ['TB1']) && !iu.some((r) => r.location === 'ZB-Second') && colOf(iu, T1).every((r) => r.matched && r.usage === 'in_use') && hdr(iu, 'ZB-First')[1] === 1
    && same(sns(colOf(iu, T1)), ['TB1', 'SB-over', 'SB-soon']), sns(colOf(iu, T1)).join(','));
  check('board In use filter: every card matches, so the alerts still come first (same order as with no filter)', same(sns(colOf(iu, T1)), sns(c1)));
  const nu = await bd('not_in_use');
  check('board Not in use filter: the In use tree is gone, the others stay and every shown card is Not in use',
    same(rootsOf(nu, 'ZB-First'), ['TB2', 'LOOSE-B', 'LOOSE-G', 'LOOSE-S']) && inLoc(nu, 'ZB-Second').length > 0 && nu.filter((r) => r.location.startsWith('ZB')).every((r) => r.matched && r.usage === 'not_in_use'));
  await rpc('asset_set_usage', [refs(['sub_equipment', SK]), 'not_in_use', actor, null]);
  const part = colOf(await bd('not_in_use'), T1);
  check('board: a column is kept when ONLY a child matches (one sub checked in under an In use tester): that card is shown and highlighted, the root is not',
    same(sns(part), ['TB1', 'SB-ok', 'SB-over']) && same(part.filter((r) => r.matched).map((r) => r.serial_number), ['SB-ok']) && part[0].matched === false && part[0].usage === 'in_use');
  check('board: filters combine with AND (In use + "tb1" → only the root matches; Not in use + "tb1" → TB1 is not matched by anything below it, so no column)',
    same(colOf(await bd('in_use', null, 'tb1'), T1).filter((r) => r.matched).map((r) => r.serial_number), ['TB1'])
    && (await bd('not_in_use', null, 'tb1')).filter((r) => r.root_id === T1).length === 0);
  await rpc('asset_set_usage', [refs(['equipment', T1]), 'not_in_use', actor, null]);
  check('board: after the check-in nothing of TB1 is In use any more', (await bd('in_use')).filter((r) => r.root_id === T1).length === 0);
}
check('board: only the server role can call it (anon / authenticated cannot)',
  (await one(`select has_function_privilege('service_role', 'public.overview_board(text,text,text)', 'execute') as s,
     has_function_privilege('anon', 'public.overview_board(text,text,text)', 'execute') as a,
     has_function_privilege('authenticated', 'public.overview_board(text,text,text)', 'execute') as u`)).s === true
  && (await one(`select has_function_privilege('anon', 'public.overview_board(text,text,text)', 'execute') as a, has_function_privilege('authenticated', 'public.overview_board(text,text,text)', 'execute') as u`)).a === false);
check('board: no function of the old tree Overview is left in a fresh build',
  (await q(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('overview_children', 'overview_unattached_count')`)).length === 0);

// ---- asset_tree(): cây chứa một tài sản, từ gốc xuống mọi con cháu, một lần gọi
const tr = (t, id) => q(`select * from public.asset_tree($1, $2)`, [t, id]);
{
  const TA = await mkEq('TA', 'PN-T');
  const BA = await mkEq('BA', 'PN-B', { parent_id: TA });
  const FA = await mkEq('FA', 'PN-F', { parent_id: BA });
  const FA2 = await mkEq('FA2', 'PN-F', { parent_id: TA });
  const GA = await mkGold('GA', { parent_id: FA });
  const SA1 = await mkSub('SA1', 'PN-DMM', { tester_id: TA });
  const SA2 = await mkSub('SA2', 'PN-DMM', { tester_id: TA });
  await calibrate(SA2, old6);
  const LA = await mkEq('LA', 'PN-B');
  const TZ = await mkEq('TZ', 'PN-T');
  await mkSub('SZ', 'PN-DMM', { tester_id: TZ });

  const full = await tr('equipment', TA);
  check('tree: from the tester — preorder; siblings Base → Fixture → Golden → Sub, then serial; depths 0,1,2,3,1,1,1; pos 1..7',
    same(sns(full), ['TA', 'BA', 'FA', 'GA', 'FA2', 'SA1', 'SA2']) && same(full.map((r) => r.depth), [0, 1, 2, 3, 1, 1, 1]) && same(full.map((r) => r.pos), [1, 2, 3, 4, 5, 6, 7]), sns(full).join(','));
  check('tree: the same tree, row for row, from a Base, a Fixture, a Golden board, a Fixture under the tester and a Sub-equipment (the root is found by walking up)',
    same(await tr('equipment', BA), full) && same(await tr('equipment', FA), full) && same(await tr('golden_board', GA), full)
    && same(await tr('equipment', FA2), full) && same(await tr('sub_equipment', SA1), full));
  const byId = new Map(full.map((r) => [r.id, r]));
  check('tree: the root has no parent; every other row names a parent that is in the tree and one level up',
    full[0].parent_id === null && full.slice(1).every((r) => byId.has(r.parent_id) && byId.get(r.parent_id).depth === r.depth - 1));
  const rA = full[0]; const rG = byId.get(GA); const rS2 = byId.get(SA2); const rS1 = byId.get(SA1);
  check('tree: Type name, part number, serial, usage — tester "Tester / PN-T"; golden board has kind golden_board, no Type name and a free-text PN; sub-equipment has the Type DMM',
    rA.asset_type === 'equipment' && rA.kind === 'tester' && rA.type_name === 'Tester' && rA.part_number === 'PN-T' && rA.usage === 'not_in_use'
    && rG.asset_type === 'golden_board' && rG.kind === 'golden_board' && rG.type_name === null && rG.part_number === 'GB-PN' && rG.parent_id === FA
    && rS2.asset_type === 'sub_equipment' && rS2.kind === 'sub_equipment' && rS2.type_name === 'DMM' && rS2.part_number === 'PN-DMM' && rS2.parent_id === TA);
  const calOf = async (id) => (await one(`select status from public.sub_equipment_calibration where sub_equipment_id = $1`, [id])).status;
  check('tree: cal_status of a sub-equipment is exactly its Calibration Status (SA1 never calibrated, SA2 overdue); every other row has none',
    rS1.cal_status === (await calOf(SA1)) && rS2.cal_status === (await calOf(SA2)) && rS1.cal_status !== rS2.cal_status && rS2.cal_status === 'overdue'
    && full.filter((r) => r.asset_type !== 'sub_equipment').every((r) => r.cal_status === null), JSON.stringify([rS1.cal_status, rS2.cal_status]));
  const sub = await q(`select s.asset_type, s.id from public.asset_subtree('equipment', $1) s order by 2`, [TA]);
  check('tree: exactly the members of asset_subtree(root) — no more, no fewer; the other tree (TZ) is not in it',
    same(sub.map((r) => r.id), full.map((r) => r.id).sort()) && !sns(full).includes('TZ') && !sns(full).includes('SZ'));
  check('tree: a loose asset is a tree of one row (depth 0, no parent); an unknown id and an unknown type give no rows',
    same(sns(await tr('equipment', LA)), ['LA']) && (await tr('equipment', LA))[0].depth === 0 && (await tr('equipment', LA))[0].parent_id === null
    && (await tr('equipment', '00000000-0000-0000-0000-000000000000')).length === 0 && (await tr('robot', TA)).length === 0);
  await rpc('asset_set_usage', [refs(['equipment', TA]), 'in_use', actor, null]);
  check('tree: usage follows the database (TA checked out → In use)', (await tr('equipment', BA))[0].usage === 'in_use');
  check('tree: only the server role can call it',
    (await one(`select has_function_privilege('service_role', 'public.asset_tree(text,uuid)', 'execute') as s,
       has_function_privilege('anon', 'public.asset_tree(text,uuid)', 'execute') as a, has_function_privilege('authenticated', 'public.asset_tree(text,uuid)', 'execute') as u`)).s === true
    && (await one(`select has_function_privilege('anon', 'public.asset_tree(text,uuid)', 'execute') as a, has_function_privilege('authenticated', 'public.asset_tree(text,uuid)', 'execute') as u`)).a === false);
}

// ============================================================ O. tra cứu, serial, remark
const vpFix = await q(`select * from public.valid_parents('equipment', null, 'fixture')`);
check('valid parents of a fixture: testers and bases', vpFix.length > 0 && vpFix.every((r) => ['tester', 'base'].includes(r.kind)) && vpFix.some((r) => r.kind === 'tester') && vpFix.some((r) => r.kind === 'base'));
check('valid parents of a base: testers only', (await q(`select * from public.valid_parents('equipment', null, 'base')`)).every((r) => r.kind === 'tester'));
check('a tester has no valid parent', (await q(`select * from public.valid_parents('equipment', null, 'tester')`)).length === 0);
check('valid parents of a sub_equipment: testers; of a golden board: testers and fixtures',
  (await q(`select * from public.valid_parents('sub_equipment')`)).every((r) => r.kind === 'tester') && (await q(`select * from public.valid_parents('golden_board')`)).every((r) => ['tester', 'fixture'].includes(r.kind)));
check('valid parents of an existing fixture take the kind from the row', (await q(`select * from public.valid_parents('equipment', $1)`, [fA])).every((r) => ['tester', 'base'].includes(r.kind)));
check('valid parents filter by serial / part number, "%" is literal', (await q(`select * from public.valid_parents('equipment', null, 'fixture', 'sw-ta')`)).length === 1
  && (await q(`select * from public.valid_parents('equipment', null, 'fixture', '%')`)).length === 0);
await rpc('asset_set_usage', [refs(['equipment', tO]), 'in_use', actor, null]);
const vpUse = await q(`select * from public.valid_parents('sub_equipment', $1)`, [sO1]);
check("valid_parents never blocks on Status: no usable / blocked_reason, usage_after = the Status the asset would take (the parent's)",
  vpUse.length > 0 && vpUse.every((r) => !('usable' in r) && !('blocked_reason' in r) && r.usage_after === r.usage) && vpUse.some((r) => r.usage_after === 'in_use') && vpUse.some((r) => r.usage_after === 'not_in_use'));
await expectError('valid_parents needs the kind for a new equipment', q(`select * from public.valid_parents('equipment')`), 'VALIDATION_ERROR');
await rpc('asset_set_usage', [refs(['equipment', tO]), 'not_in_use', actor, null]);

await mkEq('SW-FD', 'PN-F', { parent_id: tB, location_id: L.L2 });   // same parent and location as SW-FA now
const swF = await q(`select * from public.swap_candidates('equipment', $1)`, [fA]);
check('swap candidates of a fixture: only other fixtures', swF.length > 0 && swF.every((r) => r.kind === 'fixture' && r.id !== fA) && swF.some((r) => r.id === fB));
check('swap candidates carry parent, location, usage and same_place', swF.find((r) => r.id === fB).parent_serial === 'SW-BA' && swF.some((r) => r.same_place === true));
const swS = await q(`select * from public.swap_candidates('sub_equipment', $1)`, [sb]);
check('swap candidates of a sub_equipment: same Type only', swS.length > 0 && swS.every((r) => r.type_name === 'DMM' && r.id !== sb));
const swG = await q(`select * from public.swap_candidates('golden_board', $1)`, [gT]);
check('swap candidates of a golden board: every other golden board', swG.length === Number((await one(`select count(*) - 1 as n from public.golden_boards`)).n));
check('swap candidates filter by text and honour the limit', (await q(`select * from public.swap_candidates('equipment', $1, 'SW-FB')`, [fA])).length === 1 && (await q(`select * from public.swap_candidates('golden_board', $1, null, 2)`, [gT])).length === 2);
await expectError('swap candidates of an unknown asset → NOT_FOUND', q(`select * from public.swap_candidates('equipment', '00000000-0000-0000-0000-000000000000')`), 'NOT_FOUND');

await mkEq('DupSN', 'PN-B');
await mkSub('dupsn', 'PN-DMM');
const dupG = await mkGold(' DUPSN ');
check('serial_matches: trimmed, case-insensitive, across all three tables', (await q(`select * from public.serial_matches($1)`, ['  dupSn '])).length === 3);
check('serial_matches can leave out the record being edited', (await q(`select * from public.serial_matches($1, 'golden_board', $2)`, ['DupSN', dupG])).length === 2);
check('serial_matches finds nothing for a new serial', (await q(`select * from public.serial_matches($1)`, ['NOPE-XYZ'])).length === 0);
check('lower(serial_number) indexes exist on all three tables', (await q(`select indexdef from pg_indexes where indexname in ('equipment_serial_lower_idx', 'sub_equipment_serial_lower_idx', 'golden_boards_serial_lower_idx')`)).length === 3);
await w('equipment', 'update', tt, { remark: 'x'.repeat(1000) });
await expectError('remark longer than 1000 characters refused (equipment)', w('equipment', 'update', tt, { remark: 'x'.repeat(1001) }), 'equipment_remark_length');
await expectError('…sub_equipment', w('sub_equipment', 'update', sT, { remark: 'x'.repeat(1001) }), 'sub_equipment_remark_length');
await expectError('…golden_boards', w('golden_boards', 'update', g1, { remark: 'x'.repeat(1001) }), 'golden_boards_remark_length');
await expectError('…calibrations', w('calibrations', 'insert', null, { sub_equipment_id: sT, calibrated_at: today, remark: 'x'.repeat(1001) }), 'calibrations_remark_length');

check('no In use child under a Not in use parent anywhere', Number((await one(`select
  (select count(*) from public.equipment c join public.equipment p on p.id = c.parent_id where c.usage = 'in_use' and p.usage <> 'in_use')
  + (select count(*) from public.sub_equipment c join public.equipment p on p.id = c.tester_id where c.usage = 'in_use' and p.usage <> 'in_use')
  + (select count(*) from public.golden_boards c join public.equipment p on p.id = c.parent_id where c.usage = 'in_use' and p.usage <> 'in_use') as n`)).n) === 0);
check('no asset that needs a parent is In use without one', Number((await one(`select
  (select count(*) from public.equipment e join public.types t on t.id = e.type_id where e.usage = 'in_use' and e.parent_id is null and t.kind <> 'tester')
  + (select count(*) from public.sub_equipment where usage = 'in_use' and tester_id is null)
  + (select count(*) from public.golden_boards where usage = 'in_use' and parent_id is null) as n`)).n) === 0);

// ============================================================ P. DRY RUN ⇔ THẬT — mọi hàm có p_dry_run
// Với từng hàm (và từng biến thể / kiểu tài sản):
//   1. gọi p_dry_run = true  → dry_run = true; KHÔNG bảng nào đổi (kể cả asset_logs: số dòng + nội dung mọi dòng của mọi bảng);
//   2. gọi thật ngay sau đó  → count / deleted / usage_changes / changes[] giống hệt lần xem trước;
//   3. lần gọi thật đã ghi đúng những dòng asset_logs mà nó báo trong changes[];
//   4. hàm lỗi: dry run báo cùng mã lỗi với lần thật và cũng không đổi gì.
// Cuối cùng so danh sách hàm có tham số p_dry_run trong database với danh sách đã kiểm tra: thiếu hàm nào là FAIL.
const ALL_TABLES = (await q(`select tablename from pg_tables where schemaname = 'public' order by 1`)).map((r) => r.tablename);
const fullSnap = async () => {
  const out = {};
  for (const t of ALL_TABLES) out[t] = await one(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`);
  return JSON.stringify(out);
};
const deepSort = (x) => (Array.isArray(x) ? x.map(deepSort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, deepSort(x[k])])) : x);
const sortJson = (arr) => arr.map((x) => JSON.stringify(deepSort(x))).sort();
const canonResult = (r) => JSON.stringify({ count: r.count, deleted: r.deleted, usage_changes: r.usage_changes, changes: sortJson(r.changes) });
const asChange = (r) => ({
  asset_type: r.asset_type, asset_id: r.asset_id, label: r.label, action: r.action,
  from_location: r.from_location, to_location: r.to_location, reason: r.reason, old_value: r.old_value, new_value: r.new_value,
});
const covered = new Set();
let hseq = 0;

const mkTree = async () => {
  const k = ++hseq;
  const T = await mkEq(`HT${k}`, 'PN-T');
  const T2 = await mkEq(`HT${k}b`, 'PN-T', { location_id: L.L2 });
  const B = await mkEq(`HB${k}`, 'PN-B', { parent_id: T });
  const F = await mkEq(`HF${k}`, 'PN-F', { parent_id: B });
  const F2 = await mkEq(`HF${k}b`, 'PN-F', { parent_id: T2, location_id: L.L2 });
  const S = await mkSub(`HS${k}`, 'PN-DMM', { tester_id: T });
  const S2 = await mkSub(`HS${k}b`, 'PN-DMM', { tester_id: T2 });
  const SP = await mkSub(`HP${k}`, 'PN-PSU', { tester_id: T });
  const G = await mkGold(`HG${k}`, { parent_id: F });
  const G2 = await mkGold(`HG${k}b`, { parent_id: F2 });
  const SL = await mkSub(`HL${k}`, 'PN-DMM', { location_id: L.L3 });
  const GL = await mkGold(`HGL${k}`, { location_id: L.L3 });
  await w('calibrations', 'insert', null, { sub_equipment_id: S, calibrated_at: today });
  return { T, T2, B, F, F2, S, S2, SP, G, G2, SL, GL };
};
const mkBusy = async () => {
  const c = await mkTree();
  await rpc('asset_set_usage', [refs(['equipment', c.T]), 'in_use', actor, null]);  // T, B, F, S, SP, G in use; T2 side idle
  return c;
};

async function dryVsReal(label, fnName, setup, call, { importLike = false } = {}) {
  covered.add(fnName);
  const ctx = await setup();
  const s0 = await fullSnap();
  const ids0 = (await q(`select id from public.asset_logs`)).map((r) => r.id);
  let dry;
  try { dry = await call(ctx, true); } catch (e) { check(`${label}: dry run does not fail`, false, e.message); return null; }
  check(`${label}: dry run answers dry_run = true`, dry.dry_run === true);
  check(`${label}: dry run leaves EVERY table untouched (asset_logs and all other rows)`, (await fullSnap()) === s0);
  let real;
  try { real = await call(ctx, false); } catch (e) { check(`${label}: real call does not fail`, false, e.message); return null; }
  check(`${label}: real call answers dry_run = false`, real.dry_run === false);
  check(`${label}: result of the dry run = result of the real call (count, deleted, usage_changes, changes[])`, canonResult(dry) === canonResult(real),
    canonResult(dry).slice(0, 220) + '  <>  ' + canonResult(real).slice(0, 220));
  const written = await q(`select asset_type, asset_id, label, action, from_location, to_location, reason, old_value, new_value from public.asset_logs where not (id = any($1::uuid[]))`, [ids0]);
  if (importLike) {
    check(`${label}: the real call wrote ${real.count} CREATE rows (changes[] is empty by design for imports)`, real.changes.length === 0 && written.length === real.count && written.every((x) => x.action === 'CREATE'));
  } else {
    check(`${label}: the preview is not empty`, real.changes.length > 0);
    check(`${label}: the real call wrote exactly the asset_logs rows that changes[] reported`, JSON.stringify(sortJson(written.map(asChange))) === JSON.stringify(sortJson(real.changes)),
      `${written.length} written vs ${real.changes.length} reported`);
  }
  check(`${label}: count = number of distinct assets with a log row`, real.count === new Set(written.map((x) => `${x.asset_type}:${x.asset_id}`)).size);
  return { ctx, dry, real, written };
}

async function dryFails(label, fnName, setup, call, code) {
  covered.add(fnName);
  const ctx = await setup();
  const s0 = await fullSnap();
  let eDry = '';
  let eReal = '';
  try { await call(ctx, true); } catch (e) { eDry = e.message; }
  check(`${label}: dry run raises ${code}`, eDry.includes(code), eDry || 'no error');
  check(`${label}: nothing changed after the failed dry run`, (await fullSnap()) === s0);
  try { await call(ctx, false); } catch (e) { eReal = e.message; }
  check(`${label}: the real call raises the same ${code}`, eReal.includes(code), eReal || 'no error');
  check(`${label}: nothing changed after the failed real call either`, (await fullSnap()) === s0);
}

// ---- asset_change_location
await dryVsReal('asset_change_location (equipment)', 'asset_change_location', mkTree, (c, d) => rpc('asset_change_location', ['equipment', c.T, L.L3, actor, d]));
await dryVsReal('asset_change_location (sub_equipment)', 'asset_change_location', mkTree, (c, d) => rpc('asset_change_location', ['sub_equipment', c.SL, L.L2, actor, d]));
await dryVsReal('asset_change_location (golden_board)', 'asset_change_location', mkTree, (c, d) => rpc('asset_change_location', ['golden_board', c.GL, L.L2, actor, d]));

// ---- asset_move (always allowed; usage follows the new parent)
await dryVsReal('asset_move (idle fixture → base)', 'asset_move', mkTree, (c, d) => rpc('asset_move', ['equipment', c.F2, c.B, actor, d]));
{
  const r = await dryVsReal('asset_move (In use fixture → idle tester)', 'asset_move', mkBusy, (c, d) => rpc('asset_move', ['equipment', c.F, c.T2, actor, d]));
  if (r) check('…usage_changes names the fixture and its golden board (in_use → not_in_use)', r.dry.usage_changes.length === 2 && r.dry.usage_changes.every((u) => u.from === 'in_use' && u.to === 'not_in_use')
    && r.dry.usage_changes.some((u) => u.asset_type === 'golden_board'), JSON.stringify(r.dry.usage_changes));
}
{
  const r = await dryVsReal('asset_move (idle base → In use tester)', 'asset_move', async () => {
    const c = await mkTree(); await rpc('asset_set_usage', [refs(['equipment', c.T2]), 'in_use', actor, null]); return c;
  }, (c, d) => rpc('asset_move', ['equipment', c.B, c.T2, actor, d]));
  if (r) check('…base, fixture and golden board go not_in_use → in_use', r.dry.usage_changes.length === 3 && r.dry.usage_changes.every((u) => u.from === 'not_in_use' && u.to === 'in_use'));
}
await dryVsReal('asset_move (sub_equipment)', 'asset_move', mkTree, (c, d) => rpc('asset_move', ['sub_equipment', c.S, c.T2, actor, d]));
await dryVsReal('asset_move (golden_board)', 'asset_move', mkTree, (c, d) => rpc('asset_move', ['golden_board', c.G, c.F2, actor, d]));
{
  const r = await dryVsReal('asset_move (In use sub_equipment → idle tester)', 'asset_move', mkBusy, (c, d) => rpc('asset_move', ['sub_equipment', c.S, c.T2, actor, d]));
  if (r) check('…usage_changes: the sub_equipment goes in_use → not_in_use', r.dry.usage_changes.length === 1 && r.dry.usage_changes[0].from === 'in_use' && r.dry.usage_changes[0].to === 'not_in_use');
}

// ---- asset_detach
await dryVsReal('asset_detach (equipment)', 'asset_detach', mkTree, (c, d) => rpc('asset_detach', ['equipment', c.B, actor, d]));
{
  const r = await dryVsReal('asset_detach (In use base)', 'asset_detach', mkBusy, (c, d) => rpc('asset_detach', ['equipment', c.B, actor, d]));
  if (r) check('…usage_changes: base, fixture and golden board go in_use → not_in_use', r.dry.usage_changes.length === 3 && r.dry.usage_changes.every((u) => u.from === 'in_use' && u.to === 'not_in_use'));
}
await dryVsReal('asset_detach (sub_equipment)', 'asset_detach', mkTree, (c, d) => rpc('asset_detach', ['sub_equipment', c.S, actor, d]));
await dryVsReal('asset_detach (golden_board)', 'asset_detach', mkTree, (c, d) => rpc('asset_detach', ['golden_board', c.G, actor, d]));

// ---- asset_swap
await dryVsReal('asset_swap (fixtures)', 'asset_swap', mkBusy, (c, d) => rpc('asset_swap', ['equipment', c.F, c.F2, actor, d]));
await dryVsReal('asset_swap (testers)', 'asset_swap', mkBusy, (c, d) => rpc('asset_swap', ['equipment', c.T, c.T2, actor, d]));
await dryVsReal('asset_swap (sub_equipment)', 'asset_swap', mkBusy, (c, d) => rpc('asset_swap', ['sub_equipment', c.S, c.S2, actor, d]));
await dryVsReal('asset_swap (sub_equipment with a loose one)', 'asset_swap', mkBusy, (c, d) => rpc('asset_swap', ['sub_equipment', c.S, c.SL, actor, d]));
await dryVsReal('asset_swap (golden_board)', 'asset_swap', mkBusy, (c, d) => rpc('asset_swap', ['golden_board', c.G, c.G2, actor, d]));
await dryVsReal('asset_swap (golden_board with a loose one)', 'asset_swap', mkTree, (c, d) => rpc('asset_swap', ['golden_board', c.G, c.GL, actor, d]));

// ---- asset_delete
{
  const r = await dryVsReal('asset_delete (tester with children)', 'asset_delete', mkTree, (c, d) => rpc('asset_delete', ['equipment', c.T, actor, d]));
  if (r) check('…only the tester is deleted; base and the 2 sub_equipment are detached (golden under the fixture stays where it is)', r.dry.deleted === 1 && r.dry.changes.filter((x) => x.action === 'DETACH').length === 3);
}
await dryVsReal('asset_delete (base)', 'asset_delete', mkTree, (c, d) => rpc('asset_delete', ['equipment', c.B, actor, d]));
{
  const r = await dryVsReal('asset_delete (sub_equipment with a calibration)', 'asset_delete', mkTree, (c, d) => rpc('asset_delete', ['sub_equipment', c.S, actor, d]));
  if (r) check('…its calibrations go with it, logged only as the sub_equipment DELETE', r.dry.deleted === 1 && !r.dry.changes.some((x) => x.action === 'CALIBRATION_REMOVE'));
}
await dryVsReal('asset_delete (golden_board)', 'asset_delete', mkTree, (c, d) => rpc('asset_delete', ['golden_board', c.G, actor, d]));

// ---- asset_set_usage
await dryVsReal('asset_set_usage (Check-out a tree, with a note)', 'asset_set_usage', mkTree, (c, d) => rpc('asset_set_usage', [refs(['equipment', c.T]), 'in_use', actor, 'about to run', d]));
await dryVsReal('asset_set_usage (Check-in a tree)', 'asset_set_usage', mkBusy, (c, d) => rpc('asset_set_usage', [refs(['equipment', c.T]), 'not_in_use', actor, null, d]));
await dryVsReal('asset_set_usage (two roots)', 'asset_set_usage', mkTree, (c, d) => rpc('asset_set_usage', [refs(['equipment', c.T], ['equipment', c.T2]), 'in_use', actor, null, d]));
await dryVsReal('asset_set_usage (parent + child together)', 'asset_set_usage', mkTree, (c, d) => rpc('asset_set_usage', [refs(['equipment', c.T], ['golden_board', c.G]), 'in_use', actor, null, d]));
await dryVsReal('asset_set_usage (Check-in one child)', 'asset_set_usage', mkBusy, (c, d) => rpc('asset_set_usage', [refs(['sub_equipment', c.S]), 'not_in_use', actor, null, d]));

// ---- imports
const newId = () => crypto.randomUUID();
await dryVsReal('equipment_import', 'equipment_import', async () => ({ a: newId(), b: newId(), c: newId() }), (c, d) => rpc('equipment_import', [JSON.stringify([
  { id: c.c, serial_number: `IMPF${c.c.slice(0, 4)}`, part_number_id: pn['PN-F'], location_id: L.L1, parent_id: c.b },
  { id: c.b, serial_number: `IMPB${c.b.slice(0, 4)}`, part_number_id: pn['PN-B'], location_id: L.L1, parent_id: c.a },
  { id: c.a, serial_number: `IMPT${c.a.slice(0, 4)}`, part_number_id: pn['PN-T'], location_id: L.L1 }]), actor, d]), { importLike: true });
await dryVsReal('sub_equipment_import', 'sub_equipment_import', mkTree, (c, d) => rpc('sub_equipment_import', [JSON.stringify([
  { serial_number: `IMPS${hseq}a`, part_number_id: pn['PN-DMM'], location_id: L.L1, tester_id: c.T2 },
  { serial_number: `IMPS${hseq}b`, part_number_id: pn['PN-PSU'], location_id: L.L3 }]), actor, d]), { importLike: true });
await dryVsReal('golden_import', 'golden_import', mkTree, (c, d) => rpc('golden_import', [JSON.stringify([
  { part_number: 'GB', serial_number: `IMPG${hseq}a`, location_id: L.L1, parent_id: c.F },
  { part_number: 'GB', serial_number: `IMPG${hseq}b`, location_id: L.L3 }]), actor, d]), { importLike: true });

// ---- the same functions failing: same error in dry run and for real, nothing written either way
await dryFails('asset_change_location', 'asset_change_location', mkBusy, (c, d) => rpc('asset_change_location', ['equipment', c.T, L.L3, actor, d]), 'EQUIPMENT_IN_USE');
await dryFails('asset_move', 'asset_move', mkTree, (c, d) => rpc('asset_move', ['equipment', c.F, c.F2, actor, d]), 'PARENT_TYPE_INVALID');
await dryFails('asset_detach', 'asset_detach', mkTree, (c, d) => rpc('asset_detach', ['equipment', c.T, actor, d]), 'EQUIPMENT_HAS_NO_PARENT');
await dryFails('asset_swap', 'asset_swap', mkTree, (c, d) => rpc('asset_swap', ['equipment', c.F, c.B, actor, d]), 'SWAP_TYPE_MISMATCH');
await dryFails('asset_swap (sub_equipment types)', 'asset_swap', mkTree, (c, d) => rpc('asset_swap', ['sub_equipment', c.S, c.SP, actor, d]), 'SWAP_TYPE_MISMATCH');
await dryFails('asset_delete', 'asset_delete', mkBusy, (c, d) => rpc('asset_delete', ['golden_board', c.G, actor, d]), 'EQUIPMENT_IN_USE');
await dryFails('asset_set_usage', 'asset_set_usage', mkTree, (c, d) => rpc('asset_set_usage', [refs(['sub_equipment', c.S]), 'in_use', actor, null, d]), 'PARENT_NOT_IN_USE');
await dryFails('equipment_import', 'equipment_import', async () => ({ a: newId() }), (c, d) => rpc('equipment_import', [JSON.stringify([
  { id: c.a, serial_number: `BADT${c.a.slice(0, 4)}`, part_number_id: pn['PN-T'], location_id: L.L1 },
  { serial_number: `BADT2${c.a.slice(0, 4)}`, part_number_id: pn['PN-T'], location_id: L.L1, parent_id: c.a }]), actor, d]), 'PARENT_TYPE_INVALID');
await dryFails('sub_equipment_import', 'sub_equipment_import', mkTree, (c, d) => rpc('sub_equipment_import', [JSON.stringify([
  { serial_number: `BADS${hseq}`, part_number_id: pn['PN-T'], location_id: L.L1 }]), actor, d]), 'TYPE_KIND_INVALID');
await dryFails('golden_import', 'golden_import', mkTree, (c, d) => rpc('golden_import', [JSON.stringify([
  { part_number: 'GB', serial_number: `BADG${hseq}`, location_id: L.L1, parent_id: c.B }]), actor, d]), 'PARENT_TYPE_INVALID');

// ---- completeness: every function that has p_dry_run is covered
const withDryRun = (await q(`select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and 'p_dry_run' = any (p.proargnames) and p.proname <> 'asset_op_result' order by 1`)).map((r) => r.proname);
check(`every database function with p_dry_run is covered by this harness (${withDryRun.length}: ${withDryRun.join(', ')})`,
  JSON.stringify(withDryRun) === JSON.stringify([...covered].sort()), `db: ${withDryRun.join(',')} · tested: ${[...covered].sort().join(',')}`);
check('there are exactly 9 such functions', withDryRun.length === 9);

// ============================================================ Q. migration bỏ hai hàm Overview cũ
const oldFns = async () => (await q(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('overview_children', 'overview_unattached_count') order by 1`)).map((r) => r.proname);
await db.exec(`create function public.overview_children(p_parent_type text, p_parent_id uuid default null) returns integer language sql as 'select 1';
  create function public.overview_unattached_count() returns integer language sql as 'select 1';`);
check('(setup) a database upgraded from the tree Overview still has the two old functions', same(await oldFns(), ['overview_children', 'overview_unattached_count']));
await db.exec(sql('04_functions.sql'));
check('04_functions.sql run on that database leaves the old functions alone (the old Overview page keeps working until the app is switched)', (await oldFns()).length === 2);
const migOv = readFileSync(join(root, 'database', 'migrations', '2026-10-09_overview_board.sql'), 'utf8');
// the migration refuses to drop anything while the new functions the new app needs are missing
for (const [fn, drop] of [['asset_tree', 'drop function public.asset_tree(text, uuid)'], ['overview_board', 'drop function public.overview_board(text, text, text)']]) {
  await db.exec(drop);
  let refused = false;
  try { await db.exec(migOv); } catch (e) { refused = /04_functions/.test(String(e.message ?? e)); }
  await db.exec('rollback').catch(() => {});
  check(`migration refuses to run, dropping nothing, while ${fn} is missing`, refused && (await oldFns()).length === 2);
  await db.exec(sql('04_functions.sql'));
}
const migRes = await db.exec(migOv);
const migRow = migRes[migRes.length - 1].rows[0];
check('migration 2026-10-09_overview_board drops them; its check row says 0 old functions, 1 overview_board, 1 asset_tree', (await oldFns()).length === 0 && Number(migRow.old_overview_functions) === 0 && Number(migRow.overview_board) === 1 && Number(migRow.asset_tree) === 1, JSON.stringify(migRow));
await db.exec(migOv);
check('…and running it again is harmless', (await oldFns()).length === 0);

// ============================================================ R. quy mô — 820 tài sản, database riêng
{
  const big = new PGlite();
  await big.exec('create role anon; create role authenticated; create role service_role;');
  await big.exec('create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());');
  await big.exec(noExt(sql('02_schema.sql')));
  await big.exec(sql('03_seed.sql'));
  await big.exec(sql('04_functions.sql'));
  await big.exec(`
    insert into public.locations (display_name, sort_order) select 'S' || g, g from generate_series(1, 5) g;
    insert into public.types (display_name, kind) values ('DMM', 'sub_equipment');
    insert into public.part_numbers (display_name, type_id) select 'P-' || t.kind, t.id from public.types t;
    insert into public.equipment (serial_number, part_number_id, location_id)
      select 'T' || lpad(g::text, 3, '0'), (select id from public.part_numbers where display_name = 'P-tester'),
             (select id from public.locations where display_name = 'S' || (g % 5 + 1)) from generate_series(1, 60) g;
    insert into public.equipment (serial_number, part_number_id, location_id, parent_id)
      select 'B' || t.serial_number, (select id from public.part_numbers where display_name = 'P-base'), t.location_id, t.id from public.equipment t where t.serial_number like 'T%';
    insert into public.equipment (serial_number, part_number_id, location_id, parent_id)
      select 'F' || b.serial_number, (select id from public.part_numbers where display_name = 'P-fixture'), b.location_id, b.id from public.equipment b where b.serial_number like 'BT%';
    insert into public.golden_boards (serial_number, part_number, location_id, parent_id)
      select 'G' || f.serial_number, 'GB', f.location_id, f.id from public.equipment f where f.serial_number like 'FBT%';
    insert into public.sub_equipment (serial_number, part_number_id, location_id, tester_id)
      select 'S' || t.serial_number || n, (select id from public.part_numbers where display_name = 'P-sub_equipment'), t.location_id, t.id
      from public.equipment t cross join generate_series(1, 8) n where t.serial_number like 'T%';
    insert into public.sub_equipment (serial_number, part_number_id, location_id)
      select 'LS' || g, (select id from public.part_numbers where display_name = 'P-sub_equipment'), (select id from public.locations where display_name = 'S1') from generate_series(1, 100) g;`);
  const total = Number((await big.query(`select (select count(*) from public.equipment) + (select count(*) from public.sub_equipment) + (select count(*) from public.golden_boards) as n`)).rows[0].n);
  const t0 = performance.now();
  const rows = (await big.query(`select * from public.overview_board()`)).rows;
  const ms = Math.round(performance.now() - t0);
  const roots = rows.filter((r) => r.depth === 0);
  // Measured ~50 ms. A version whose CTE was recomputed once per card took 110 s on this data — the limit is there to catch that kind of slip.
  check(`scale: ${total} assets → one call in ${ms} ms (PGlite, in-memory), under 3 s`, total === 820 && ms < 3000, `${total} assets, ${ms} ms`);
  check('scale: 160 columns (60 testers + 100 loose), 3 cards per tester column (root + Base + its Fixture) and 1 per loose one — 280 rows, not 820',
    roots.length === 160 && rows.length === 280 && roots.filter((r) => r.kind === 'tester').every((r) => r.descendants === 11 && rows.filter((x) => x.root_id === r.root_id).length === 3));
  const first = rows.filter((r) => r.location === 'S1');
  check('scale: S1 holds 12 testers and the 100 loose subs; testers come first', first.filter((r) => r.depth === 0 && r.kind === 'tester').length === 12 && first.findIndex((r) => r.depth === 0 && r.kind !== 'tester') >= 36 && rows[0].location === 'S1');
  // asset_tree on the biggest realistic column: one tester with 400 sub-equipment on top of the 820 assets above
  await big.exec(`insert into public.sub_equipment (serial_number, part_number_id, location_id, tester_id)
    select 'XS' || g, (select id from public.part_numbers where display_name = 'P-sub_equipment'), t.location_id, t.id
    from public.equipment t cross join generate_series(1, 400) g where t.serial_number = 'T001'`);
  const tid = (await big.query(`select id from public.equipment where serial_number = 'T001'`)).rows[0].id;
  const t1 = performance.now();
  const tree = (await big.query(`select * from public.asset_tree('equipment', $1)`, [tid])).rows;
  const treeMs = Math.round(performance.now() - t1);
  check(`scale: asset_tree of a tester with 411 assets below it (400 sub-equipment) → ${tree.length} rows in ${treeMs} ms, under 1 s`,
    tree.length === 412 && treeMs < 1000 && tree[0].serial_number === 'T001' && tree.every((r, i) => r.pos === i + 1), `${tree.length} rows, ${treeMs} ms`);
  const t2 = performance.now();
  const leaf = (await big.query(`select * from public.asset_tree('sub_equipment', (select id from public.sub_equipment where serial_number = 'XS7'))`)).rows;
  const leafMs = Math.round(performance.now() - t2);
  check(`scale: the same tree asked from one of its sub-equipment → same ${leaf.length} rows in ${leafMs} ms`, leaf.length === 412 && leafMs < 1000);
  await big.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
