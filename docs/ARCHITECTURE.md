# Architecture

How the app is put together. Database details are in [DATABASE.md](DATABASE.md), screens in [UI.md](UI.md), setup and operations in [DEPLOY.md](DEPLOY.md).

```
Browser (React 19, i18next)
   │  fetch /api/...  (session cookie)
   ▼
Next.js 16 on Vercel (Node runtime)
   proxy.ts ─► page layouts ─► API routes ─► withAuth ─► services ─► db.ts
   │                                                         │
   │ publishable key: sign in / sign out / who am I          │ service key (server only)
   ▼                                                         ▼
Supabase Auth ◄──────────────────────────────────────  Supabase Postgres
                                                        (RLS on, no policies; functions do the work)
```

The browser never talks to Supabase directly. Every read and write goes through an API route.

## 1. Folder structure

| Path | What lives there |
| --- | --- |
| `app/(app)/…` | Authenticated pages: Dashboard `/`, `/overview`, `/equipment`, `/calibration`, `/golden`, `/configuration/[list]`, `/users`. The layout checks the session and role and seeds the dropdown options. |
| `app/login`, `app/change-password` | Pages outside the shell. |
| `app/{equipment,calibration,golden}/[id]/label` | Printable QR labels (no shell). |
| `app/api/**/route.ts` | All API routes (§6). Each one is `export const X = withAuth(handler, { role })`. `schema.ts` files hold the zod request schemas. |
| `proxy.ts` | Session refresh and redirect to `/login` (§3). Next.js 16's name for middleware. |
| `lib/auth` | `withAuth` (the permission gate), `session` (`getCaller`), username ↔ email mapping, temporary passwords. |
| `lib/supabase` | `admin.ts` (service key, the only place that reads it) and `server.ts` (publishable key, auth only). |
| `lib/services` | One file per module (`equipment`, `calibration`, `golden`, `overview`, `dashboard`, `configuration`, `users`, …) plus `*Import.ts` for Excel. Business rules live in the database; services validate, call it and shape the result. |
| `lib/services/core` | `db.ts` (the data-access API), `lookups.ts`/`lookupCache.ts`, `actionContext.ts`, `history.ts`, `importKit.ts`, `assets.ts`, `validate.ts`. |
| `lib/errors`, `lib/permissions`, `lib/status.ts`, `lib/types.ts` | Error codes and mapping, roles, status colours, shared types (used by server and client). |
| `lib/client` | `api.ts` (fetch wrapper, error → message), `useFetch`, `useUrlParams`, list cache, `usePhone`, popover and sidebar motion hooks. |
| `lib/server/connections.ts` | Keeps HTTP connections to Supabase warm (loaded from `instrumentation.ts`). |
| `components/ui` | Shared building blocks: `Masterlist`, `record/RecordModal`, `workspace/ModuleWorkspace`, `SearchableSelect`, `ActionMenu`, tags, `ImportModal`. |
| `components/{equipment,calibration,golden,configuration,users,overview,dashboard,assets}` | Module screens built from the shared blocks. |
| `src/i18n` | Client i18n setup and `locales/en.json`, `vi.json`. |
| `database/` | Baseline migration, seed (system Types + Configuration lists), tools: Admin export / import, the post-test reset and the schema wipe ([DATABASE.md](DATABASE.md), [DEPLOY.md](DEPLOY.md)). |
| `scripts/` | `seed-first-admin.ts` (first admin) and `bench-services.ts` (read-only timing against a real project). |
| `.github/workflows` | Daily database backup; keepalive ping. |

## 2. Rules that must not be broken

1. **No route exports a bare handler.** `withAuth` is the only permission layer, because the service key bypasses RLS. Check: `grep -rL "withAuth" app/api --include=route.ts` must print nothing.
2. **The service key is read in one file**, `lib/supabase/admin.ts` (`import 'server-only'`, ESLint `no-restricted-imports` outside `lib/services`, `lib/auth` and `scripts`, and no `NEXT_PUBLIC_` prefix). The two CLI scripts read it from `.env.local`.
3. **Every function and view in the database ends with `revoke … grant … to service_role`** ([DATABASE.md](DATABASE.md) §1).
4. **Stay portable.** No Vercel KV/Blob/Postgres/Cron, no Edge runtime for business logic; `output: 'standalone'` is on, so leaving Vercel means a Dockerfile plus env vars. Scheduled jobs live in GitHub Actions.
5. **Never insert log rows from the server**, and never `update` parent / location / status columns by hand: use `app_write` and the `asset_*` functions so the subtree, rules and log stay consistent.

