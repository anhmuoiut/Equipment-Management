# Database

PostgreSQL on Supabase. The schema is the baseline, [`database/migrations/20261015000000_baseline.sql`](../database/migrations/20261015000000_baseline.sql), plus the migrations after it, run in file-name order: [`20261016000000_list_views_and_dashboard_summary.sql`](../database/migrations/20261016000000_list_views_and_dashboard_summary.sql) adds list views and `dashboard_summary`; [`20261017000000_stop_configuration_history.sql`](../database/migrations/20261017000000_stop_configuration_history.sql) stops Configuration auditing; [`20261018000000_sub_equipment_part_number_metadata.sql`](../database/migrations/20261018000000_sub_equipment_part_number_metadata.sql) adds Sub-equipment Description/Manufacturer search and sorting. Required data (the system Types and this site's Configuration lists) is in [`database/seed.sql`](../database/seed.sql). To build a project from zero see [DEPLOY.md](DEPLOY.md).

**17 tables, 5 views, 56 functions, 47 triggers, 72 indexes. No enums, no RLS policies, no storage buckets, no cron jobs.** The comments inside the SQL are in Vietnamese; this document is the English reference.

## 1. Security model

| Rule | How it is enforced |
| --- | --- |
| Only the server touches data | Row level security is **on for all 17 tables with no policies** (deny all). The browser only ever holds the publishable key, which can read nothing. |
| The server uses the service key | `service_role` bypasses RLS. Permissions therefore live in the app (`withAuth`, see [ARCHITECTURE.md](ARCHITECTURE.md)), not in the database. |
| Nobody else can call anything | `revoke ... from public, anon, authenticated` on every table, sequence, function and view, then `grant ... to service_role`. Both blocks are at the end of Part A (tables) and Part B (functions) of the baseline. **Never remove them**: without them anyone with the publishable key could call `app_write` / `asset_*` directly. |
| No privilege escalation through views | All five views are `security_invoker = true`; only `service_role` can read them. |
| No search-path tricks | Every function sets `search_path = ''` and uses fully qualified names. |

[DEPLOY.md](DEPLOY.md) §3 has a read-only query that checks table, view, function and RLS counts on a live project.

## 2. Conventions

- Every table has `id uuid primary key default gen_random_uuid()`; all links use `id`, never text.
- `display_name` is the label users see (unique, case-insensitive, in every configuration list); `sort_order` orders dropdowns.
- `created_at/updated_at` (`timestamptz`) and `created_by/updated_by` (→ `user_profiles`). `updated_at` is set by trigger `set_updated_at`.
- **Configuration rows are hidden, not deleted** (`is_active = false`), except `tags` and `calibration_configurations`, which are really deleted (a tag in use cannot be deleted).
- Assets (`equipment`, `sub_equipment`, `golden_boards`) are really deleted; accounts are never deleted, only locked.
- Serial numbers are **not unique**: a duplicate only produces a warning (`serial_matches`). The database trims whitespace.
- Status is called `usage` in the schema (`in_use` / `not_in_use`).
- Form fields are fixed in code. Admins do not configure labels or required flags.

## 3. Tables

### 3.1 Accounts

| Table | Purpose | Key columns |
| --- | --- | --- |
| `user_profiles` | One row per account. **`id` equals `auth.users.id`** (FK `on delete restrict`: an account cannot be deleted from the Supabase dashboard while a profile exists). Access to the app requires a profile **and** `is_active`. | `username` (unique, `^[a-z0-9][a-z0-9._+-]{0,63}$`, login email is `<username>@jabil.local`), `full_name`, `employee_id`, `department_id`, `role` (`admin`/`user`/`readonly`), `is_active`, `must_change_password` |
| `user_histories` | Account log (append-only). | `user_id` (no FK on purpose), `label`, `action` (`CREATE`, `UPDATE`, `ROLE_CHANGE`, `DISABLE`, `ENABLE`, `PASSWORD_RESET`), `changes` jsonb, `note`, `source`, `created_by`, `action_id` |

### 3.2 Configuration (admin-managed lists)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `type_groups` | Group of a Type (Configuration › Group). Three system groups (`tester`, `base`, `fixture`) are locked; every group an admin adds has `kind = sub_equipment`. | `display_name`, `kind`, `sort_order`, `is_active` |
| `types` | Equipment type. `kind` always equals the group's kind (trigger). Tester / Base / Fixture are locked system rows. | `display_name`, `kind`, `group_id` |
| `part_numbers` | Part numbers. The Type of every device carrying it is derived from here. | `display_name`, `type_id`, `level_id` (optional default for new devices), `manufacturer` (optional), `description` |
| `locations`, `levels`, `departments`, `calibration_vendors` | Plain lists. | `display_name`, `sort_order`, `is_active` |
| `tags` | Condition tags with a pastel colour. | `display_name`, `sort_order`, `color` (`green`/`yellow`/`red`/`blue`/`gray`/`purple`) |
| `calibration_configurations` | Calibration setup, one per sub-equipment part number. | `part_number_id` (unique), `interval_months`, `warning_days` |

### 3.3 Assets

| Table | Purpose | Key columns |
| --- | --- | --- |
| `equipment` | Tester / Base / Fixture tree. Kind = `types.kind`. | `part_number_id`, `serial_number`, `jabil_id`, `asset`, `type_id` (forced from the part number), `level_id`, `location_id`, `usage`, `remark` (≤1000), `tag_ids uuid[]`, `parent_id` (self FK, `on delete restrict`) |
| `sub_equipment` | Devices that need calibration, inside a tester. | as above, plus `tester_id` (→ `equipment`, `on delete set null`); no level |
| `calibrations` | One row per calibration done. Latest row drives the status. | `sub_equipment_id` (cascade), `calibrated_at`, `due_date`, `vendor_id`, `cert_no`, `cert_file_url` (a link, no file storage), `result` (`pass`/`fail`), `remark` |
| `golden_boards` | Known-good PCBAs. Part number is free text. | `part_number`, `serial_number`, `utd_part_number`, `origin`, `purpose`, `parent_id` (→ `equipment`, `on delete set null`), `location_id`, `usage`, `tag_ids` |
| `asset_logs` | One shared log for the three asset tables and their calibrations (append-only). | `asset_type`, `asset_id` (no FK: the log outlives the asset), `label` (serial at that time), `action`, `old_value`/`new_value` (changed fields only), `from_location`/`to_location`, `reason`, `source`, `user_id`, `action_id` |
| `error_log` | Server errors (5xx) with the request id shown to the user. Rows older than 90 days are purged by a trigger on insert. | `request_id`, `route`, `user_id`, `error_code`, `message`, `stack` |

`asset_logs.action` is one of `CREATE`, `UPDATE`, `CHANGE_LOCATION`, `MOVE`, `DETACH`, `SWAP`, `CHECK_OUT`, `CHECK_IN`, `TAGS`, `DELETE`, `CALIBRATE`, `CALIBRATION_UPDATE`, `CALIBRATION_REMOVE`. The action is recognised from the changed fields (only location changed → `CHANGE_LOCATION`, only tags → `TAGS`, parent changed → `MOVE`/`DETACH`) except `SWAP`, `CHECK_OUT` and `CHECK_IN`, which the operation functions set.

### 3.4 Relations

```
part_numbers ──► types ──► type_groups          part_numbers ──► levels (optional default)
calibration_configurations ──► part_numbers (unique)
equipment ──► part_numbers, types, levels, locations, equipment (parent_id)
sub_equipment ──► part_numbers, types, locations, equipment (tester_id)
calibrations ──► sub_equipment, calibration_vendors
golden_boards ──► locations, equipment (parent_id)
user_profiles ──► auth.users, departments
tag_ids (uuid[]) on the 3 asset tables ··► tags            (checked by trigger, no FK possible)
asset_logs / *_histories ··► the row they describe          (no FK on purpose)
```

## 4. The asset tree

```
Tester
 ├─ sub_equipment             (sub_equipment.tester_id)
 ├─ golden_board              (golden_boards.parent_id)
 ├─ Fixture                   (a Fixture may sit directly under a Tester)
 │   └─ golden_board
 └─ Base
     └─ Fixture
         └─ golden_board
```

| Child | Allowed parent | May be unattached |
| --- | --- | --- |
| Tester | none | always |
| Base | Tester | yes |
| Fixture | Base or Tester | yes |
| sub_equipment | Tester | yes |
| golden board | Tester or Fixture | yes |

- Wrong parent kind is refused everywhere (form, move, swap, import, script): `PARENT_TYPE_INVALID`. The equipment rule is checked **after the statement**, so an Excel import may list a parent after its child.
- The kind of an equipment never changes after creation (its part number can only change to one of the same Type).
- **Location**: a child always has its parent's location (the database sets it). When a parent moves, the whole subtree moves.
- **Level** (equipment only): a child always has its parent's level; changing a parent's level cascades down.
- **Children always follow**: change location, move and swap carry the whole subtree. To leave a child behind, detach it first.
- **Delete** (`asset_delete`): direct children are kept and become unattached and *Not in use* (log `DETACH`, reason `parent_deleted:<SN>`). `equipment.parent_id` is `restrict`, so there is no silent cascade. A sub-equipment's calibrations are deleted with it.

### Status (usage)

- Check-out → `in_use`, Check-in → `not_in_use` (`asset_set_usage`). The selected assets **and all their descendants** change in one transaction.
- Attaching to a parent (or adding under one) **takes the parent's status**. Detaching, or the parent being deleted, sets *Not in use*.
- **Only a Tester can be *In use* without a parent.** Base, Fixture, sub-equipment and golden boards need a parent (`USAGE_NEEDS_PARENT`).
- Checking out **one child alone** while its parent is not in use is refused (`PARENT_NOT_IN_USE`); checking out parent and child together is fine.
- *In use* assets cannot be deleted or have their location changed (`EQUIPMENT_IN_USE`). **Move is always allowed**: the asset and its subtree take the new parent's status, location and level; the preview lists every status change (`usage_changes`).

### Swap

Two assets of the **same kind** exchange parent and location. Equipment must have the same Type; sub-equipment the same Type; golden boards any. Each side gets a `SWAP` log row with reason `swap_with:<SN>`. Different kind → `SWAP_TYPE_MISMATCH`; nothing would change → `SWAP_NO_CHANGE`.

### Calibration status (view `sub_equipment_calibration`)

Computed from the **latest** calibration (largest `calibrated_at`) and the part number's setup. "Today" is Vietnam time (`Asia/Ho_Chi_Minh`).

| Status | When |
| --- | --- |
| `not_calibrated` | no calibration yet |
| `failed` | latest result is `fail` |
| `overdue` | `due_date` has passed |
| `due_soon` | `due_date` within `warning_days` (30 if the part number has no setup) |
| `valid` | otherwise |

`due_date = calibrated_at + interval_months` is computed by trigger when a calibration is added (or `calibrated_at` edited). Changing a setup's interval never rewrites existing due dates. A part number without a setup needs `due_date` typed in (`CALIBRATION_INTERVAL_MISSING`).

### Tags

`tag_ids` is an array checked on every write: duplicates removed, every id must exist. The app lets a user pick **one** tag; older rows with several keep showing them. Deleting a tag in use is refused (`TAG_IN_USE`).

## 5. Views

| View | Purpose |
| --- | --- |
| `sub_equipment_calibration` | One row per sub-equipment: latest calibration, setup (`interval_months`, `warning_days`) and the computed `status`. The single source for the Calibration list, Overview and Dashboard. |
| `recent_actions` | **Dashboard "Recent changes", one row per user action.** Groups `asset_logs` and `user_histories` rows that share an `action_id`. Columns: `id`, `module` (of the lead record), `modules[]` (every module touched), `action`, `source`, `created_by`, `created_at` (start of the action), `item_count`, `records` (jsonb, at most 50, lead record first), `search_text` (names/serials of all records, for search). Rows without an `action_id` (written by hand in SQL) each count as their own action; old import rows still group by (module, user, time). |

### List views (Masterlist: paging, search, filter, sort in the database)

Created by migration `20261016000000` (not part of the baseline).

`equipment_list`, `sub_equipment_list` and `golden_list` are what the three list screens read, **one page at a time** (PostgREST `range` + exact `count`). They add to the table's own columns what the screen needs to filter, sort and search without downloading the table:

| Column | Meaning |
| --- | --- |
| `part_number`, `type`, `level`, `location`, `vendor` | Display names of the foreign keys (the screen still shows names from its cached Configuration; these exist for filtering and sorting). |
| `description`, `manufacturer` (sub-equipment) | Live metadata from the Part Number, added by migration `20261018000000`. Included in `search_text`, with `description_nk` / `manufacturer_nk` for sorting and Manufacturer available as a text filter. |
| `parent_serial` / `tester_serial` | Serial of the parent equipment / tester. |
| `tags_text` | Tag names joined with `, ` in Configuration order — exactly the text of the Tags column. |
| `has_children` (equipment) | Has a child in any of the three asset tables. |
| `status`, `calibration_id`, `calibrated_at`, `due_date`, `result`, … (sub-equipment) | Latest calibration and Calibration Status from `sub_equipment_calibration`. |
| `search_text` | Every text column of the row, lower-cased, separated by `chr(31)`: one `ilike` searches all columns, as the old in-browser search did (dates as ISO text). Status words are matched by the browser, which knows the translated labels, and sent as `qe=`. |
| `*_nk` (`serial_nk`, `part_nk`, …) | "Natural" sort key from `natural_key()` (SN2 before SN10, case-insensitive, empty last when ascending). Computed only when the list is sorted by that column. |

No table changed and no data moved. With 2,000 assets a page, a search and a count each take a few milliseconds; no extra index was needed (the `ilike '%text%'` scan covers a few thousand rows).

## 6. Activity log and `action_id`

1. Every audited table has a `<table>_write_history` trigger (5 tables: `equipment`, `sub_equipment`, `golden_boards`, `calibrations`, `user_profiles`) that writes the log row **in the same transaction** as the change. The server never inserts log rows itself. **Configuration lists are not audited** (migration `20261017000000`): changing a Location, Part number, Tag and so on leaves no log row.
2. Who/why comes from transaction-local settings (`set_ctx` → `set_config(..., true)`): actor, action, note, source, `action_id`. They cannot leak between requests.
3. `withAuth` creates **one `action_id` per API request** (AsyncLocalStorage, `lib/services/core/actionContext.ts`). `appWrite` / `rpc` pass it as `p_action_id` to the ten write functions: `app_write`, `asset_change_location`, `asset_move`, `asset_detach`, `asset_swap`, `asset_delete`, `asset_set_usage`, `equipment_import`, `sub_equipment_import`, `golden_import`. Without one (scripts, SQL) the function makes its own.
4. So Swap (two rows), Move with children, Check-out of a tree, an Excel import or a multi-step form edit each show as **one** line in Recent changes, while each record's History tab still shows its own rows.
5. Log tables are append-only (`HISTORY_IS_APPEND_ONLY`). Passwords are never in any table of this project.

## 7. Functions

### 7.1 Called by the app (16)

| Function | Purpose |
| --- | --- |
| `app_write(table, op, id, data, actor, action, note, source, action_id)` | The one door for insert/update/delete of a row. Only an allow-list of tables (the three asset tables, `calibrations`, `user_profiles` and the nine configuration lists) is writable; only columns present in `data` are written, never the audit columns; accounts can never be deleted. Returns the row. |
| `asset_change_location`, `asset_move`, `asset_detach`, `asset_swap`, `asset_delete`, `asset_set_usage` | The six tree operations, shared by all three asset types (`p_type`). Each takes `p_dry_run`. |
| `equipment_import`, `sub_equipment_import`, `golden_import` | Insert every row of an Excel file in one transaction (one bad row → nothing is inserted). Server pre-validates; log rows get `source = import`. |
| `valid_parents(type, id, kind, q, limit)` | Allowed parents for an asset (existing: `id`; new: `kind`), each with `usage_after`. |
| `swap_candidates(type, id, q, limit)` | Assets that can be swapped with this one, with `same_place`. |
| `serial_matches(serial, exclude_type, exclude_id)` | Duplicate serial check across all three tables (trimmed, case-insensitive). |
| `overview_board(usage, kind, q)` | The whole Overview board in one call: one column per root asset grouped by location, at most 3 cards per column, filters done in the database. Keeps `enable_nestloop = off` and `materialized` CTEs for speed (820 assets ≈ 50 ms); `assets.test.mjs` has a scale test. |
| `dashboard_summary(p_list_limit)` | **Every Dashboard number in one call** (jsonb, about 10 KB): totals and In use / Not in use per asset type, counts by Calibration Status, by Location, by Type (golden boards = "No type") and by Tag (plus `untagged`), and the `p_list_limit` (15) most overdue and most due-soon sub-equipment (oldest due date first). Replaces reading every asset row to count in JavaScript. Names are added by the server from the cached Configuration. |
| `asset_tree(type, id)` | The tree containing an asset: from its root down, all three tables, one call (equipment modal tree tab, child chips, calibration summary). |

**Dry run.** Every operation function accepts `p_dry_run`. It runs the full logic with every trigger and the real error codes, then rolls back, and returns the same shape as a real run: `{ dry_run, count, deleted, usage_changes[], changes[] }`. The UI uses it for the preview and to show errors before the main button is pressed; import uses it to validate a whole file.

### 7.2 Internal helpers (19)

`ctx`, `set_ctx` (transaction context) · `natural_key` (natural sort key for the list views) · `history_ref_label`, `history_tag_names`, `history_diff`, `asset_log_changes` (turn row diffs into `{field: {old, new}}`) · `asset_log_marks`, `asset_op_result` (collect what an operation logged, for the result) · `equipment_kind`, `asset_parent_allowed`, `asset_parent`, `asset_children`, `asset_subtree`, `asset_usage`, `asset_serial`, `asset_lock` (tree lookups and row locking) · `equipment_cascade_location`, `asset_cascade_usage` (push location/status down a subtree).

### 7.3 Trigger functions (21)

| Function | Used by | Purpose |
| --- | --- | --- |
| `set_updated_at` | 14 tables | Keep `updated_at` current. |
| `prevent_history_change` | 2 log tables | Refuse update/delete (`HISTORY_IS_APPEND_ONLY`). |
| `purge_old_error_log` | `error_log` | Delete rows older than 90 days after each insert. |
| `write_history` | 5 tables | Write the log row (see §6). |
| `user_admin_guard` | `user_profiles` | An admin cannot lock/demote themselves (`ADMIN_SELF_CHANGE`) or the last active admin (`LAST_ADMIN`). |
| `serial_trim` | 3 asset tables | Trim serial whitespace. |
| `asset_type_from_part_number` | equipment, sub_equipment | Force `type_id` from the part number; check the Type kind fits the table. |
| `part_number_type_guard` | `part_numbers` | Changing a part number's Type is refused once devices use it (`PART_NUMBER_IN_USE`). |
| `types_group_kind`, `types_system_lock`, `type_groups_system_lock` | `types`, `type_groups` | Type kind follows its group; the three system Types and Groups cannot be deleted, hidden or re-kinded. |
| `equipment_parent_rule`, `leaf_from_parent` | equipment; sub_equipment and golden_boards | Parent kind rule; location and status follow the parent. |
| `equipment_level_from_parent`, `equipment_level_cascade` | `equipment` | Level follows the parent and cascades to children. |
| `equipment_usage_from_parent` | `equipment` | A new child takes its parent's status. |
| `asset_usage_rule` | 3 asset tables | Only a Tester can be *In use* without a parent. |
| `tag_ids_check`, `tag_delete_check` | 3 asset tables; `tags` | Validate `tag_ids`; refuse deleting a tag in use. |
| `calibration_compute_due` | `calibrations` | Compute `due_date` from the setup. |
| `calibration_configuration_kind` | `calibration_configurations` | A setup is only for sub-equipment part numbers. |

## 8. Database error codes

Raised as `raise exception 'CODE'`; the server maps them to a translated message (`lib/errors`, `src/i18n/locales/*.json › errors`).

| Code | When |
| --- | --- |
| `PARENT_TYPE_INVALID` · `PARENT_NOT_FOUND` | wrong parent kind · parent missing |
| `PARENT_NOT_IN_USE` | checking out one child while its parent is not in use |
| `USAGE_NEEDS_PARENT` · `USAGE_NO_CHANGE` | *In use* without a parent · nothing to change |
| `EQUIPMENT_IN_USE` | delete / change location of an *In use* asset |
| `EQUIPMENT_HAS_NO_PARENT` · `LOCATION_INHERITED_READ_ONLY` | detach with no parent · change location of an asset that has a parent |
| `SWAP_TYPE_MISMATCH` · `SWAP_NO_CHANGE` | different kind · nothing would change |
| `TYPE_KIND_INVALID` · `TYPE_SYSTEM_LOCKED` | part number of the wrong kind · editing a system Type/Group |
| `PART_NUMBER_IN_USE` | changing the Type of a part number in use |
| `CALIBRATION_INTERVAL_MISSING` | no setup and no `due_date` |
| `TAG_IN_USE` | deleting a tag that is assigned |
| `NOT_FOUND` · `VALIDATION_ERROR` | missing · invalid input |
| `ADMIN_SELF_CHANGE` · `LAST_ADMIN` | admin protection |
| `HISTORY_IS_APPEND_ONLY` | editing a log row |

## 9. Changing the database later

Add a new file `database/migrations/YYYYMMDDHHMMSS_name.sql` (one transaction, safe to read top to bottom). **Never edit the baseline** once a project has been built from it. Keep the security pattern: new functions are `security invoker`, `set search_path = ''`, followed by `revoke ... from public, anon, authenticated` and `grant execute ... to service_role` (the baseline ends with a blanket version of this; a migration that creates a function must repeat it). If `database/seed.sql` changes, change step 3 of `database/tools/reset_after_testing.sql` too (it holds a copy of the seed rows). The pre-baseline schema files and the database tests are in git history, not in the working tree.
