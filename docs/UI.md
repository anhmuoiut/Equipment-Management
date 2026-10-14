# UI guide

The rules every screen follows. **Read this before adding or changing UI.** The guiding idea is *compact, clear, consistent*: protect working space for equipment data and extend the existing components instead of inventing a new look per feature. An explicit user request wins over this guide; if you deliberately change a shared rule, change it here in the same pull request. Do not redesign unrelated screens.

## 1. Brand, type and colour

- **Inter** everywhere (forms, tables, dialogs, labels), via `var(--font-ui)`; tabular numerals for numbers and identifiers. No other font.
- Three brand colours: **Prussian Blue `#002B49`** (text, sidebar, primary action in light mode), **White**, **Picton Blue `#3CB4E5`** (selection, focus, primary action in dark mode). Errors/destructive stay red, warnings amber, success green. Prussian text on Picton, white text on Prussian.
- **Use the tokens in `app/globals.css`, never hex values in a feature:** brand `--jabil-prussian|white|picton` · text `--ink --ink-2 --ink-3` · surfaces `--surface --panel --rule --rule-soft` · action `--machine --machine-dark --machine-tint --action-ink` · `--alert/-tint` · `--warn/-tint` · `--success/-tint` · `--info/-tint` · `--neutral/-tint` · status marks `--status-green|yellow|red|blue|gray` · `--overlay`. (`--ok` is a legacy alias; use `--success`.)
- Every screen must work in **light and dark** and in **English and Vietnamese**. Put new text in both `en.json` and `vi.json`. The brand name is not translated.

## 2. App shell

- **Top bar**: `Jabil | Equipment Management` on one row at the **left**, preferences and the account menu on the right. The page title belongs in the page content, not in a second header. On phones the bar is ☰ · brand · account; language and theme move into the account menu.
- **Sidebar**: Prussian background, Picton selected item; one flat level. Desktop: expanded 216 px or a 96 px rail (names under icons), toggled **only** by the footer button (`>>` / `<<`), never by hover or focus; the choice is remembered. The SolarEdge logo sits above the menu and the credit *Developed by Man Tran8118* in the footer (both hidden only in the collapsed rail). Phones: a drawer opened by ☰. Motion uses one damped spring and respects reduced-motion (`lib/client/sidebarSpring.ts`, `useSidebarMotion.ts`).
- **Menu** (in order): Dashboard `/` · Overview `/overview` · Equipment `/equipment` · Sub-Equipment `/calibration` · Golden `/golden` · divider · Configuration `/configuration/…` (Admin) · User Management `/users` (Admin). User/Readonly see the first five. No badges, no notification bell. An unauthorised route redirects to `/?denied=1`.
- **Configuration** picks its list from a grouped sub-list on the left — *Master data* (Part Number, Location, Type, Group, Tag, Level, Department), *Calibration* (Setup, Vendor), *System* (Error log); groups collapse and the group of the current page is always open. On phones it becomes a select.
- **Routes**: detail links `/equipment?id=…`, `/calibration?id=…`, `/golden?id=…` (the old `/equipment/{id}` redirects); Overview `/overview?id=…&type=…`; QR labels `/equipment/{id}/label` (no shell); `/change-password` is forced after a temporary password.
- **Dimensions** (reuse the classes; do not repeat values in feature CSS): header 52 px (56 on phones); content padding 16 px (12); page title 23 px / 600; body 14 px; table cells 13 px, headings 11 px; buttons 34 px (30 small), 44 px on phones (48 in modal footers); inputs 16 px and 44 px high on phones (below 16 px iOS zooms); modal S 440 / M 640 / L 960 px, ≤ 85 vh.
- **One breakpoint: 768 px.** Below it the modal is full screen, the Masterlist becomes cards and the sidebar becomes a drawer. JS uses `usePhone()` = `(max-width: 767px)`; CSS uses `max-width: 767px` / `min-width: 768px`. Keep them equal.
- **Login** is deliberately different: one background photo, product title on the left, a white sign-in card on the right (stacks below 1100 px). Sign-in only; accounts are created by an Admin. Do not add the workspace header to it.

## 3. The list → record pattern

Every module (Equipment, Sub-Equipment, Golden, Configuration lists, Users) is the same flow: **menu → Masterlist (full width) → click a row → Record modal**. A module only declares its columns, field groups, tabs and actions to `ModuleWorkspace`; do not build a per-feature table, drawer or dialog. There is no side panel and no full-page detail.

