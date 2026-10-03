# SoulLedger v3 — how to build with this library

SoulLedger is a Chinese-first admin console for a cross-civilization "soul ledger"
(four civilizations: 中华 cn, 欧洲 eu, 埃及 eg, 希腊 gr). UI copy is Simplified Chinese.

## Wrap everything in `SoulLedgerProvider`

Every component reads i18n, theme, tenant and toast context. Without the provider,
labels fall back to raw keys and the Seal / civilization colour never appear.

```jsx
const { SoulLedgerProvider, Plaque, Button } = window.SoulLedger;
<SoulLedgerProvider civ="cn" pathname="/judgment">
  <Plaque title="审判台" meta="待审 12" />
  <Button variant="primary">落判</Button>
</SoulLedgerProvider>
```

- `civ`: `"cn" | "eu" | "eg" | "gr"` — the signed-in tenant's civilization. It sets the
  plaque colour (`--color-main`), the seal and the plaque fonts. Omit it for the
  pre-login neutral skin (no seal, ink-black plaque).
- `pathname`: the current route. `GlobalNav` highlights from it and `Breadcrumb` builds
  its trail from it (there is no router). Default `/dashboard`.
- Theme follows the OS (`.dark` / `.light` on `<html>`); `ThemeToggle` switches it.

## Styling idiom: Tailwind utilities + OKLCH colour tokens

Colour tokens hold raw OKLCH triplets, so always wrap them: `oklch(var(--color-ink))`,
in arbitrary-value classes (`text-[oklch(var(--color-ink-muted))]`,
`bg-[oklch(var(--color-surface-1))]`, `border-[oklch(var(--color-line))]`) or inline styles.
Only classes already present in `_ds_bundle.css` exist — there is no Tailwind compiler at
design time, so prefer inline `style` for anything unusual.

| Family | Names |
|---|---|
| Ink (text) | `--color-ink`, `--color-ink-muted`, `--color-ink-subtle`, `--color-ink-tertiary` |
| Surfaces | `--color-canvas`, `--color-surface-1` … `--color-surface-4` |
| Lines | `--color-line`, `--color-line-strong`, `--color-hairline`, `--color-rule` |
| Civilization | `--color-main` / `--color-on-main` (follows `civ`); `--color-civ-cn/eu/eg/gr` |
| Status | `--color-success`, `--color-warning`, `--color-danger`, `--color-danger-strong`, `--color-focus` |
| Domain state | `--color-status-judging`, `-disposed`, `-reincarnating`, `-settled`, `-lost`, `-alive`; `--color-verdict-passed/failed/purgatory/retry` |
| Type | `text-2xs text-xs text-sm text-md text-lg text-xl text-display`; `font-sans` (UI), `font-serif` (quoted words only), `font-mono` (numbers, IDs, dates) |
| Shape / motion | `rounded-control`, `rounded-panel`; `duration-fast duration-base`, `ease-standard ease-enter` |

House rules from the design spec: square badges, square-cornered buttons; one `primary`
button per screen (it is the only plaque-coloured control besides nav/plaque/seal);
numbers and dates in `font-mono tabular-nums`; serif only for things a person said.

## Where the truth lives

- `styles.css` → `_ds_bundle.css` (compiled `frontend/app/globals.css`) — every token.
- `guidelines/DESIGN.md` — the design-system rules (heading ladder, colour use).
- `components/<group>/<Name>/<Name>.prompt.md` and `.d.ts` — per-component API.

## Page skeleton

```jsx
<SoulLedgerProvider civ="cn" pathname="/souls">
  <div style={{ display: "flex", height: "100vh" }}>
    <GlobalNav menus={menus} allMenuPaths={paths} currentId={2} openId={null}
      onToggle={() => {}} collapsed={false} user={{ display_name: "崔判官", username: "cui", role: "JUDGE" }} />
    <main style={{ flex: 1, minWidth: 0, background: "oklch(var(--color-canvas))" }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", padding: "0 16px",
        borderBottom: "1px solid oklch(var(--color-line))" }}>
        <Breadcrumb menus={menus} />
      </div>
      <Plaque title="灵魂" />
      <div style={{ padding: 24 }}>
        <DataTable caption="灵魂名册" columns={cols} data={rows}
          keyExtractor={(r) => r.id} renderRow={(r) => <td className="px-3 py-2">{r.name}</td>} />
      </div>
    </main>
  </div>
</SoulLedgerProvider>
```

Menu items are `{ id, name, path, icon, children, menu_type? }`; `icon` is a lucide icon
name (`"Users"`, `"Scale"`); groups use `menu_type: "DIRECTORY"` with `path: ""`.
`DataTable.renderRow` returns `<td>` cells only. Badges for domain values:
`<SoulStateBadge state="JUDGING" />`, `<VerdictBadge verdict="passed" />`.
