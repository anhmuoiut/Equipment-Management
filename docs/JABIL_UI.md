# UI requirements: Equipment Management

Updated: 14 October 2026 (manual sidebar footer control; SolarEdge logo and developer credit on desktop and phone; shared pastel status tags on laptop and phone; operating state independent of calibration deadlines; six admin tag palettes including yellow/red). Modal system: default fixed size per modal with the compact Swap presentation exception, unsaved-changes rule, one 768px phone breakpoint. Status: accepted design baseline.

## Read this before changing UI

This is the authoritative UI requirements document for new features and changes throughout this project: login, workspace, dashboard, equipment, administration, dialogs and printable labels. Developers and AI coding assistants must read it before changing UI.

The guiding principle is **compact, clear, consistent**. Preserve working space for equipment data and everyday tasks. Extend the existing design system rather than introducing a different visual language for each feature.

Explicit new user instructions take precedence. Otherwise, follow this document for visual decisions and the feature specifications for business behavior. If a deliberate design change is requested, update this document in the same change. Do not silently redesign unrelated screens.

[APP_SHELL.md](APP_SHELL.md) defines the menu and routes. [DETAIL_MODEL.md](DETAIL_MODEL.md) defines the one list and detail layout that every module uses (Masterlist + Detail Modal). Its visual treatment must follow this document.

## 1. Brand and typography

| Primary color | Value | Purpose |
| --- | --- | --- |
| Prussian Blue | `#002B49` | Primary text, sidebar, primary actions in light mode |
| White | `#FFFFFF` | Light content surfaces, text on Prussian backgrounds |
| Picton Blue | `#3CB4E5` | Selection, focus, chart accents, primary actions in dark mode |

These are the three **primary brand colors**, not a ban on semantic colors. Errors and destructive actions stay red, warnings stay amber, and success stays green. Photographs keep their original colors. Decorative surfaces, borders, shadows and overlays use the existing brand tokens and mixtures.

Use **Inter throughout the project**, including forms, buttons, tables, dialogs, identifiers and printed labels. Inherit `var(--font-ui)` and retain its system sans-serif fallback. Do not introduce another font for a new feature. Use tabular numerals for aligned numbers and identifiers.

Use Prussian text on Picton backgrounds and white text on Prussian backgrounds. Use theme tokens for text/surface combinations; do not assume light-mode colors work in dark mode.

### Required token reuse

| Meaning | Existing CSS tokens |
| --- | --- |
| Brand | `--jabil-prussian`, `--jabil-white`, `--jabil-picton` |
| Text | `--ink`, `--ink-2`, `--ink-3` |
| Surfaces and borders | `--surface`, `--panel`, `--rule`, `--rule-soft` |
| Actions and selection | `--machine`, `--machine-dark`, `--machine-tint`, `--action-ink` |
| Error / destructive | `--alert`, `--alert-tint` |
| Warning | `--warn`, `--warn-tint` |
| Success | `--success`, `--success-tint` |
| Information / waiting | `--info`, `--info-tint` |
| Neutral / inactive | `--neutral`, `--neutral-tint` |
| Status marks (dots, chart fills) | `--status-green`, `--status-yellow`, `--status-red`, `--status-blue`, `--status-gray` |
| Overlay | `--overlay` |

`--ok` is a legacy brand-action alias, not the success color. Use `--success` for new success states. Do not add local hardcoded hex colors or override global tokens inside a feature to obtain a different palette.

## 2. Workspace shell and branding

- Keep **Jabil | Equipment Management** on a single row at the **left edge of the top bar**, with the existing padding and a subtle vertical divider. Use **Equipment Management** as the app name and browser title.
- Both `.app-brand` and `.app-brand-row` must remain left-aligned with `justify-content: flex-start`. The parent must not inherit centered alignment when its flex direction is changed.
- Do not center the brand group, put the app name below the logo, or repeat the brand as another banner inside a workspace page.
- Keep preferences and user actions on the right. The page's own title belongs in its content heading, not a second header row.
- Use the existing `AppShell`, `TopBar`, sidebar and logo components. A new workspace route must participate in the shared shell rather than create its own header/navigation.
- The sidebar remains Prussian with a Picton selected item and readable labels. Preserve expanded, collapsed and mobile navigation behavior.
- On narrow screens, keep the brand left-aligned; truncate the app name with its full title available rather than wrapping or pushing actions off screen. On a phone the header holds only menu · brand · account: **language and theme move into the account menu** (radio items for the language, one item for the theme) instead of a separate disclosure button.

### Sidebar navigation structure

The menu is defined in [APP_SHELL.md](APP_SHELL.md).

