# design-sync notes — SoulLedger v3

Target: claude.ai/design project "SoulLedger v3" (`projectId` in config.json).
Scope chosen 2026-10-01: tokens + base components + nav shell (41 components). Rich
previews authored for the core set; the rest ship on the floor card.

## How this repo is built for sync (not a published package)

- The web frontend is a Next.js app with no `dist/`. `.design-sync/pkg/` is a synthetic
  package root: `package.json` (name `soulledger`, `types` → generated d.ts) and
  `entry.tsx`, which only re-exports from `frontend/`. `cfg.entry` points at it, so
  PKG_DIR = `.design-sync/pkg/` and every package-relative cfg path starts with `../../`.
- Run `cfg.buildCmd` before the converter, from the repo root, on node ≥ 20.9
  (`nvm use`): `node .design-sync/build-css.mjs` (Tailwind compile of
  `frontend/app/globals.css`) and `tsc -p .design-sync/tsconfig.types.json` (d.ts for
  the entry → `pkg/.generated/types`). Both outputs are gitignored. Without the tsc step
  every `<Name>.d.ts` is an `[key: string]: unknown` stub — no error is printed.
- `--node-modules ./node_modules` (repo root; npm workspaces hoist everything there).
- Entry imports are relative (`../../frontend/...`), not `@/`: esbuild applies
  `frontend/tsconfig.json` paths only to files under `frontend/`.
- `process-shim.ts` is imported first: `next/link` / `next/navigation` read
  `process.env.__NEXT_*` at module scope; without it the whole bundle throws
  `process is not defined`.