**Masterlist** (`components/ui/masterlist`): title and count on one line; search; per-column filters; column chooser (remembered per browser); Export Excel (exports the visible columns and rows; allowed for every role); Import where the module has one; **+ Add**. Column order is a scanning order: Status first (where the module has one), then serial, part number, location, then secondary columns. Long text clamps to two lines (full text in the tooltip and the modal). Tables scroll inside their frame. Toolbar buttons keep icon **and** text on desktop; only below 768 px do Columns / Export / tools drop the text (still named for assistive tech). An empty list offers *+ Add*; a filtered-empty list offers *Clear filters*. On phones each row is a **card** (serial + status, then location / part number / type); the toolbar is search + Filter & sort (bottom sheet) + a ⋮ menu; a floating **+** adds a record.

**Record modal** (`components/ui/record`, one shared `Modal`):

1. **One modal at a time; never stack.** Edit, Swap, Move, Detach, Delete, Check-out, "Discard changes?" and related records *replace the content of the same modal* (header shows `← <SN> › <action>`; Swap shows its title with the serial below). Only transient popovers (dropdown, action menu, date picker, tooltip) and toasts sit above it. A bottom sheet is used on phones only from the list.
2. **Three sizes, set by the screen that opens it and kept while you move around inside:** S = a short confirmation; **M = Add form and account settings**; **L = a record's detail and Import**. After *Add* saves, the M modal closes and the new record opens in an L modal. Swap is the one explicit exception: a compact centred presentation (two comparison cards, a dry-run preview of changes *old → new*; Swap is enabled only after a compatible target and a successful dry run).
3. **Fixed header and footer; only the body scrolls.** Footer: main button bottom-right (named for its verb: *Save*, *Swap*, *Delete*…; red when destructive), secondary actions to its left. The three asset modules share one footer: `Actions ▾` on the left (Swap, Move / Detach, Change location, Delete); `Edit` and `Check-out`/`Check-in` on the right (Check-out/in is the main button); sub-equipment add `Record calibration`. Actions never sit in the scrolling body.
4. **Closing**: Esc, ✕ and a click outside close it (the press must also start outside). **If anything is unsaved** — a field, a note, a choice in an action screen — closing or ← first shows *Discard changes?* (`Stay` / `Discard`) inside the same modal; Esc there means Stay. If a popover is open Esc closes only the popover. A modal that is saving cannot be closed. Focus returns to the opener.
5. **Detail view**: ‹ › and ← → step through the records in the list's current order; `?id=` is kept in the URL (so Back closes the modal and links/QR codes open the record). Tabs: Information, History (and Equipment tree on phones). On desktop, **Equipment and Overview show the tree on the right and the record on the left in the same L modal**; choosing a node swaps the record in place without reloading or stacking breadcrumbs.
6. **Locked fields** are shown as plain values (no input) and carry no explanatory text; field hints are not rendered. Required fields have a red `*`, errors sit under the field.
7. Accessibility: `role="dialog"`, `aria-modal`, focus trap, focus moved on every view change, page behind inert, reduced motion respected.

**Forms**: Add/Edit are views inside the modal with the same groups and order as the detail; labels above values. Buttons say what they do. One async action shows one loading indicator and cannot be submitted twice.

**History tables** (record History tab and Dashboard *Recent changes*, shared `HistoryTable`): fixed columns *Time, By, Record, Action* + one *Changes* column showing only the fields changed in that event as `field: old → new` (first two, then *Show more*). CREATE and DELETE start with a summary and expand to the values. An import or a multi-record action is **one row** with a count. The Dashboard table scrolls inside a frame of at most `min(420px, 55svh)`.

## 4. Status tags

All tags: Inter 12 px, weight 600, padding 5×10 px, radius 7 px, flat pastel background, no icon, border or shadow (only operating tags may have a small dot). Same on laptop and phone, light and dark. Colours live as `--tag-*` in `globals.css`; shared styling in `workspace.css`.