## 3. Authentication and authorisation

**Accounts.** A user is a Supabase Auth user plus a row in `public.user_profiles` with the same id. Only an Admin creates accounts (no self sign-up; keep public sign-up off in Supabase). Login is by **username**: the server maps it to the internal email `<username>@jabil.local`, so no email is ever sent. A new or reset account gets a generated temporary password (`Jabil-4827` style) shown once; `must_change_password` forces a new one at first sign-in.

**Per request**

1. `proxy.ts` runs on page navigations. It refreshes the session cookie and redirects anonymous users to `/login`. It calls `auth.getUser()` (a network round trip) only for `/login` and the label pages; elsewhere `getSession()` is enough because the layout and `withAuth` re-check.
2. `getCaller()` (`lib/auth/session.ts`) is the single "who is calling" function for pages and API. It asks Supabase Auth who owns the token (`getUser`) **in parallel with** reading the profile (the profile id is taken from the unverified token only as a hint, and the result is used only if `getUser` confirms the same id).
3. `withAuth` then enforces, in order: signed in → profile exists → `is_active` → no pending password change (except `/api/me*`) → role allowed. **Access is always decided by `user_profiles`, never by a valid token alone**, so locking an account takes effect on the next request.
4. A bare `proxy.ts`/layout redirect is never the security boundary; the API is.

**Roles** (`user_profiles.role`, fixed in code, no per-person permissions): `admin` does everything; `user` views, adds, edits and operates but cannot delete or open Configuration / User Management; `readonly` views, searches and exports.

| Area | Admin | User | Readonly |
| --- | :-: | :-: | :-: |
| Dashboard, Overview (view) | ✔ | ✔ | ✔ |
| Equipment / Sub-equipment / Golden — view, search, export, History | ✔ | ✔ | ✔ |
| — add, edit, change location, Move / Swap / Detach, Check-out / in, Excel import, record a calibration | ✔ | ✔ | — |
| — delete (and delete a calibration) | ✔ | — | — |
| Configuration (all lists, Error log), User Management | ✔ | — | — |