- CSS (`build-css.mjs`): next/font variables are re-declared on `:root` against a Google
  Fonts `@import`; `'Noto Sans/Serif SC Variable'` (fontsource names) are rewritten to the
  Google family names; `url("/v2/…")` assets are inlined as data URIs; the one local
  font (SoulLedgerGlyphs) is copied next to the CSS so extractFonts ships it. (LXGW Seal,
  UnifrakturMaguntia, GFS Didot were dropped 2026-10-03 with v2's seal; the web ships none of them.)
  `@source "../../.design-sync/previews"` makes classes used only in previews exist.
- `SoulLedgerProvider` (in entry.tsx) = I18n + Theme + Tenant + Toast, plus two
  stand-ins: `pathname` (feeds Next's `PathnameContext`, since there is no router) and
  `civ` (fakes a signed-in tenant so Seal / plaque colour / plaque fonts appear).
  `civ` must not persist: TenantContext.setUser caches to localStorage
  (`soulledger_user`), which leaked one cell's civilization into the next render — the
  provider removes the key right after. It also scopes `data-civ` on a
  `display: contents` wrapper, because TenantProvider writes `data-civ` on `<html>`
  (one value per document) and a multi-cell card showed one skin for all cells.
- Grouping: srcDir-derived groups were all `general`; `docsMap` points components at
  one-line `groups/<group>.md` stubs (`category:` only) to regroup them.
- `guidelinesGlob` is pinned to `../../DESIGN.md`. The default globbed `docs/*.md`
  from the repo root — 58 local, mostly gitignored audit files. Keep it pinned.

## Known render warns (triaged, benign)

- `[RENDER_THIN] ConfirmDialog: rendered height is 0px` — portal, same as BaseModal; the single-card capture is complete.

- `[RENDER_THIN] GlobalNav / BaseModal / Drawer: rendered height is 0px` — BaseModal and
  Drawer render in a portal; GlobalNav's preview root is the provider's
  `display: contents` wrapper. Screenshots are complete.
- `[RENDER_THIN] TextAreaField, PageShell, ThemeToggle` — floor-card components (no
  authored preview); ThemeToggle is an icon-only button.
- `[TOKENS_MISSING] --anchor-width, --x, --color-foo, --color-ink-nope, --color-surface,
  --color-surface-9, --color-civ-mark-cn` — Tailwind's auto source scan picks up class
  strings in test files and runtime-set vars (`--anchor-width` from Base UI). Not real
  tokens.
- Skeleton components render invisible for 400 ms (`SKELETON_DELAY_MS`) by design;
  a capture taken earlier is blank.

- `DataTable` is `cardMode: column` (2026-10-03): after the v3 header / sticky change its
  Default story ran wider than a grid cell (`[GRID_OVERFLOW]`).

- Authored previews (2026-10-03 wave): the §4.6 display components and statuses.
  - DomainEnum shows a mono `title=RAW` hint column: screenshots can't show `title`, and the
    design agent must learn that the raw member goes in `title`, never in the text.
  - The generated `.d.ts` types Domain* `value` as `string`/`number` (null branch lost); previews
    pass `null as unknown as string` for the missing path. The source accepts null.
  - Status badges follow v3: glyph + text, neutral by default; StatusBadge tones are copied from
    the pages' `STATUS_TONES` maps (only PARTIAL warning, FAILED error).
  - ConfirmDialog is `cardMode: single` 720x520 like BaseModal; it opens with focus on 取消 (Base UI
    AlertDialog initial focus — real, not a defect).
  - Pagination's disabled ink is faint at sheet scale — the real style.
- `build-css.mjs` re-attaches `/* @kind … */` comments (Tailwind strips all comments) from
  globals.css's `--token: v; /* @kind x */` lines, and drops Tailwind's internal
  `--tw-space-y-reverse` / `--tw-divide-y-reverse` declarations — Design's token check flagged
  both (2026-10-03). Write a new token's kind on the same line as its declaration.
  It also tags every `--tw-*` declaration `@kind other` by prefix (they live in utility classes and
  ARE the utility — never strip them), moves the brand pair into the top `:root` (the token scan
  ignores the late `:root`), and tags four Tailwind theme defaults (animate-spin/pulse,
  default-transition-*) that have no line in globals.css.

- `build-css: @kind tokens not in compiled output: --ease-drop, --transition-duration-slow,
  --transition-duration-ritual` (first seen 2026-10-10). The three motion tokens are declared in
  globals.css with a kind but no class uses them yet, so Tailwind leaves them out of the compiled
  CSS. Informational: nothing to fix until a component uses them, and then the line goes away.

- Authored previews (2026-10-10 wave): the 12 that were still on the floor card, plus 15 components
  added to the entry that day (BrandMark, Collapse, IconPicker, ToastContainer, DataGrid, FilterBar,
  ActionsMenu, EnumBadge, TablePageSkeleton, CardListPageSkeleton, GlobalSearch, LogoutConfirmDialog,
  MfaRequiredBanner, ConnectionStatus, ConnectionBanner). 55 components in all.
  - The provider gained three things for them: a no-op `AppRouterContext` and an offline
    `QueryClient` (GlobalSearch calls `useRouter()` / `useQuery()`; a search finds nothing), and a
    `mfaRequired` prop that marks the faked user as needing two-step sign-in (MfaRequiredBanner).
  - Not added: MenuGloss (its content comes from the menus API) and RouteProgress (a bar that only
    exists during a route change).
  - BottomBar is `position: fixed` and hidden from 769 px up: `cardMode: single`, viewport 390x300.
  - ConnectionStatus / ConnectionBanner can only show `disconnected` (no WebSocket provider here).
  - GlobalSearch, ActionsMenu and FilterBar show the closed control only; their popups need interaction.
  - ToastContainer itself returns null: the preview fires `showToast(…, 600000)` in an effect.
  - SearchSelectField shows the controlled `searchText`, not the selected label; a "selected" cell
    passes `searchText` equal to the label.
  - Spinner's label is visually hidden, so PageSpinner has one cell.
  - DataGrid has no Loading cell: its skeleton rows captured ragged.
  - Groups for the new ones follow their source folder where it is specific (`brand`, `data-grid`,
    `layout`) even though `docsMap` names another group; left as is.

- `[RENDER_BLANK] BottomBar` (2026-10-10): the validate screenshot is taken at desktop width, where the
  bar is hidden by its own `min-[769px]:hidden`. The per-cell capture (narrow) shows it; the card is
  `cardMode: single` at 420x180 and the preview frames it in a transformed 390 px box.
- `[RENDER_THIN]` on ConnectionBanner, ConnectionStatus, GlobalSearch, LogoutConfirmDialog,
  MfaRequiredBanner: fixed / portal / `display: contents` roots measure 0 px; the sheets are complete.

## Re-sync risks

- Bundle is ~4.7 MB: lucide-react whole (~1.6 MB, GlobalNav resolves icon names from
  data at runtime), zod (~0.7 MB, via core validations), three locale JSONs.
- The Google Fonts request needs network at render time; offline designs fall back.
  `GOOGLE_FAMILIES` in build-css.mjs mirrors `app/fonts.ts` and
  `plaque/fonts.ts` by hand — a font change there must be repeated here.
- `entry.tsx` export list is hand-maintained; a renamed/removed component breaks the
  build loudly, but a NEW base component is silently absent until added here and to
  `componentSrcMap` (pinned paths, also hand-maintained).
- `SignedInAs` fakes an AuthUser with `as never`; if AuthUser gains a required field the
  provider still compiles. The `PathnameContext` import reaches into
  `next/dist/shared/lib/…` — a Next upgrade can move it.
- Floor-card components still show placeholder content in the DS pane (e.g. DomainEnum
  renders 未识别取值, Pagination 第 0 / 0 页). Authoring their previews is the next step.