- The sidebar has **one flat level** with seven items in this order: Dashboard (`/`), Overview (`/overview`), Equipment (`/equipment`), Sub-Equipment (`/calibration`), Golden (`/golden`), then a divider, then Configuration (`/configuration/…`) and User Management (`/users`). There is no second sidebar tier and no Administration group.
- Configuration and User Management are shown only to Admin. User and Readonly see the first five items and no divider. The server layouts enforce the same rules, and an unauthorized route redirects to the Dashboard.
- Menu items carry no count badges. The sidebar has navigation, the SolarEdge logo and a footer. The expanded desktop footer shows the exact credit **Developed by Man Tran8118** in centered 11px text above the collapse button, in both languages and themes. The phone drawer shows the same credit at the bottom, above its safe-area padding, with no desktop collapse button. The credit is hidden only in the collapsed desktop rail. Do not add a static dot or a live-status line.
- A detail route (for example `/equipment/{id}`) marks its parent item as current.
- Configuration picks its lists from an in-page grouped sub-list: DỮ LIỆU GỐC, HIỆU CHUẨN and HỆ THỐNG (Error log). Each group header is a disclosure button with `aria-expanded`. The group holding the current page is always open. On phones the sub-list becomes a grouped select at the top of the page.
- Sidebar grids use `minmax(0, 1fr)` columns. Expanded links place the name beside the icon and truncate long labels with an ellipsis. The collapsed desktop rail is **96px wide**, with each name centered **under** its icon (Inter 11px, 14px line height); longer names wrap inside the link. Labels remain visible in both states, and each link's `title` retains the full name. Desktop expansion is **manual only**: a centered footer button shows `ChevronsRight` (`>>`) to expand and rotates it 180° (`<<`) to collapse; hover, pointer leave and keyboard focus never resize the sidebar. Remember the user's choice with the existing storage key. The navigation scrolls separately on short screens so the footer stays reachable. On phones the header hamburger controls the drawer; the logo and developer credit remain at its top and bottom while the menu scrolls between them, regardless of the saved desktop choice.
- Show [`solaredge-logo.svg`](../public/Icon/solaredge-logo.svg) above the menu in the expanded desktop sidebar and the phone drawer. Preserve the supplied black/red artwork on a small white surface so it stays readable on the Prussian rail in both themes. Hide it only in the collapsed desktop rail. Phone branding uses the full drawer layout and slides with the panel, without shrinking its logo or footer slots during movement.
- Sidebar motion uses one damped spring for width, row heights, icon positions and footer chevron rotation. Opening has a subtle settle (less than 1px overshoot on desktop); closing is quicker and does not bounce. Rapid repeated clicks preserve momentum and settle at the latest choice. A native animation loop updates CSS variables without rendering React each frame. Desktop rows move between 38px expanded and 72px compact. Expanded labels reveal in a short sequence once there is space; compact labels fade back under the icons. Fixed text layouts prevent wrapping and font sizes from jumping midway. Keep the logo and credit mounted in reveal slots, with `aria-hidden` while collapsed; their space follows the spring and their text fades in later. The footer button gives a small press response. The phone drawer and backdrop share the same progress and finish their exit before becoming hidden. Reduced motion snaps directly to the chosen state, including when that preference changes during movement. Keep the 320ms CSS curve as a pre-hydration fallback. This choreography takes inspiration from [Material 3 motion](https://m3.material.io/styles/motion) and [Atlassian motion](https://atlassian.design/foundations/motion); the spring parameters are tuned for this workspace.

### Current compact dimensions

These are the baseline for shared workspace UI. Reuse the existing classes; do not duplicate the values across feature stylesheets.

| Element | Desktop baseline | Responsive behavior |
| --- | --- | --- |
| Header | 52px high | 56px below 768px |
| Sidebar | 216px expanded / 96px rail, names below icons | Drawer overlay below 768px; width limited to viewport |
| Content padding | 16px | 12px below 768px |
| Page heading | 23px, weight 600 | 21px on mobile |
| Body type | 14px | Keep readable; do not shrink the entire UI |
| Table cells | 13px type; 9px vertical / 12px horizontal padding | 12px vertical padding on mobile |
| Table headings | 11px; 10px vertical / 12px horizontal padding | Preserve column readability |
| Shared buttons | 34px standard / 30px small minimum height | 44px minimum height on mobile (48px for the modal footer) |
| Form controls | 14px / 13px type | **16px and 44px high on phones** — below 16px iOS zooms the page when a field is focused |
| Toolbar | 10px vertical / 12px horizontal padding | Wrap controls into usable rows |
| Modal | S 440 / M 640 / L 960px wide, 85vh high at most; 16px body padding; Swap uses the explicit compact presentation below | Full screen below 768px except compact centered Swap. Header and footer stay put; only the body scrolls, without clipping required fields/actions |

Compact means removing duplication, excess margins and unnecessary containers. It does not mean hiding important labels, making touch targets difficult, or removing helpful error messages. Do not add oversized hero headings, large empty banners, decorative heading rows, or cards nested inside cards without a functional reason.

## 3. Login design to preserve

Login is intentionally different from the authenticated shell; do not add the workspace header to it.

- One full-page background photo, [`login-signup-background.webp`](../public/login-signup/login-signup-background.webp), anchored top-left over the light blue page background. It is the only image on the page.
- Desktop: the product title on the left — "Equipment / Management" (second line blue), the workcell name, a short cyan accent bar and four capability icons — on a soft white glow so it stays readable over the photo; the form on the right in a white card with rounded corners and a light shadow (440px wide, 460px from 1600px).
- At 1100px and below everything stacks: a 440px photo band at the top, then the centred title, then the form card. The page scrolls on short screens.
- The card holds sign-in only: accounts are created by an Admin, so there is no sign-up or account-request form. `/change-password` reuses these form styles in a single column.
- Keep text and inputs clear of busy photographic content.
- Preserve Inter typography, 49px inputs and sign-in button, the password visibility control, the "Forgot your password?" help (tells the user to ask an Admin to reset the password), the disabled SSO button ("Coming soon") and the language/theme controls under the card.
- Autofill must use the normal input surface and readable text. Keep visible focus and semantic red errors in both themes.
- Preserve actual authentication and redirect behavior. A visual change must not modify access checks, credentials, session handling or API contracts.

## 4. Feature components and interaction

Reuse shared controls from [`components/ui/index.tsx`](../components/ui/index.tsx): `Button`, `Notice`, `Modal`, loading controls (`Spinner`, `Skeleton`, `TableSkeleton`, `LoadingOverlay`), `EmptyState`, `ErrorState` and the existing toast system. Turn API errors into user text with `errorMessage()` (`lib/client/api.ts`) and load data with `useFetch()` (`lib/client/useFetch.ts`) — never show raw error messages. Check the actual exported props before use. Extend a shared component for a reusable requirement rather than copy it into a feature with different styling.

Every module page uses the same list and detail components ([DETAIL_MODEL.md](DETAIL_MODEL.md)). A module only declares its columns, field groups, tabs and actions:

- `ModuleWorkspace` lays out the page. It renders the `Masterlist` (search, filters, sorting, column settings, Excel export, + Add) at the **full content width** and opens the record modal over it. It also handles the `?id=`, `?new=1` and `?tool=` URLs (modal state lives in the URL), and ‹ › / ← → navigation in the current list order.
- `RecordModal` (built on the shared `Modal`, `size="s" | "m" | "l"`) shows a record and keeps a stack of views: detail → edit / add / workflow action / confirmation, all inside **one** modal. `FieldView` / `FieldEditor` draw the field groups and `ActionScreen` the action forms (its buttons go into the modal footer through `ModalFooter`).
- Equipment detail on desktop (13 October 2026, from 768px) combines the equipment tree on the left and record information on the right inside the same L modal. The tree has its search, expand/collapse and current-equipment controls; each pane scrolls within the fixed header/footer. Desktop equipment selection (tree or parent/child link) replaces the current record without accumulating navigation breadcrumbs; the header shows the current device. Desktop keeps Information and History tabs; phones retain Information, Equipment tree and History. Overview uses this same responsive layout. Forms and action screens keep their shared layout.
- There is no full-page detail and no side panel: `/equipment/{id}`-style paths (QR labels) redirect to `/equipment?id={id}`.

Do not build a per-feature modal, drawer or table for a record type. Every dialog — record, form, action, confirmation, import, account settings — is the one `Modal` with a size prop ([Modal system](#modal-system-details-forms-and-actions)). The explicitly requested Swap presentation uses `ActionDef.presentation` on that same modal and view stack.

Use the existing `lucide-react` icon style and established sizing. Decorative icons must not be announced as content; icon-only actions need an accessible name. Keep primary, quiet and destructive button variants consistent. Red destructive actions retain the existing confirmation behavior and warning treatment.

### Lists, tables and dashboards

- Module lists use `Masterlist` (`.ml-*` in [`app/workspace.css`](../app/workspace.css)). Other tables reuse `.page-heading` and `.grid-table`.
- Keep search, filters, counts and actions compact and clearly grouped. Preserve sorting, filtering, pagination and permission-based actions.
- **Phones do not squeeze the table.** The Masterlist becomes a list of cards (serial + status, then location / part number / type; Calibration adds the coloured due date). The toolbar is search + Filter & sort (a bottom sheet) + a ⋮ menu (Export, Import); a floating + adds a record. Details: [DETAIL_MODEL.md](DETAIL_MODEL.md) §3.11.
- Tables use subtle dividers, restrained alternating row tint, and readable hover/focus states (a keyboard-focused row gets a Picton outline, not just the hover tint). Wide tables scroll inside their frame; they must not widen the whole page or silently lose columns.
- **Column order is a scanning order**: the module's Status first when it has one (Equipment, Sub-equipment, Calibration), then what it is (serial, part number), where it is (location), then secondary columns. The Masterlist uses the full content width, so the default columns fit without a panel beside them; the first columns must still identify the record on their own. Wrapping columns (Remark, Description…) show at most two lines (`.ml-clamp`); the full text is in the cell tooltip and the Detail Modal.
- **The toolbar keeps icon and text on desktop and tablet** (the list has the whole width). Only in a narrow window (below 768px) do Columns, Export and module tools such as Import keep their icon and name (`aria-label`, tooltip) and drop the text (`ToolbarButton`, a container query on `.ws-list`). Filters and + Add always keep their text. Do not hide a toolbar action on desktop to save space.
- Title and record count share one line on list pages. A list with no records offers the + Add action; a list that filters hide offers Clear filters.
- Let the equipment table use the available workspace height. Do not add arbitrary minimum heights that push content beyond the viewport.
- Dashboard cards use compact spacing, small corner icons, tabular values, restrained Picton charts and semantic highlights. Do not invent metrics or status data to decorate a screen.
- The Dashboard **Status overview** shows Equipment (In use / Not in use) and Calibration (Calibration Status) side by side (one column each, stacked on phones). Each has a stacked bar in fixed status colors (2px gaps, always the same order, not by count) and a legend with dot, name, count and percent, which works as the table view. Overdue and Due soon KPIs tint their icon red / amber only when the count is above zero.
- History tabs and Dashboard Recent changes share `HistoryTable`: **one event per row**, with fixed metadata columns **Time, By, Record, Action** and a single **Changes** column; Dashboard adds **Module** and keeps record links. The Changes cell shows only fields changed in that event as `field: old → new`, including location changes; do not create a column for every field found in other rows. Ordinary events show the first two changes, with **Show more / Show less** expanding the rest inside the same cell. **CREATE** starts with a creation summary and expands to the initial field values; **DELETE** starts with a deletion summary and expands to the deleted snapshot. Source and notes appear in the row's expanded Changes cell. Keep history as a table on phones, with horizontal scrolling inside its frame and a sticky header.
- Recent activity must not grow the page with every log. Cap its table frame at `min(420px, 55svh)` and scroll within it, keeping the card heading outside the scroll area. Keep every returned log accessible; long values use Show more / Show less. Support keyboard scrolling with a named focusable region. Short/empty tables should stay compact. A batch import remains one row with a count summary; do not expose its representative object's record link, initial values or other field details as values for the whole batch.
- Include appropriate loading, empty, error and success states for new data flows using shared patterns.

### Overview board (cards grouped by Location)

The Overview page ([DETAIL_MODEL.md](DETAIL_MODEL.md) §4.6) is a board of **cards**, not a table or a tree: one **section** per Location, one **column** per root asset inside it (a Tester first, then loose assets), a root card on top and up to two more cards under it (three in all) joined by a tree line. It reuses the page heading, `Button`, `SearchableSelect`, `EmptyState`, `ErrorState` and the record modal; only the board is new, and its CSS lives in [`app/workspace.css`](../app/workspace.css) (`.ob-*`).

| Element | Specification |
| --- | --- |
| Section header | One full-width **button** per Location (`aria-expanded`): 36px high on desktop, 44px on phones. Chevron `▾` / `▸`, the Location name (13px, weight 600, `--ink`) and `N tester · M In use · K ⚠` (12px, `--ink-2`). The ⚠ is `--warn` when K > 0 and `--alert` when a column of the section has a red alert. 1px `--rule-soft` bottom border on the `--surface` background. A Location with no columns, or none left after filtering, has no header at all. |
| Grid | `display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; align-items: start`. That is about **7 columns** in the 1100px content area of a 1366px laptop. Below 768px the grid is exactly **2 columns** (`repeat(2, minmax(0, 1fr))`, 8px gap, 12px content padding). The grid sits 8px under its header; sections are 12px apart. |
| Column | A `role="group"` named by the root serial. Cards stack with a 4px gap, **top-aligned** — columns have different heights. |
| Card | A `button`, **no icon**. Padding 6px 8px, `border-radius: var(--radius-control)`, 1px `--rule` border, left border = operating state, minimum height 52px. **Line 1:** Type name, 12px weight 600 `--ink`. **Lines 2 and 3:** `PN` / `SN` labels and values, truncated with full text in `title`. **Status row:** shared `UsageTag` and, when applicable, `CalibrationStatusTag`, wrapping within the card. The card never shows the Location. Background `--panel`; the root uses `--surface`. |
| Status border | `data-status-color="green"` = In use, `"gray"` = Not in use (the shared `--sc-mark`). The accessible name carries the Status in words — colour is never the only signal. |
| Calibration tag | Text only: amber for `due_soon`, red for `overdue` and `failed`. On sub-equipment it is its own alert; on a root it is the worst alert among its children, including hidden children. It appears alongside the operating tag. Section alert counts retain their existing icon. |
| "Chưa gắn" | A fourth line of the **root** card of an unattached asset (10px, `--ink-3`), not a separate element, so root cards of every column start at the same height. |
| Tree line | A 1px `--rule` line from the root card down the column, `├` to each middle card and `└` to the last, drawn with CSS borders and `aria-hidden`. **10px indent per level**, at most **4 levels** (Tester → Base → Fixture → Golden); a child card is the column width minus its indent. A pulled-in parent card keeps the line unbroken. |
| "+N thiết bị" | A text button (12px, `--machine`, underlined on hover) after the last tree glyph, only when N > 0; same action as the root card. |
| Highlight | Only while the **Type** filter or the search box is used (a Status filter matches every card of a kept column, so nothing is marked): a matched card gets a 2px `--machine` outline and `--machine-tint` background; the Status border stays. Unmatched cards are not dimmed. |
| States | Hover: `--machine-tint` background. Keyboard focus: the shared Picton focus ring. Collapsing or opening a section is instant (no animation). |
| Filter bar | One row that wraps, above the sections: a segmented control (All / In use / Not in use), a Type select, a search box — 34px high on desktop, 44px on phones. |
| Themes | Theme tokens only — no hard-coded colour. Both themes and EN / VI (long Vietnamese Type names truncate on line 1 like PN and SN) must be checked. |

### Status tags and feedback (14 October 2026)

Every tag uses **Inter, 12px, semibold 600, padding 5px 10px, radius 7px**, a flat pastel background and no decorative icon, gradient, border or shadow. Only operating tags may include a small dot. Keep the same dimensions and the following exact HEX pairs in both themes, on laptop and phone; remove feature-specific tag overrides. Interactive pickers provide a 44px hit area around the same tag.

| Status | Background | Text |
| --- | --- | --- |
| Upcoming receive | `#EAF4FF` | `#1B66A5` |
| Normal | `#E7F5F8` | `#176D83` |
| Deactivated | `#EEF1F4` | `#657384` |
| Wait for registration | `#F1ECFF` | `#7354B5` |
| In use (Online) | `#E7F7EE` | `#187A4C` |
| Not in use (Offline) | `#F3F4F6` | `#576575` |
| Overdue | `#FDE9E9` | `#B42332` |
| Due soon | `#FFF3D6` | `#976300` |

- `StatusTag` and `TagPicker` render manual tags using `data-manual-color`. Admin Configuration offers six pastel choices: `blue` → blue, `green` → teal, `gray` → gray, `purple` → purple, `yellow` → yellow and `red` → red. Yellow uses `#FFF3D6` / `#976300`; red uses `#FDE9E9` / `#B42332`, with the same typography and dimensions as the previous colors. The latest user request permits these two colors on custom manual tags. The four canonical manual names (and supported Vietnamese equivalents) keep their specified palettes, including purple for Wait for registration. Apply [the tag palette migration](../database/migrations/2026-10-14_tag_palette.sql) before deploying this picker on an existing database: it adds the explicit `purple` key and converts the former yellow-key purple tags once, preserving their IDs, assignments, timestamps and history. Subsequent yellow selections remain yellow when the migration is rerun.
- `UsageTag` is the operating state. `CalibrationStatusTag` is independently calculated from calibration dates. An equipment may show **In use + Overdue** or **Not in use + Due soon** at the same time. The same distinction applies to future PM deadlines; this UI change does not add a PM data model.
- Phone cards keep visible operating, calibration and manual tags; never replace their text with a dot. Calibration's default desktop columns include both calibration and operating states. Overview cards show both states when an alert exists. Tags wrap within narrow containers, including Vietnamese text.
- `DueDate` uses the shared calibration tag for deadline labels. Failed remains an error state, Valid a success state and Not calibrated neutral. Account and other feedback tags retain their semantic meanings with the shared pastel styling.
- Exact pairs live in `globals.css` as `--tag-*`; `workspace.css` owns shared tag styling. General alerts, destructive controls and chart marks retain their existing theme tokens. Nominal charts such as location/type use Picton.

Error copy should state the problem and a useful next step without exposing internal secrets.

### Modal system (details, forms and actions)

Every record detail, form, workflow action, confirmation and import is a **modal**. There is no side panel and no full-page detail. The rules apply to Equipment, Calibration, Golden, Overview, Configuration and User Management, and to global dialogs such as account settings. Behavior is specified in [DETAIL_MODEL.md](DETAIL_MODEL.md) §3.

1. **One modal at a time. Never stack.** Anything opened from inside a modal — Check-out / Check-in, Edit, Swap, Move, Detach, Delete, a related record, "Discard changes?" — **replaces the content of the same modal** with a new view. The header normally shows a breadcrumb `← <SN> › <action>`; Swap instead shows its action title with the serial on a secondary line. The ← button goes back one view. When the action finishes the modal returns to the record's detail view and shows a toast. Only transient popovers (dropdown, action menu, `SearchableSelect` list, date picker, tooltip) and the toast may sit above a modal. A bottom sheet is used on phones only from the list (Filter & sort), never over a modal.
2. **Three shared sizes**, one shared `Modal` component, size is a prop. Other than the explicit Swap presentation below, do not invent another width or a per-feature dialog.

   | Size | Width | Opens directly as |
   | --- | --- | --- |
   | `s` | ~440px | A short standalone confirmation (not tied to a record) |
   | `m` | ~640px | The Add form (`+ Add`), account settings and other global dialogs |
   | `l` | ~960px | A record's detail (row click, ‹ ›, `?id=` link) and Import |

   Width is normally `min(size, 100vw − 32px)`. **The size prop is set by the screen that opens the modal and stays unchanged** — going detail → edit / other actions / confirmation → back retains the default frame. Inside an `l` modal those later screens normally limit their content to ~640px, centered (the header and footer keep the full width and the main button stays in the footer's right corner); inside an `m` modal they use the full width. **Swap is an explicit presentation exception**: the same modal instance uses the compact width and content height below while Swap is active, including its discard confirmation. **Add** remains a lifecycle exception: after it saves, the `m` modal closes and the new record's detail opens in a new `l` modal, with a toast.
3. **Fixed header and footer; only the body scrolls**, at most 85vh (`85dvh`). Header: title or breadcrumb, ✕; the detail view also has ‹ ›, the status tag and the quick facts, and its tab bar stays fixed too. Footer: the **main button in the right corner**, secondary actions to its left (`Cancel`, `Actions ▾`). Record modals of the three asset modules share one footer: `Actions ▾` on the left (Swap, Move / Detach, Change location, Delete); `Edit` and `Check-out` / `Check-in` on the right, plus `Record calibration` before Check-out for sub-equipment — Check-out / Check-in, the rightmost, is the main button. Overview opens the owning module's modal, with no footer of its own. The main button is named for its verb (**Save**, **Swap**, **Delete**…); a destructive one is red. Actions never sit inside the scrolling body.
4. **Closing**: Esc, ✕ and a click outside all close the modal. A click outside counts only when the press also began on the backdrop (selecting text and releasing outside must not throw the form away). **If anything is unsaved** — a form field, a note, or a choice made in an action screen (swap partner, new parent, follow / stay…) — closing (or the ← in the breadcrumb) first shows "Discard changes?" (`Stay` / `Discard`) as a screen inside the same modal, never a second dialog; Esc on that screen means Stay. **If a popover is open** (dropdown, action menu, `SearchableSelect` list, date picker), **Esc closes only the popover**. A modal that is saving cannot be closed. After closing, focus returns to the element that opened it and the list keeps its scroll position.
5. **Phones (below 768px): full screen by default.** Shared sizes become full-screen views (no radius, no backdrop) with fixed header and footer, 44px touch targets, 48px footer buttons, 16px inputs and safe-area padding. Swap is the explicit compact centered exception below. 768px is the one phone breakpoint for the whole UI: default full-screen modal, card Masterlist and drawer sidebar all switch at the same width.
6. **Detail modal**: ‹ › in the header and the ← → keys step through the records in the list's current filter and sort order. They are hidden in form / action views, and the keys are ignored inside inputs or with a modifier key. `?id=<id>` is kept in sync (pushed when opened from the list, replaced when stepping, removed on close) so a link or QR code opens the record directly and the browser Back button closes the modal. An unknown or forbidden id shows an error view with Close.
7. **Masterlists use the full content width.** Nothing sits beside the list.

Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title, a focus trap, focus moved to the title (or first field) on open and on every view change, the page behind inert and not scrollable, reduced motion respected. Use the established layering tokens: modal above content and sidebar, popovers and toasts above the modal.

### Swap presentation

Swap keeps the same `Modal`, `RecordModal` view stack and `ActionScreen` behavior. Its scoped `record-swap-dialog` presentation has width `min(820px, 100vw − 32px)` and content height, with no inherited 600px L-modal minimum or 640px content limit. The header is the action title plus the current serial on a secondary line, with Back and Close; the footer retains Cancel and the primary Swap button. Busy locking, translated errors, focus, Escape and the unsaved-changes screen remain shared; the Swap frame and selected target stay in place during discard confirmation.

Two comparison cards show current equipment A and the selected target B: **SN, Part number, Location, Usage**, plus **Level for Equipment**. The searchable target picker stays in B's card. Above 900px the cards sit side by side; at 900px and below they stack. On phones the dialog stays compact and centered, with maximum height `100dvh − 32px`; the body scrolls while header and footer stay reachable.

`SwapPreview` presents the actual dry-run response as changed fields **old → new**, grouping results by asset. A and B appear first; affected descendants expand with Show more / Show less. Location, parent/tester, Level and Usage appear when the response changes them. Status may follow the destination under the existing business rules; do not claim it always stays unchanged or hardcode preview values. Enable Swap only after a compatible target and successful current dry run; same-place targets remain blocked.

### Forms, dialogs and menus

- Add and Edit are **form views inside the modal** (size `m`, same groups and order as the detail view). Labels stay above values, required fields carry a red `*`, and errors appear under the field. Other forms reuse the existing input, validation and modal patterns.
- Dialog headers/close controls remain accessible while long bodies scroll. Stack fields on narrow screens and keep actions reachable, including the mobile safe area.
- On phones, list-level pickers and filters are **bottom sheets** (`Modal` with `sheet`) and action menus open from the bottom with 48px rows — only when no modal is open. Inside a modal, `SearchableSelect`, menus and date pickers are anchored popovers (never a second sheet), and Escape closes the popover first, then the modal. Primary actions of a record sit in the modal footer, in thumb reach.
- Toasts appear below the header; the stack is portaled to `<body>`, so it must not depend on CSS variables defined on `.app-shell` (use a fallback). Error toasts use `role="alert"`; the others `role="status"`.
- A dialog closes on a backdrop click only when the press also started on the backdrop: selecting text in a field and releasing outside the dialog must not throw the form away. Forms outside records (Account settings) use the same modal and field styling (`ActionField` with `htmlFor`), not their own inputs.
- Action buttons say what they do: **Save** persists a record form, **Delete** removes, and a workflow screen names its verb (**Swap**, **Change location**, **Attach**, **Reset password**…). Use the generic **Confirm** only when nothing more specific fits. One async operation shows one loading indicator.
- Preserve keyboard navigation, focus trapping/restoration and Escape handling. Dropdowns/popovers stay inside the viewport and use the established layering tokens.
- Keep disabled and loading states meaningful; prevent duplicate submissions through the existing behavior.
- Use subtle borders and existing radii/shadows rather than a new visual style for each dialog.

## 5. Responsive, themes and localization

Every new screen must support both light and dark themes and English/Vietnamese. Put new user-facing strings in both [`en.json`](../src/i18n/locales/en.json) and [`vi.json`](../src/i18n/locales/vi.json); reuse existing translation keys when appropriate. The fixed product brand name is not translated.

Check long Vietnamese text, long equipment identifiers, validation messages and empty results. Use wrapping/truncation deliberately; preserve access to essential information. Do not hide functionality solely to make a screenshot look compact.

Keep visible keyboard focus, semantic labels and readable contrast. Respect reduced-motion preferences for new animation. Printed equipment labels remain dark Prussian text/QR modules on white regardless of screen theme.

## 6. Implementation map and CSS rules

| Source | Responsibility |
| --- | --- |
| [`app/globals.css`](../app/globals.css) | Base typography, palette/semantic tokens, shared layout and behavior styles |
| [`app/brand.css`](../app/brand.css) | Current workspace branding, compact dimensions, component styling and responsive overrides |
| [`app/layout.tsx`](../app/layout.tsx) | Font loading and global CSS import order: globals before brand |
| [`components/AppShell.tsx`](../components/AppShell.tsx) | Shared authenticated workspace |
| [`components/TopBar.tsx`](../components/TopBar.tsx) | Left-aligned brand row and right-side controls |
| [`components/layout/AppSidebar.tsx`](../components/layout/AppSidebar.tsx) | Seven-item menu, collapsed/mobile sidebar |
| [`lib/client/usePhone.ts`](../lib/client/usePhone.ts) | The one phone check for JS: `(max-width: 767px)` — keep equal to the CSS media queries. **768px is the single phone breakpoint of the whole UI** (full-screen modal, card Masterlist, drawer sidebar): JS uses `(max-width: 767px)`, CSS `max-width: 767px` / `min-width: 768px` |
| [`components/ui/ActionMenu.tsx`](../components/ui/ActionMenu.tsx) | `Actions ▾` / ⋮ menu: a popover portaled to the body next to its button (opens upward from the footer); rows are 48px on phones. A popover, never a second sheet |
| [`lib/permissions/index.ts`](../lib/permissions/index.ts), [`components/ViewerContext.tsx`](../components/ViewerContext.tsx) | Role groups (Admin / User / Readonly) and which buttons a viewer sees |
| [`app/workspace.css`](../app/workspace.css) | Masterlist, modal views, history, equipment tree tab, Overview board (`.ob-*`), Configuration sub-list, Dashboard |
| [`components/ui/masterlist/`](../components/ui/masterlist) | `Masterlist`, `ColumnSettings`, `ToolbarButton`, Excel export |
| [`components/ui/record/`](../components/ui/record) | `RecordModal` (view stack, breadcrumb/default header, action presentation, common footer, "Discard changes?" view), `ActionScreen`, field components (`fields.tsx`) |
| [`components/ui/detail/DetailHistory.tsx`](../components/ui/detail/DetailHistory.tsx) | Shared `HistoryTable` for history tabs and Dashboard Recent changes: one event per row, fixed metadata columns and one Changes cell with row-specific changes and Show more / Show less |
| [`components/overview/`](../components/overview) | Overview board: Location sections, columns, cards — specified in [Overview board](#overview-board-cards-grouped-by-location); the code is still the old tree until the board is built |
| [`components/assets/`](../components/assets) | Shared UI of Equipment / Calibration / Golden: action screens, `SwapPreview` dry-run changes, other result previews, pickers, tree tab, relations |
| [`components/ui/workspace/`](../components/ui/workspace) | `ModuleWorkspace` (full-width list + record modal, URL state through `lib/client/useUrlParams.ts`) |
| [`components/ui/tags.tsx`](../components/ui/tags.tsx) | `StatusTag`, `DueDate`, `AccountStatusTag` |
| [`components/configuration/ConfigNav.tsx`](../components/configuration/ConfigNav.tsx) | Grouped Configuration sub-list; becomes a select on phones |
| [`components/JabilLogo.tsx`](../components/JabilLogo.tsx) | Reusable Jabil brand asset |
| [`components/ui/index.tsx`](../components/ui/index.tsx) | Shared controls and feedback |
| [`components/Preferences.tsx`](../components/Preferences.tsx) | Theme/language controls |
| [`app/login/page.tsx`](../app/login/page.tsx), [`app/login/login.css`](../app/login/login.css) | Authentication composition and scoped styles |

Before editing, inspect both the base rule and its overrides/media queries. Change the owning rule rather than continually appending conflicting fixes. Keep feature selectors scoped, avoid broad overrides of all buttons/inputs/headings, and do not use inline colors/font styles to bypass the system. Preserve global CSS import order.

## 7. Checklist for developers and AI assistants

Before implementing a feature:

- Read this document and inspect the nearest existing screen/component for the same task.
- Reuse the shared shell, tokens, components and localization structure.
- Identify the smallest UI addition that satisfies the feature without consuming unnecessary workspace.

Before delivering:

- Confirm the Jabil/app-name group is still on one line at the left, with actions on the right.
- Confirm the font, three primary brand colors and semantic feedback match this document.
- Check light/dark themes, EN/VI, long content, loading, empty, error and disabled states affected by the change.
- Inspect desktop (for example 1440x900), laptop (1366x768) and phone (390x844, and 320x568 for the smallest), plus affected breakpoints. Ensure no page overflow, clipped actions or photo/form overlap, and touch targets of at least 44px on phones.
- Check keyboard focus, dialog/menu navigation and touch usability for changed controls. For modal changes also check: only one modal ever open (actions replace the content), Esc / ✕ / outside click, the unsaved-changes view, focus trap and focus return, fixed header/footer with a scrolling body up to 85vh, default full screen below 768px and compact centered Swap, and the `?id=` deep link.
- For code changes, run `npm run typecheck`, `npm run lint` and relevant existing tests; add behavior tests when the new functionality warrants them. Documentation-only edits need link/content checks, not a full application test run.
- Perform browser visual verification when available. Report any unavailable checks honestly; passing lint/tests is not proof of visual correctness. Historical screenshots are not current verification evidence.
- Update this document if the requested feature intentionally changes the shared UI standard. Keep unrelated data, authentication and authorization behavior intact.

Suggested instruction for future feature requests:

> Implement the requested feature using the existing UI system. Read and follow `docs/JABIL_UI.md` first; reuse shared components and tokens, preserve the left-aligned Jabil/app-name header, compact workspace, Inter, semantic status colors, light/dark themes and EN/VI support. Do not redesign unrelated screens.