| Meaning | Background | Text |
| --- | --- | --- |
| Upcoming receive | `#EAF4FF` | `#1B66A5` |
| Normal | `#E7F5F8` | `#176D83` |
| Deactivated | `#EEF1F4` | `#657384` |
| Wait for registration | `#F1ECFF` | `#7354B5` |
| In use | `#E7F7EE` | `#187A4C` |
| Not in use | `#F3F4F6` | `#576575` |
| Overdue | `#FDE9E9` | `#B42332` |
| Due soon | `#FFF3D6` | `#976300` |

- **Operating state** (`UsageTag`: In use / Not in use) and **calibration status** (`CalibrationStatusTag`: Not calibrated / Failed / Overdue / Due soon / Valid) are independent; an item can be *In use + Overdue*. Failed is an error state, Valid success, Not calibrated neutral.
- Admin condition tags have six pastel colours: `blue`, `green` (shown teal), `gray`, `purple`, `yellow`, `red` (stored in `tags.color`).
- Never replace a tag's text with a dot on phones; tags wrap inside narrow containers. Colour is never the only signal (the accessible name carries the status).

## 5. Overview board

Cards grouped by Location, not a table or a tree. One **section** per Location (a full-width disclosure button with `N tester · M In use · K ⚠`), one **column** per root asset (a Tester first, then unattached assets), **at most three cards per column** (root + two) joined by a tree line, then a `+N` button for the rest. The grid is `repeat(auto-fill, minmax(150px, 1fr))`, exactly 2 columns on phones. A card is a button: Type name, `PN`/`SN`, then the operating tag (and the calibration tag when an alert exists); its left border shows the operating state. The filter bar (All / In use / Not in use, Type select, search) highlights matches with a 2 px outline; unmatched cards are not dimmed. Selection opens the shared record modal. Styles: `.ob-*` in `app/workspace.css`; data: `overview_board`.

## 6. Dashboard

Compact cards with tabular values and restrained Picton charts. **Status overview** shows Equipment (In use / Not in use) and Calibration (calibration status) side by side with a stacked bar in fixed status colours and a legend (dot, name, count, percent). KPIs for Overdue / Due soon tint only when greater than zero. Location, Type and Tag breakdowns each cover **all assets once** (with *No type* and *Untagged* rows) so each adds up to the total, and every card states its scope. Do not invent metrics.

## 7. Where things live

| Source | Responsibility |
| --- | --- |
| `app/globals.css`, `app/brand.css`, `app/workspace.css`, `app/mobile-workspace.css`, `app/login/login.css` | Tokens and base; brand and dimensions; workspace (Masterlist, modals, history, tree, `.ob-*`, dashboard); phone overrides; login. Import order in `app/layout.tsx`: globals before brand. |
| `components/AppShell.tsx`, `TopBar.tsx`, `layout/AppSidebar.tsx` | Shell, top bar, menu. |
| `components/ui/index.tsx` | Shared controls (`Button`, `Notice`, `Modal`, loading and empty/error states, toasts). |
| `components/ui/masterlist`, `record`, `workspace`, `detail` | Masterlist; record modal, fields and action screens; `ModuleWorkspace`; history table. |
| `components/ui/{ActionMenu,SearchableSelect,TagPicker,tags,ImportModal}.tsx` | Menus, selects, tag picker and tags, import dialog. |
| `components/assets` | Shared asset screens: actions, swap preview, pickers, tree, relations. |
| `components/{equipment,calibration,golden,configuration,users,overview,dashboard}` | Module screens. |
| `lib/client/usePhone.ts` | The one phone check for JS. |

Before changing CSS, read the base rule *and* its overrides and media queries; change the owning rule instead of piling on fixes; keep selectors scoped; no inline colours or fonts.

## 8. Checklist before delivering a UI change

- Reuses the shell, tokens and shared components; smallest addition that works.
- Brand group still on one line at the left; Inter and the brand colours unchanged.
- Light and dark, EN and VI (long Vietnamese text, long identifiers), and loading / empty / error / disabled states.
- Desktop (1440×900), laptop (1366×768), phone (390×844 and 320×568): no page overflow, clipped actions or overlap; touch targets ≥ 44 px.
- Keyboard focus, dialog and menu navigation. For modals: one at a time, Esc / ✕ / outside click, the unsaved-changes view, focus return, fixed header/footer, full screen below 768 px, the `?id=` deep link.
- `npm run typecheck`, `npm run lint`, `npm test`; check visually in a browser when possible and say so honestly when it was not possible.