Other protections: login attempts are rate-limited per server instance (on top of Supabase's own limit); an admin cannot lock or demote themselves or the last active admin (database trigger); the password change needs the current password and ≥ 10 characters.

## 4. Data access

All database code is in `lib/services`, through `lib/services/core/db.ts`:

| Function | Use |
| --- | --- |
| `selectAll(table, columns, order)` | Read a small table fully (1000-row pages; extra pages in parallel) — Configuration, Users, the Error log. Related names are **embedded in the same PostgREST query** (`parent:parent_id(serial_number)`), never fetched afterwards. Never used for the asset tables. |
| `runList(spec, params)` (`core/listQuery.ts`) | One **page** of a list view: filters, search and sort applied in the database before `range`, exact `count` in the same request, page past the end → last page. Used by the Equipment, Calibration and Golden lists. |
| `selectOne` | One row by id. |
| `appWrite(table, op, id, data, actor, options)` | Insert/update/delete through the `app_write` function, with actor, action, note, source. Invalidates the lookup cache. |
| `rpc(fn, args)` | Calls the multi-step functions (`asset_*`, imports, `overview_board`, …). Adds `p_action_id` to the write functions. |

**Lookups.** `loadLookups()` reads the nine configuration lists once and keeps them 60 s in memory, shared by concurrent requests, so turning ids into names costs no round trip. Every write through `appWrite` invalidates it. The returned `Map`s are shared: **read-only**. With several server instances another instance may see a change up to 60 s late. The `(app)` layout also passes the lists to the client (`seedOptions`) so the first form of a page load needs no `/api/options` call.

**Errors.** Services throw `AppError(code)`; database exceptions are mapped by `mapRpcError`. The API returns `{ success:false, error:{ code, message, details, request_id } }` with a matching HTTP status; **text is translated in the browser** from the code (`errorMessage()`). 5xx errors are also written to `error_log` with the `request_id` shown to the user; 4xx are not.

**Dry run.** Tree operations and imports accept `dry_run`: the database runs everything and rolls back, returning the same result shape. The UI shows it as a preview and the import check uses it before committing.

### Lists: one page at a time

The three asset lists (Equipment, Calibration, Golden) do **not** download their table. `GET /api/equipment|calibration|golden` reads one page of the matching view (migration `20261016000000_list_views_and_dashboard_summary.sql`) and answers `data` = the rows, `meta` = `{ total, page, pageSize }`.

| Query parameter | Meaning |
| --- | --- |
| `page`, `pageSize` | Page number (a page past the end returns the last page) and 25 / 50 / 100 (default 50). `pageSize=all` returns every matching row, 1000 per read — used only by **Export Excel**. |
| `q` | Search text (≤ 100 characters) over every column of the row. `qe=usage:in_use,status:overdue`: values whose translated label the text matches (the browser knows the labels). |
| `sort`, `dir` | Column key and `asc` / `desc`; always followed by `id` so pages never overlap. Default: newest first. |
| `f.<column>` | Column filter: an enum code, a Configuration id, a serial, or `__empty`. |
| `quick` | Calibration only: `overdue`, `due_soon`, `attention`. |

Unknown or malformed values are a `VALIDATION_ERROR` (400), never silently ignored. `/api/filter-values/{equipment|calibration|golden}` returns the values the filters cannot get from Configuration (serials of parents / testers, golden part numbers and origins).

Browser side: `usePagedList` (`lib/client`) holds page, page size and query; typing is debounced 350 ms (`Masterlist`); changing the query or page size goes to page 1; the previous page stays on screen (dimmed) until the new one arrives, and an answer to an outdated request is ignored. Each page is remembered by its URL (`pagedCache`, max 60 pages): a page **younger than 30 s is used without asking the server**, an older one is shown at once and refreshed. Every save by this user (and sign-in / sign-out) clears the remembered pages, and an answer that was requested before a save but arrives after it is not remembered. Other people's changes show up within 30 s or on reload. Users, Configuration lists and the Error log are small and still load fully and filter in the browser. Prev / Next in the record modal moves within the page on screen.

## 5. Activity log and Recent changes

Log rows are written **by database triggers in the same transaction** as the change. `withAuth` wraps each API request in `runInAction`, which creates one **`action_id`** (AsyncLocalStorage, `lib/services/core/actionContext.ts`); `db.ts` passes it as `p_action_id` to the ten write functions, which store it in the transaction context so every log row of that request carries it. The view `recent_actions` groups by `action_id`, so **one user action = one line** on the Dashboard (a swap, a move with children, a check-out of a tree, an Excel import, a multi-step form save). A record's History tab still lists its own rows. Details: [DATABASE.md](DATABASE.md) §6.

## 6. API

Every route is under `app/api/**/route.ts` and goes through `withAuth`. Success: `{ success:true, data, meta:{ request_id } }`. Bodies are JSON with unknown keys rejected (`VALIDATION_ERROR`). `Editors` = Admin and User. A locked account gets `USER_INACTIVE` (403); a pending password change gets `PASSWORD_CHANGE_REQUIRED` (403).

| Area | Routes | Who |
| --- | --- | --- |
| Session | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session-ended`, `GET /health` | anonymous |
| Me | `GET·PUT /me`, `PUT /me/password`, `GET /options` | everyone signed in |
| Users | `GET·POST /users`, `GET·PUT /users/{id}`, `POST /users/{id}/password`, `…/disable`, `…/enable`, `GET /users/{id}/history` | Admin |
| Equipment | `GET·POST /equipment`, `GET·PUT /equipment/{id}`, `GET /equipment/{id}/tree`, `GET …/history`, `POST /equipment/import`, `GET /equipment/import/template?lang=` | read: all; write: Editors |
| Calibration | `GET·POST /calibration`, `GET·PUT /calibration/{id}`, `GET·POST /calibration/{id}/records`, `PUT·DELETE /calibration/records/{recordId}`, `GET …/history`, `POST /calibration/import`, `GET …/import/template` | read: all; write: Editors; delete: Admin |
| Golden | `GET·POST /golden`, `GET·PUT /golden/{id}`, `GET …/history`, `POST /golden/import`, `GET …/import/template` | read: all; write: Editors |
| Asset tree (all 3 types, `{type}` = `equipment`/`sub_equipment`/`golden_board`) | `GET /assets/{type}/valid-parents`, `GET /assets/{type}/{id}/swap-candidates`, `GET /assets/serial-matches`, `POST /assets/{type}/{id}/change-location\|move\|detach\|swap`, `POST /assets/usage` (Check-out/in), `DELETE /assets/{type}/{id}` | read: all; operations: Editors; delete: Admin |
| Overview / Dashboard | `GET /overview?usage=&kind=&q=`, `GET /dashboard`, `GET /dashboard/activities?module=&user=&q=&from=&to=&limit=` | everyone (Configuration/User activity only for Admin) |
| Configuration | `GET·POST /configuration/{list}`, `GET·PUT·DELETE /configuration/{list}/{id}`, `GET …/history`, `GET /configuration/error-log` | Admin. `list` = `part-numbers`, `locations`, `types`, `type-groups`, `tags`, `levels`, `departments`, `calibration-setup`, `calibration-vendors` |

## 7. Excel import

Equipment, Sub-equipment and Golden each have an import (Editors). The template is **generated at download time** (`GET …/import/template`) from the current Configuration, so dropdowns always match: sheet 1 is for entry (headers in row 1, `*` marks required columns, dropdowns and length limits from row 2), sheet 2 lists the valid values. Upload is `.xlsx`, ≤ 5 MB, ≤ 1000 rows. The server checks every row with the same rules as the forms (parents may be rows of the same file), reports problems by Excel row number, and only when there are none does **Import** write the whole file in one transaction (`*_import` function; all or nothing; log source `import`). Duplicate serials only warn. Code: `lib/services/*Import.ts`, `lib/services/core/importKit.ts`, `components/ui/ImportModal.tsx`.

## 8. Internationalisation

- UI text comes from `src/i18n/locales/en.json` and `vi.json` through i18next (`useTranslation`). The language is stored in `localStorage` and applied by an inline script in `app/layout.tsx` before React runs (no flash).
- Server-side text (Excel templates) uses `textFor(language)` in `lib/i18n/text.ts`, which reads the same JSON files.
- API errors carry **codes**; the browser translates them from `errors.*`. A new error code needs both an EN and a VI message (`lib/client/api.test.ts` fails if one is missing).
- Both files must always have the same keys. Plural keys (`_one`/`_other`) are chosen by i18next from `count`: do not delete them just because the full key is not found in code. Keys built from a prefix (`values.*`, `fields.*`, `cfg.list.*`, …) are used dynamically.
- The brand name is not translated.

## 9. Performance rules to keep

Latency is dominated by **sequential network round trips** to Supabase (≈ 0.25 s each from the office network, less in the same region); the data is small. So:

- Run independent queries in parallel; never chain a query that could have been embedded in the previous one.
- Keep auth and profile read parallel (§3) and the lookup cache (§4). One typical API request ≈ 0.5 s.
- Deploy the Vercel functions in the **same region** as Supabase.
- `instrumentation.ts` keeps connections to Supabase open 30 s (undici); keep its exact `if (process.env.NEXT_RUNTIME === 'nodejs') { await import(…) }` form or the Edge bundle fails.
- Browser: identical GETs share one request; the asset lists load one page (50 rows) at a time and remember pages for 30 s (see "Lists: one page at a time"); the small lists are cached in memory while navigating (cleared on login/logout); a row opens instantly from list data; `Masterlist` rows are memoised and search is deferred; the Dashboard returns its first 50 recent changes in the same request; the Inter font is loaded without blocking render.
- Measure with `npm run build && npm run start` (not `dev`), and `npm run bench` for the server layer.
- Data volume per request (measured on 1,914 sample assets): one list page ≈ 27 KB (was ≈ 490 KB for the whole table); the Dashboard numbers ≈ 10 KB in one database call (was ≈ 520 KB read to count in JavaScript). `npm run bench` prints the KB each server call pulls from Supabase.
- Known scaling limits: the Error log still loads up to 1,000 rows; "Recent changes" reads its view in full to group (the view groups every log row — fine for tens of thousands of log rows, revisit beyond that); the Overview board is one database call but returns every card.

## 10. Testing

| Command | What it covers |
| --- | --- |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint. |
| `npm test` | Vitest: services, auth, API client, import, schemas, and jsdom UI tests. `vitest.setup.ts` gives jsdom elements a layout box, because popovers close when their anchor measures 0×0. |
| `npm run build` | Production build. |

The database scripts have no automated tests in the repository; the earlier PGlite tests (`database/tests/`) are in git history.
