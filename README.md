# Equipment Management

Internal web app that replaces Excel tracking of **testers, bases and fixtures**, the **sub-equipment that needs calibration**, and **golden boards** — where each one is, what it is attached to, whether it is in use, when it was last calibrated, and who changed what.

Pilot scale: 10–20 users, 1,000–2,000 devices.

## Modules

| Module | What it does |
| --- | --- |
| **Dashboard** | Counts by status, location, type and tag; overdue / due-soon calibrations; *Recent changes* (one line per user action). |
| **Overview** | Board of cards grouped by Location: one column per root asset (a Tester, or an unattached device) with up to three cards each. |
| **Equipment** | Testers, Bases and Fixtures as a tree (Tester ⊃ Base ⊃ Fixture): add, edit, move, swap, detach, check-out / check-in, change location, delete, Excel import and export, QR labels. |
| **Sub-Equipment** (`/calibration`) | Devices that need calibration, kept inside a Tester; record calibrations; calibration status is computed (Not calibrated / Failed / Overdue / Due soon / Valid). |
| **Golden** | Known-good PCBAs attached to a Tester or Fixture. |
| **Configuration** *(Admin)* | The dropdown lists (Part number, Location, Type, Group, Tag, Level, Department, calibration Setup and Vendor) and the Error log. |
| **User Management** *(Admin)* | Create accounts, edit, reset password, lock / unlock. |

Roles: **Admin** (everything), **User** (view, add, edit, operate; no delete, no Configuration / Users), **Readonly** (view, search, export). English and Vietnamese, light and dark, desktop and phone.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Supabase (Postgres + Auth, accessed only from the server) · Vercel · i18next · ExcelJS · Vitest. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

Node.js 24.9+ and a Supabase project (use a development one, not production).

```bash
npm ci
cp .env.example .env.local        # fill in the three variables below
npm run dev -- --hostname 127.0.0.1
```

Open the address Next.js prints. A new Supabase project must be built first — [docs/DEPLOY.md](docs/DEPLOY.md) §2–3. On a company network with SSL inspection start with `NODE_USE_SYSTEM_CA=1` (see DEPLOY §11).

**Environment variables** (names only; values in `.env.local`, never committed):

| Name | Used by |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser and server (sign-in only) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** — never expose |

## Commands

| Command | |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, production build, serve the build. |
| `npm run typecheck` · `lint` · `test` | TypeScript, ESLint, Vitest. |
| `npm run seed:admin -- <username> "<Full name>"` | Create the first Admin in a fresh project. |
| `npm run bench` | Read-only timing of the server layer against a real project. |

## Documentation

| | |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Folder structure, authentication and roles, data access, activity log, API routes, Excel import, i18n, performance rules, tests. |
| [docs/DATABASE.md](docs/DATABASE.md) | Every table, view and function; the asset tree and status rules; error codes; security model. |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Setting up Supabase and Vercel from zero, preview testing and the manual test checklist, go-live, future migrations, operations runbook. |
| [docs/UI.md](docs/UI.md) | UI rules — read before changing any screen. |

## Repository map

`app/` pages and API routes · `components/` UI · `lib/` server, client and shared code · `src/i18n/` translations · `database/` baseline migration, seed, Admin move and reset scripts · `scripts/` CLI scripts · `docs/`.
