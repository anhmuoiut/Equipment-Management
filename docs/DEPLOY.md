# Deploy, test and operate

How to set up a Supabase project and a Vercel deployment from zero, how to test it before users arrive, how to go live, and how to run it afterwards. For the design see [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE.md](DATABASE.md).

**Contents:** [1 What you need](#1-what-you-need) · [2 Supabase project](#2-create-the-supabase-project) · [3 Build the database](#3-build-the-database) · [4 Vercel](#4-vercel) · [5 GitHub](#5-github-actions) · [6 Preview](#6-test-on-a-vercel-preview) · [7 Test checklist](#7-manual-test-checklist) · [8 Go live](#8-go-live) · [9 Releases and migrations](#9-releases-and-future-migrations) · [10 Operations](#10-operations-runbook) · [11 Local development](#11-local-development) · [12 Troubleshooting](#12-troubleshooting)

## 1. What you need

- A **Supabase** account (the project, its SQL Editor and its dashboard settings).
- A **Vercel** account connected to the GitHub repository (Git integration gives you a Production deployment for `main` and a Preview for every other branch).
- **GitHub** repository access (Actions secrets).
- Node.js 24.9 or newer and `npm` for local work and for the first-admin script.

Three values from Supabase are the app's whole configuration. **All three must come from the same project.**

| Variable | Where it is used | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser and server; sign-in only (legacy name `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works) | no (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only, `lib/supabase/admin.ts` | **yes — never commit or expose** |

`.env.example` shows the format. Other places that hold a secret: the GitHub secret `SUPABASE_DB_URL` (backup workflow) and the GitHub variable `APP_URL` (keepalive; not secret).

## 2. Create the Supabase project

1. **New project.** Choose the **region closest to the Vercel Functions region you will use** (§4); most latency is round trips between the two. Free or Pro: the free tier pauses after a week of inactivity and has no automatic backups ([§10.8](#108-project-paused), [§10.7](#107-backup-and-restore)). Pro is recommended for production.
2. **Authentication → Sign In / Providers**
   - **Allow new users to sign up: OFF.** The publishable key is public, so open sign-up would let anyone create Auth users.
   - Keep only **Email** enabled; **Confirm email: OFF** (accounts use internal addresses `<username>@jabil.local`; the server creates users already confirmed).
3. **Authentication → Rate Limits**: raise sign-ins per IP (for example to a few hundred per 5 minutes). The default (~30) can lock out a whole factory behind one public IP.
4. **Project Settings → JWT Keys**: use **asymmetric signing keys** (new projects normally have one; if the page shows only the legacy secret, create/migrate to a signing key). The app does not need it today (it asks Auth who the caller is on every request), but it is required if `getClaims()` is adopted later for speed, and it costs nothing now.
5. **Project Settings → API Keys**: copy the project URL, the **publishable** key, and the **secret** key. Put the secret key (or, if your project still offers it, the legacy `service_role` JWT) in `SUPABASE_SERVICE_ROLE_KEY`; the installed `supabase-js` accepts both.
6. Leave **Data API** on (the app uses PostgREST through `supabase-js`). The "automatically enable RLS" project option may be on or off: the baseline enables RLS on every table itself.

## 3. Build the database

All SQL is pasted into **SQL Editor** of the new project and run with **Run**. Each file is one transaction: if anything fails, nothing is created.

| Step | File | Result |
| --- | --- | --- |
| 1 | every file of [`database/migrations/`](../database/migrations/) **in file-name order**: [`20261015000000_baseline.sql`](../database/migrations/20261015000000_baseline.sql), then [`20261016000000_list_views_and_dashboard_summary.sql`](../database/migrations/20261016000000_list_views_and_dashboard_summary.sql), then [`20261017000000_stop_configuration_history.sql`](../database/migrations/20261017000000_stop_configuration_history.sql), then [`20261018000000_sub_equipment_part_number_metadata.sql`](../database/migrations/20261018000000_sub_equipment_part_number_metadata.sql) (run each once, paste the whole file → Run) | Together: 17 tables, 5 views, 56 functions, triggers, RLS, grants. An existing project needs only the migration files it has not yet applied. The last file adds Part Number Description/Manufacturer search, sorting and Manufacturer filtering to the Sub-equipment list; run it before deploying that UI update. |
| 2 | [`database/seed.sql`](../database/seed.sql) | The three system Types (Tester / Base / Fixture) and their Groups, plus this site's Configuration lists (Locations, Levels, Departments, Tags, Vendor, Part numbers, calibration setup, the sub-equipment Type), exported from the old project on 2026-10-15. Safe to re-run. **Edit it first if the lists should differ**; it contains no devices, users or logs. |
| 3 | the first Admin (below) | One Admin who can sign in. |
| 4 | the check query below | One row of numbers that must match. |

**The first Admin — choose one**

- **A. Move the existing Admin from another project** (same id, same password hash, same role; the person keeps their password). In the *old* project run [`export_admin_from_old.sql`](../database/tools/export_admin_from_old.sql) after changing `'ADMIN_USERNAME'`; copy the single JSON cell it returns. In the *new* project paste it into [`import_admin_to_new.sql`](../database/tools/import_admin_to_new.sql) between the `$export$` markers and run. **The JSON contains a password hash: do not paste it into chat, tickets or git** (`.gitignore` blocks `admin_export*.json` and `*.filled.sql`). Both scripts were rehearsed on a scratch Postgres, including Auth tables with generated columns.
- **B. Create a brand-new Admin.** Put the three variables in `.env.local` (pointing at the new project), then `npm run seed:admin -- <username> "<Full name>" [employee id]`. It prints a temporary password **once**; the first sign-in forces a new one.

Do not do both for the same username (the internal email would collide).

**Something went wrong half way or the baseline says "already exists"?** Run [`database/tools/reset_schema.sql`](../database/tools/reset_schema.sql) (it empties the `public` schema of the project you are in; see §10.10) and start again from step 1.

**Check the new project** (read-only; paste into SQL Editor):

```sql
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tables,   -- 17
  (select count(*) from pg_views where schemaname = 'public') as views,                                                    -- 5
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as functions,                                -- 56
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity) as tables_without_rls, -- 0
  (select count(*) from public.type_groups) as type_groups,                                                               -- 4
  (select count(*) from public.types) as types,                                                                           -- 4
  (select count(*) from public.user_profiles where role = 'admin' and is_active) as active_admins;                        -- 1
```

The Admin move keeps the account's department only if it is in the new project (it is, when it is one of the seeded Departments); otherwise it is left empty.

## 4. Vercel

1. **Add New → Project**, import the GitHub repository, framework **Next.js**, default build settings (`npm run build`, output is `standalone`). Use a current Node 24 runtime.
2. **Settings → Functions → Function Region**: pick the region nearest the Supabase region (or add `vercel.json` with `{ "regions": ["<id>"] }`). Keep them close; this is the cheapest speed-up there is. There is no `vercel.json` in the repo yet.
3. **Settings → Environment Variables**: add the three variables **separately for each environment**.
   - **Production** → the project that real users will use.
   - **Preview** → the project used for testing branches. Using a *different* project here is what makes a safe preview possible.
4. Env changes apply to the **next build** only; a running deployment keeps its old values.
5. Preview URLs are behind Vercel's deployment protection by default (you sign in to Vercel to open them); the app's own login is still required.

## 5. GitHub Actions

| Workflow | Needs | Does |
| --- | --- | --- |
| `backup.yml` — daily dump | secret **`SUPABASE_DB_URL`** = the Postgres connection string of the **current production** project (Supabase → Connect → **Session pooler** string with the database password filled in; GitHub-hosted runners are IPv4-only and the *direct* connection string is IPv6 unless you buy Supabase's IPv4 add-on. Run the workflow once by hand after changing it and check the artifact is not empty) | `pg_dump` to an artifact kept 30 days. |
| `keepalive.yml` — daily ping | variable **`APP_URL`** = the production URL, no trailing slash | `GET /api/health`. Only useful on a project that can pause (free tier); remove it on Pro. |

**Keep the repository private.** The dump holds all your data (and probably the Auth accounts with their password hashes), and artifacts of a public repository can be downloaded by anyone with a GitHub account; the workflow refuses to run in a public repository. On the Free plan this dump is the **only** backup, so restore it into a scratch project once ([§10.7](#107-backup-and-restore)). Update `SUPABASE_DB_URL` at go-live, otherwise the backup keeps dumping the old project. GitHub disables scheduled workflows after ~60 days without repository activity.

## 6. Test on a Vercel preview

Goal: exercise the new database with the real code **while production keeps using the old one**.

1. Create the new Supabase project and build it (§2–3). Import the Admin (option A) or create one (option B).
2. In Vercel → Environment Variables add the three variables for **Preview only** (optionally limited to the branch `chore/new-supabase-cleanup`), with the **new** project's values. Production variables stay as they are.
   CLI equivalent: `vercel env add NEXT_PUBLIC_SUPABASE_URL preview chore/new-supabase-cleanup` (repeat for the other two).
3. Push the branch. Vercel builds a Preview and gives its URL (also shown on the commit/PR).
4. Work through the [checklist](#7-manual-test-checklist) on that URL.
5. When done, run [`database/tools/reset_after_testing.sql`](../database/tools/reset_after_testing.sql) in the new project (§8 step 2) so no test data survives. It also puts the Configuration lists back exactly as in `seed.sql`.

> Make the repository **private** before relying on the backup workflow (§5). `database/seed.sql` also holds your real Configuration lists (bay names, part numbers). Never commit `.env.local` or an Admin export (`admin_export*.json`, `*.filled.sql`).

## 7. Manual test checklist

Run on the preview URL as an Admin unless stated. Use any three test serials. Tick everything; note the browser and screen size. Seeded lists to expect: Types `Station` (the Tester type, renamed in the old project), `Base`, `Fixture`, `Device` (sub-equipment); Locations `B3F5 - Bay 8A/8B/9A/9B`; Part numbers `ST-UNI-M10` (Tester), `FI-UNI-M20` (Base), `FX-2292-M12` (Fixture), `KEYTHLEI` (sub-equipment, 6-month calibration setup, 15-day warning), `33210A` (sub-equipment); 9 Levels; Departments QE/TE/ME; Vendor `Internal vendor`; Tags Normal, Upcoming receive, Wait for registration, Deactivated.

**A. Database and access**
- [ ] The check query in §3 returns 17 / 5 / 56 / 0 / 4 / 4 / 1.
- [ ] `GET <preview>/api/health` → 200 without signing in.
- [ ] `GET <preview>/api/equipment` signed out → 401. Opening `/equipment` signed out → redirected to `/login`.
- [ ] Publishable key straight at Supabase gives nothing: `curl "<SUPABASE_URL>/rest/v1/equipment?select=*" -H "apikey: <publishable key>"` → empty list or permission error, and `…/rest/v1/rpc/app_write` (POST) is refused.

**B. Login and roles**
- [ ] Admin signs in with the **old password** (migrated hash). Wrong password → clear error. Sign out / in works. Session survives a reload.
- [ ] User Management → add `qa.user` (role User) and `qa.viewer` (Readonly): a temporary password is shown **once** with a copy button.
- [ ] `qa.user` signs in → forced to choose a new password (≥ 10 characters) → lands on Dashboard. Menu has 5 items; `/configuration/locations` and `/users` redirect to the Dashboard with a "no permission" message.
- [ ] `qa.viewer`: no Add / Edit / Import / Check-out buttons anywhere; search, filters, Export Excel and History work.
- [ ] Admin: reset `qa.viewer`'s password; lock `qa.viewer` → their next click returns to the login page; unlock. Edit a user (name, department, role): History tab shows the change.
- [ ] Admin cannot lock or demote themselves (refused). With one active Admin, locking/demoting that Admin is refused.

**C. Configuration (Admin)**
- [ ] Each list opens: Part Number, Location, Type, Group, Tag, Level, Department, Calibration Setup, Vendor, Error log.
- [ ] Add, edit and hide one item per list; a hidden item is no longer selectable in forms but existing records still show it. A duplicate name (different case) is refused.
- [ ] Tester / Base / Fixture Types and Groups cannot be hidden. A Part number needs a Type; Manufacturer and description save; Level optional.
- [ ] Tags offer six colours; deleting a tag in use is refused.

**D0. Paged lists** (Equipment, Calibration, Golden — needs more than 50 records; add test records or import a file)
- [ ] The list opens on page 1 with 50 rows; the footer shows the range and the total ("1–50 of N"); the heading shows "50 of N records". Network tab: **one** request `/api/equipment?page=1&pageSize=50` (+ `/api/filter-values/equipment` once), not the whole table.
- [ ] Next / Previous move between pages; going back to a page opened in the last 30 seconds makes **no** request. The **No** column continues (51…).
- [ ] 25 / 50 / 100 per page changes the page, returns to page 1, and is remembered after a reload.
- [ ] Search for a serial that is on page 3: found without moving to page 3. Typing quickly sends one request after the pause, not one per key. Clearing the search returns the list.
- [ ] A column filter (Part number, Location, Type, Level, Parent / Tester, Tags, Status) and a sort apply to **all** records and return to page 1; a filter value that is on no row of the current page is still in the list; "(empty)" works where offered; the chips name the values.
- [ ] Calibration: the quick filters Overdue / Due soon / Attention match the Dashboard numbers; typing "overdue" in the search also finds Overdue rows.
- [ ] Export Excel contains **all** rows matching the search and filters, not only the page.
- [ ] Delete the last row of the last page (as Admin): the list lands on the new last page, not an empty one. A page number past the end (edit `page=99` in the URL) shows the last page.
- [ ] Save an edit: the row updates at once and the page refreshes once in the background. After a Swap or Move the list shows the new places without a manual reload.
- [ ] Open a record by link (`?id=`) that is not on the first page: the record opens; closing it leaves the list on its page.
- [ ] Dashboard → Recent changes: "Load more" adds the next 50 actions without re-reading the earlier ones (Network: `…/activities?limit=50&offset=50`); changing a filter starts again from the first page.

**D. Equipment**
- [ ] Add a Tester (`ST-UNI-M10`): Type fills from the part number, Level is pre-filled, Location is required. Adding another with the **same serial** warns before saving (save anyway works).
- [ ] From the Tester → Actions → **Add child**: a Base (`FI-UNI-M20`) with Location and Level locked to the parent; then a Fixture under that Base.
- [ ] Edit: change Remark and choose **one** tag; History shows one entry. Saving with no change is blocked.
- [ ] **Check-out** the Tester → *In use* with all children; **Check-in** → all *Not in use*. Check-out a Base alone while its parent is not in use → refused.
- [ ] **Change location** of an unattached Base (children follow); on an *In use* asset it is refused.
- [ ] **Move** the Base to another Tester: preview lists status changes, location and Level follow. **Detach** → unattached and *Not in use*.
- [ ] **Swap** two Bases of the same Type: preview, confirm; each gets the other's parent/location. Swapping with identical placement is refused.
- [ ] As Admin delete a Tester that has children: the children survive as unattached. `qa.user` has no Delete.
- [ ] The tree on the right of the detail modal: clicking nodes changes the selected record **without** closing/reloading the modal. `…/equipment/<id>/label` shows a printable QR whose link opens the record.

**E. Sub-equipment and calibration**
- [ ] Add a sub-equipment (`KEYTHLEI`) under a Tester: location follows the tester. Unattached one needs its own location.
- [ ] Record a calibration: `due_date` is computed (date + 6 months). Result *fail* → status **Failed**. Edit it; deleting a calibration works for Admin only.
- [ ] Status transitions: a calibration dated ~7 months ago → **Overdue**; ~5½ months ago → **Due soon**; today → **Valid**; none → **Not calibrated**. Calibration History tab lists `CALIBRATE` entries.
- [ ] Swap two sub-equipment of the same Type; Move / Detach work.

**F. Golden boards**
- [ ] Add one (free-text part number) attached to a Tester or Fixture: location follows. Unattached needs a location.
- [ ] Check-out while unattached is refused; attached works. Swap two golden boards; delete one.

**G. Excel import** (each of Equipment, Sub-equipment, Golden)
- [ ] Download the template in **EN and VI**: two sheets (data sheet with headers in row 1, "Valid values"); dropdowns work; required columns marked `*`.
- [ ] Fill 3 rows (for Equipment include a child whose parent is another row of the same file) → upload → **Check** reports 0 errors → **Import**: 3 records created.
- [ ] A file with a wrong part number, a missing required value and an over-long value: errors are listed **by Excel row**, Import stays disabled; fix and retry.
- [ ] Re-importing existing serials only warns. `qa.viewer` has no Import button.

**H. Overview**
- [ ] Board shows one column per root asset grouped by Location, at most 3 cards per column plus "+N". Filters (status, type) and search (serial / part number) highlight matches. Unattached assets appear in their own columns.
- [ ] Opening a card shows the detail modal with the tree; switching nodes keeps the modal; the URL has `?id=…&type=…`.

**I. Dashboard numbers reconcile**
- [ ] Equipment *In use* + *Not in use* = rows in the Equipment list. Sub-equipment and Golden likewise.
- [ ] Location rows add up to the total of all assets; Type rows (including **No type**) too; Tag rows (including **Untagged**) too.
- [ ] Calibration status bar adds up to the sub-equipment count; the **Overdue** and **Due soon** KPIs equal the same numbers in the bar and the length of their lists (and the Masterlist filtered by that status).

**J. Recent changes: one entry per user action**
- [ ] Each of these gives exactly **one** line on the Dashboard: a Swap (two records inside), a Move with children, a Check-out of a tree, an Excel import of 3 rows (shows "3"), a form edit that changes both a field and the parent, a Create, a calibration record.
- [ ] Expanding a line lists the affected records and their changes. Filters by module, user, date and search by **any** serial in the action work; "Show more" counts actions.
- [ ] As Admin, creating / editing / locking a user shows in Recent changes (module *User*); changing a Configuration list does **not** appear there. `qa.user` sees neither, and the module filter offers no Configuration.
- [ ] A record's own History tab (Equipment, Sub-equipment, Golden, User) still shows one row per change to that record. A Configuration record has **no** History tab.

**K. Languages and layout**
- [ ] Switch EN ↔ VI on login, Dashboard, a list, a modal, a validation error, the import template: no raw keys such as `eq.add` appear; long Vietnamese text wraps. The choice survives a reload. Light and dark theme both readable.
- [ ] Phone width (< 768 px): lists become cards, filters open as a sheet, the modal is full screen, a floating **+** adds a record.

**L. Close-out**
- [ ] Error log (Admin) opens. Run `reset_after_testing.sql`, then the §3 check query again (same numbers); the Configuration lists are exactly the seeded ones (test values gone) and you can still sign in as the Admin.

## 8. Go live

Preconditions: the new project is built; the preview checklist passed; nobody needs the old data (the decision for this move is to start with an empty system).

1. **Tag the rollback point**: `git tag pre-new-supabase main` (the last commit that works with the old project).
2. **Reset the new project**: run `database/tools/reset_after_testing.sql` (set `ADMIN_USERNAME`), then the §3 check query. Only the Admin and the seeded lists remain.
3. **Switch Production variables** in Vercel to the new project (all three). Do **not** redeploy yet.
4. **Drop the temporary compatibility commits, then merge the branch into `main`** (pull request). List them with `git log --grep="^Temporary:" --oneline` and `git revert` each (newest first); see [§11](#11-local-development). The Production build now picks up the new code *and* the new variables together. The merged code requires the new schema, so never deploy it against the old project.
5. **Update GitHub**: secret `SUPABASE_DB_URL` → the new project; check `APP_URL`.
6. **Smoke test production**: open the URL, sign in as the Admin, check Dashboard (empty), Configuration lists, `/api/health`.
7. **Enter real data** as the Admin: adjust Configuration if needed, add Users, then devices (Excel import per module is the fast way).
8. **Old project**: **pause** it (Supabase → Project Settings → General → Pause project). Do not delete it until you have confirmed the new one works over a real working period. Before pausing you can keep the draft data by using each module's **Export Excel** in the old app.

**Rollback** (before real data is entered): set Production variables back to the old project, redeploy `pre-new-supabase`, restore the old project if it was paused. After real data exists in the new project a rollback loses it, so decide early.

## 9. Releases and future migrations

- Code changes: pull request → Vercel Preview → merge to `main` → Production.
- Database changes: add `database/migrations/YYYYMMDDHHMMSS_name.sql` ([DATABASE.md](DATABASE.md) §9), test on the preview project first, run it in the production SQL Editor, then deploy the code that needs it. For a change the **old** code cannot live with, run it in the order that keeps the site working (usually: additive migration → deploy → cleanup migration).
- Before merging: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- If you change `database/seed.sql`, make the same change in step 3 of `database/tools/reset_after_testing.sql` (it holds a copy of the seed rows).

## 10. Operations runbook

Prefer the UI; use SQL only when the UI is unreachable. Run SQL in the **production** project's SQL Editor. Change data through `public.app_write(...)` or the `asset_*` functions so the log stays correct — never `update`/`delete` the tables by hand.

### 10.1 Reset a password
User Management → open the account → **Actions → Reset password** → confirm. A temporary password is shown **once** (Copy); the person must set a new one at next sign-in; History records `PASSWORD_RESET`. Works for locked accounts. Lost the screen before copying: reset again. An Admin changes their own password in the account menu → Account settings.

**The only Admin forgot their password:** create another Admin on a machine with the production `.env.local` (`npm run seed:admin -- new.name "Full name"`) and reset the old one from the UI; or set it in SQL:
```sql
update auth.users set encrypted_password = crypt('TempPass-123', gen_salt('bf')) where email = 'username@jabil.local';
select public.app_write('user_profiles', 'update', id, '{"must_change_password": true}'::jsonb, null, 'PASSWORD_RESET', 'runbook', 'script')
from public.user_profiles where username = 'username';
```

### 10.2 Add an account
User Management → **Add**: username (lowercase, digits, `. _ + -`; cannot change later), name, employee id, department, role (default Readonly). Give the person the temporary password shown once. If "username exists" appears but the list does not show it, an interrupted attempt left an Auth user without a profile: delete `<username>@jabil.local` in Supabase → Authentication → Users and add again.

### 10.3 Lock / unlock
User Management → account → **Actions → Lock** (also bans the Auth user). Effective immediately: the server checks `is_active` on every request. Accounts are never deleted (they are referenced by the logs). If the UI is down, do both: `app_write('user_profiles','update',id,'{"is_active":false}',null,null,'runbook','script')` **and** Ban user in the Auth dashboard.

### 10.4 Undo a wrong move or swap
There is no undo; perform the opposite operation (all steps are logged). Open the asset → **History** to see where it was; then **Move** back, **Detach**, or **Change location** (the preview shows status changes first). To look in SQL, use the asset id from the URL (`/equipment?id=…`; serials are not unique):
```sql
select created_at, action, from_location, to_location, old_value, new_value, reason
from public.asset_logs where asset_type = 'equipment' and asset_id = '<id>' order by created_at desc limit 10;
```
A deleted asset can still be found by serial: its `DELETE` row holds the old row in `old_value`.

### 10.5 Edit the dropdown lists
Configuration (Admin). Items are hidden, not deleted (except Tags and Calibration Setup). A part number's Type can change only while no device uses it. The calibration interval applies to calibrations recorded **after** the change; existing due dates never change.

### 10.6 Trace an error a user reports
5xx errors show a request id (`req_…`) in the message. Configuration → **Error log** → search it, open the row for route, user, message and stack. `select * from public.error_log where request_id = 'req_…'` also works. Rows are kept 90 days; Vercel's own logs keep about an hour. 4xx errors (validation, permissions) are not logged: the message on screen already says why.

### 10.7 Backup and restore
The daily workflow stores `eq-YYYY-MM-DD.sql.gz` as an artifact (30 days). Restore into a **scratch** project first: `gunzip -c eq-….sql.gz | psql "<connection string>"`. The dump uses `--no-acl`, so on a fresh project re-apply the grants at the end of the baseline migration (the `revoke … grant … service_role` blocks) and run `verify_new_project.sql`. Accounts live in the `auth` schema, which is not part of a `public`-only restore: recreate the Auth users for each `user_profiles` row with the same ids. **A backup that has never been restored is not a backup — test a restore at least once.** (Not yet tested for this project.)

### 10.8 Project paused
The free tier pauses after a week without activity; data is kept. Supabase dashboard → Restore (a few minutes). `keepalive.yml` pings `/api/health` daily to prevent it; the endpoint reads one row from the database (at most once a minute), because Supabase counts only database / API activity, not a call that stops at Vercel. A red run of that workflow means the app cannot reach the database.

### 10.9 Monthly check
Look once a month; crossing a threshold means *optimise*, not necessarily upgrade.

| Metric | Where | Watch at | If exceeded |
| --- | --- | --- | --- |
| Vercel Active CPU | Vercel → Usage | 3 of 4 h | Look for repeated or unindexed queries |
| Supabase DB size | Supabase → Reports | 300 of 500 MB | Check `asset_logs` and `user_histories` growth |
| Supabase egress | Supabase → Reports | 3 of 5 GB | Lists are paged (≈ 27 KB a page) and the Dashboard is one ≈ 10 KB call, so this should stay low; if it climbs, run `npm run bench` and look for a screen that reads a whole table |
| Vercel invocations | Vercel → Usage | 500k of 1M | Every API call and page open authenticates once; look for new polling |

### 10.10 Rebuild a development database
Create a new project (or use a scratch one) and repeat §3, or wipe the existing one with `reset_schema.sql` (below). To empty a *test* project keeping the Admin and the seeded lists use `database/tools/reset_after_testing.sql`.

**Start over on a project that already has tables** (the baseline refuses to run twice; the migrations after it can be repeated): run [`database/tools/reset_schema.sql`](../database/tools/reset_schema.sql) in the SQL Editor after changing `'NO'` to `'WIPE'`. Only in the NEW or a scratch project, never production: it deletes every table, view and function in `public` with all their data, and leaves Supabase Auth users alone. Afterwards run the baseline, the seed, the Admin import and the §3 check again (the import is safe to repeat; to remove the Auth users too, run `delete from auth.users;` after the script).

## 11. Local development

```bash
npm ci
cp .env.example .env.local        # fill the three variables (a development/preview project, never production)
npm run dev -- --hostname 127.0.0.1
```
Open the address Next.js prints (usually http://127.0.0.1:3000).

- Use Node 24.9+. Do not copy `node_modules` or `.next` between Windows and macOS.
- **Company network with SSL inspection:** if sign-in says "wrong password" but the credentials are right, Node does not trust the company certificate. Start with `NODE_USE_SYSTEM_CA=1` (PowerShell: `$env:NODE_USE_SYSTEM_CA=1; npm run dev`). The scripts that talk to Supabase set `--use-system-ca` themselves.
- Keep the working copy **outside OneDrive** (for example `C:\dev\equipment-management`): OneDrive syncs `node_modules`/`.next`, slows builds and Windows' 260-character path limit can break Turbopack.
- Do not run `npm run build` while `npm run dev` runs (they share `.next`).
- **Pointing `.env.local` at the OLD project** works only because of the temporary compatibility code (`callRpc` retry in `lib/services/core/db.ts` and `legacyActivities` in `lib/services/dashboard.ts`): the old database predates `recent_actions` and `p_action_id`. It keeps everything working. Recent changes still shows one line per action where it can: rows written in one transaction (same timestamp, user and source) are merged, so a swap, a move with children or a check-out of a tree is one line. A form save that makes several separate database calls is not merged, because that needs the baseline's `action_id`. It is dormant on a baseline database and is removed before the merge ([§8](#8-go-live)). Prefer a development project built from the baseline.
- `npm run lint`, `npm run typecheck`, `npm test` is described in [ARCHITECTURE.md](ARCHITECTURE.md) §10.

## 12. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Invalid API key" | The three variables come from different projects, or the service key was pasted into the publishable slot. |
| Sign-in fails right after setup | Public sign-up/email-confirm settings; the profile row missing (the §3 check query shows `active_admins` = 0); the Auth user and profile have different ids. |
| Every API call returns 500 and `error_log` is empty | `SUPABASE_SERVICE_ROLE_KEY` missing or wrong in that Vercel environment (Preview and Production are separate). |
| Dashboard or a save fails with "Could not find the table 'public.recent_actions'" / PGRST205 / PGRST202 | The database is older than the code: `.env.local` (or the Vercel variables) still point at the **old** project. Point them at the project built from the baseline. While the temporary compatibility commits are in the branch the app tolerates the old schema (Recent changes merges rows of one transaction); once they are reverted for cutover the app needs the baseline. |
| Preview works, production sign-in loops | Production variables still point at the old project while the code is new, or the reverse. |
| Login works locally but not on the company network | See §11, `NODE_USE_SYSTEM_CA`. |
| Slow responses | Vercel and Supabase in different regions (§4); measure with `npm run bench`. |
