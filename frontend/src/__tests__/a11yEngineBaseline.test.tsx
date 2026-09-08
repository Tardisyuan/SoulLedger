/**
 * axe over the shared UI, with a per-subject budget that can only go down.
 *
 * READ `support/axeHarness.tsx` FIRST — it carries the two facts that decide
 * whether anything here means anything (colour rules are off under jsdom, and
 * an engine that renders nothing reports zero violations).
 *
 * WHY A BUDGET AND NOT ZERO — AND THE MEASUREMENT THAT NEARLY MADE THE BUDGET
 * UNNECESSARY. The first run of these 29 subjects scored **one** violation
 * node: `region` on the portaled `ActionsMenu` panel, which is a rule boundary
 * rather than a defect (the reasoning is on that subject, and it is the whole
 * of `axe-baseline.json`). Nothing else fired. That was not the expected
 * result and it is the most useful number in this file, so it is at the top
 * rather than buried: as of this pass, and under the rules this engine can run
 * (see the colour caveat in the harness), the shared UI is clean.
 *
 * A zero-violations gate with one inline exemption would therefore also work
 * today. The budget shape is here anyway, for two reasons. An exemption says
 * "ignore this rule here" and never expires; a budget of 1 says "one node,
 * this many, no more" and goes red if a second appears. And the subject set
 * will grow — the next batch of routes will not come back at zero, and a gate
 * that has to be redesigned the first time it finds something is a gate that
 * gets switched off instead.
 *
 * The shape is copied from `eslint.design-guard-baseline.json`, including the
 * half that matters: **under budget is also a failure**. A baseline that only
 * catches regressions rots into a floor. `hits < budget` here means someone
 * fixed something and did not collect the ratchet, and the test says so with
 * the exact line to delete.
 *
 * NO REGENERATE SWITCH, deliberately. There is no `--update-baseline` flag and
 * no env var that rewrites the JSON, because a one-keystroke way to make this
 * green is a one-keystroke way to delete it. The failure message prints the
 * exact JSON fragment; pasting it is a decision someone makes with their hands.
 *
 * ── PROVEN TO GO RED ───────────────────────────────────────────────────────
 *
 * Six mutations, each applied to the real source, run, and reverted. The
 * measured baseline is ONE violation node across 29 subjects, which is the
 * kind of number that has to be earned rather than announced.
 *
 *   defect injected                                     result
 *   ─────────────────────────────────────────────────── ──────────────────────
 *   Field.tsx: drop `htmlFor` from the <label>          RED — 8 nodes over 3
 *                                                       subjects: label ×4
 *                                                       (critical),
 *                                                       label-title-only ×3,
 *                                                       select-name ×1
 *   PermissionMatrixTable.tsx: rename the cell          RED — button-name ×4
 *     checkbox's `aria-label` to a data attribute       (critical)
 *   notifications/page.tsx: row heading h2 -> h4        RED — heading-order ×1
 *   axeHarness: runOnly tag -> "wcag-nonesuch"          RED twice, and this is
 *                                                       the pair that matters:
 *                                                       the rule-count floor
 *                                                       ("Expected > 30,
 *                                                       Received 0") AND the
 *                                                       baseline going stale.
 *                                                       An engine that stops
 *                                                       running is caught from
 *                                                       two directions.
 *   a subject rendered as an empty fragment             RED — the rendered-DOM
 *                                                       floor names it
 *   a budget entry for a rule that no longer fires      RED — "BASELINE STALE
 *                                                       … lower or delete"
 *
 * AND ONE THAT DID **NOT** GO RED, which is the more useful entry.
 *
 * Deleting `aria-label={menuLabel}` from `ActionsMenu`'s "⋯" trigger — a real
 * defect, and the exact shape of "icon button loses its name" — leaves this
 * suite at **exit 0**. axe is right by its own rules: the button's text
 * content is the ellipsis character, which is a non-empty accessible name, so
 * `button-name` passes. eslint-plugin-jsx-a11y does not catch it either
 * (`anchor-has-content` and friends look for empty content, and "⋯" is
 * content). The only thing standing between that attribute and its deletion is
 * a hand-written assertion.
 *
 * So: this engine does not replace the 166 hand-written `aria-`/`role=`
 * assertions in this directory, and the first draft of that claim was wrong.
 * It covers the half they cannot — id references, role nesting, heading
 * outlines, names computed across a rendered tree — and there is a half it
 * cannot cover in return.
 *
 * (The first attempt at that mutation went red for the wrong reason: this
 * file's `clickButton` was selecting the trigger BY `aria-label`, so removing
 * the attribute broke the harness before axe ran. A red that comes from the
 * test rather than from the subject reads exactly like a passing proof. The
 * selector now uses the glyph.)
 *
 * ── ON THE LENGTH OF THIS FILE ─────────────────────────────────────────────
 *
 * ~700 lines of code, most of it the `SUBJECTS` table. The question CLAUDE.md
 * asks at that size — does this file do two things? — was asked, and the
 * answer taken was no. The subjects ARE the test. `axe-baseline.json` records
 * a budget per subject and the reason that budget exists is a doc comment on
 * the subject; moving the table to `support/` would put the justification for
 * a baseline line one import away from the gate that enforces it, and would
 * make the whole thing depend on ts-jest hoisting the `jest.mock` calls above
 * an import of another module — true today, and a subtle order dependency to
 * inherit. Growing the subject list is what this file is for; if a second
 * *kind* of thing ever lands here, that is when it splits.
 */
import { render, fireEvent, act, waitFor, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { audit, DISABLED_RULES } from "./support/axeHarness";

// `t` returns the key. Every subject below therefore has non-empty text
// wherever a translated string goes, which is what axe needs to judge an
// accessible name — and is NOT evidence that the real bundles are non-empty.
// That is `messageValuesAreNotTheirOwnKeys.test.ts` and
// `notifyKeysExistInTheBundles.test.ts`'s job, and they already do it.
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: jest.fn(),
    hydrated: true,
    formatDate: (v: unknown) => `d(${String(v)})`,
    formatDateTime: (v: unknown) => `dt(${String(v)})`,
    formatNumber: (v: unknown) => String(v),
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// The three page subjects at the bottom of the list. Everything they reach for
// that crosses the network or the tenant boundary is stubbed here; the DOM they
// build from it is the thing under audit.
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  notificationsApi: { list: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn() },
  auditApi: { list: jest.fn() },
  ledgerApi: { statsOverview: jest.fn() },
  menusApi: { all: jest.fn(), list: jest.fn() },
}));

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn(), setTheme: jest.fn() }),
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    isAdmin: true,
    user: { role: "ADMIN", permissions: ["audit.read"], username: "admin" },
    tenant: { id: 1, name: "Diyu", code: "cn" },
  }),
}));

import { Button } from "@/src/components/ui/Button";
import { Badge, BADGE_TONES } from "@/src/components/ui/Badge";
import { TextField, SelectField, TextAreaField } from "@/src/components/ui/Field";
import { SearchSelectField } from "@/src/components/ui/SearchSelectField";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { PageError, QueryError } from "@/src/components/ui/PageError";
import { PageShell } from "@/src/components/ui/PageShell";
import { Pagination } from "@/src/components/ui/Pagination";
import { Spinner, PageSpinner } from "@/src/components/ui/Spinner";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { IconPicker } from "@/src/components/ui/IconPicker";
import {
  MissingValue,
  DomainEnum,
  DomainNumber,
  IdentifierChip,
  DomainText,
} from "@/src/components/ui/DomainValue";
import { showToast } from "@/src/components/ui/Toast";
import { DataTable } from "@/components/ui/data-table";
import { DataGrid, FilterBar, ActionsMenu, type DataGridColumn } from "@/components/ui/data-grid";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SettingsDrawer } from "@/src/components/settings/SettingsDrawer";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";
import { RoleFormModal } from "@/src/components/permissions/RoleFormModal";
import { PermissionMatrixTable } from "@/src/components/permissions/PermissionMatrixTable";
import type { Permission, Role } from "@soulledger/core/api";
import NotificationsPage from "@/app/notifications/page";
import AuditPage from "@/app/audit/page";
import WelcomePage from "@/app/welcome/page";
import { notificationsApi, auditApi, ledgerApi, menusApi } from "@soulledger/core/api";

// ── Subjects ────────────────────────────────────────────────────────────────

interface Subject {
  /** Baseline key. Stable — renaming one silently retires its budget. */
  id: string;
  ui: () => ReactElement;
  /**
   * Drive the rendered UI into the state worth auditing. Popups are the whole
   * reason this exists: a closed `ActionsMenu` is a single button, and every
   * rule about `role="menu"` needs the panel on screen.
   */
  open?: () => void;
  /**
   * Wait for the subject to finish arriving before auditing it.
   *
   * Page subjects fetch. Auditing one before its query resolves audits the
   * skeleton — which is a real state worth checking, but it is not the state
   * the subject is named after, and the difference does not surface as an
   * error. It surfaces as a suspiciously clean score.
   */
  ready?: () => Promise<void>;
  /** Page subjects need a QueryClientProvider; components do not. */
  needsQueryClient?: boolean;
}

interface Row {
  id: string;
  name: string;
  state: string;
  merit: number;
}

const MATRIX_PERMS: Permission[] = [
  { id: 1, codename: "ledger.read", name: "Read ledger", category: "ledger" },
  { id: 2, codename: "ledger.write", name: "Write ledger", category: "ledger" },
];

const MATRIX_ROLES = ["ADMIN", "JUDGE"];

const MATRIX_ROLE_META: Record<string, Role> = {
  ADMIN: {
    id: 1,
    name: "ADMIN",
    display_name: "Administrator",
    scope: "GLOBAL",
    organization: null,
    organization_name: null,
  } as Role,
  JUDGE: {
    id: 2,
    name: "JUDGE",
    display_name: "Judge",
    scope: "GLOBAL",
    organization: null,
    organization_name: null,
  } as Role,
};

const ROWS: Row[] = [
  { id: "SL-0001", name: "孟婆", state: "ALIVE", merit: 12 },
  { id: "SL-0002", name: "判官", state: "JUDGED", merit: -3 },
];

const GRID_COLUMNS: DataGridColumn<Row>[] = [
  { key: "id", header: "grid.id", type: "identifier", value: (r) => r.id, width: "16ch" },
  { key: "name", header: "grid.name", type: "text", value: (r) => r.name, sortable: true },
  {
    key: "state",
    header: "grid.state",
    type: "enum",
    value: (r) => ({ tone: r.state === "ALIVE" ? "success" : "neutral", label: r.state }),
  },
  { key: "merit", header: "grid.merit", type: "numeric", value: (r) => r.merit },
  {
    key: "actions",
    header: "grid.actions",
    type: "actions",
    menuLabel: "grid.actions.menu",
    primary: () => ({ label: "grid.actions.view", onSelect: () => {} }),
    items: () => [{ key: "delete", label: "grid.actions.delete", onSelect: () => {}, tone: "danger" }],
  },
];

/**
 * Click the first button matching `text` — how every popup subject here opens.
 *
 * Searches `document.body` rather than the RTL container, for the same reason
 * the audit does: `ActionsMenu` portals its trigger's panel out, and a
 * container-scoped search would miss half of what these subjects are for.
 */
function clickButton(text: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").includes(text) || b.getAttribute("aria-label") === text,
  );
  if (!button) throw new Error(`no button matching ${text} — subject cannot reach its open state`);
  act(() => {
    fireEvent.click(button);
  });
}

const SUBJECTS: Subject[] = [
  {
    id: "ui/Button",
    ui: () => (
      <div>
        <Button variant="primary">button.save</Button>
        <Button variant="secondary" size="sm">button.cancel</Button>
        <Button variant="danger" loading>button.delete</Button>
        <Button variant="ghost" disabled>button.disabled</Button>
        {/* Icon-only. The shape most likely to lose its name. */}
        <Button variant="ghost" aria-label="button.close">×</Button>
      </div>
    ),
  },
  {
    id: "ui/Badge",
    ui: () => (
      <div>
        {BADGE_TONES.map((tone) => (
          <Badge key={tone} tone={tone}>badge.{tone}</Badge>
        ))}
      </div>
    ),
  },
  {
    id: "ui/Field",
    ui: () => (
      <form>
        <TextField label="field.name" description="field.name.help" required />
        <TextField label="field.email" error="field.email.error" description="field.email.help" />
        <SelectField
          label="field.realm"
          options={[
            { value: "cn", label: "field.realm.cn" },
            { value: "eu", label: "field.realm.eu" },
          ]}
        />
        <TextAreaField label="field.notes" description="field.notes.help" />
      </form>
    ),
  },
  {
    id: "ui/SearchSelectField",
    ui: () => (
      <SearchSelectField
        id="ssf"
        name="ssf"
        label="ssf.label"
        description="ssf.help"
        value=""
        onValueChange={() => {}}
        options={[{ value: "a", label: "ssf.a" }, { value: "b", label: "ssf.b" }]}
        searchText=""
        onSearchTextChange={() => {}}
        loadingText="ssf.loading"
        emptyText="ssf.empty"
        moreText="ssf.more"
      />
    ),
  },
  {
    id: "ui/EmptyState",
    ui: () => (
      <EmptyState
        title="empty.title"
        reason="empty.reason"
        action={<Button variant="secondary">empty.action</Button>}
      />
    ),
  },
  {
    id: "ui/PageError",
    ui: () => (
      <div>
        <PageError error={new Error("boom")} reset={() => {}} />
        <QueryError onRetry={() => {}} detail="error.detail" />
      </div>
    ),
  },
  {
    id: "ui/PageShell",
    ui: () => (
      <PageShell
        title="shell.title"
        eyebrow="shell.eyebrow"
        subtitle="shell.subtitle"
        actions={<Button>shell.action</Button>}
        filters={<div>shell.filters</div>}
        pagination={{
          count: "shell.count",
          controls: <Pagination page={1} totalPages={3} count={42} onPageChange={() => {}} />,
        }}
      >
        <p>shell.body</p>
      </PageShell>
    ),
  },
  {
    id: "ui/Pagination",
    ui: () => <Pagination page={2} totalPages={7} count={133} onPageChange={() => {}} />,
  },
  {
    id: "ui/Spinner",
    ui: () => (
      <div>
        <Spinner label="spinner.label" />
        <PageSpinner label="spinner.page" />
      </div>
    ),
  },
  {
    id: "ui/Modal.BaseModal",
    ui: () => (
      <BaseModal isOpen onClose={() => {}} title="modal.title" footer={<Button>modal.ok</Button>}>
        <TextField label="modal.field" />
      </BaseModal>
    ),
  },
  {
    id: "ui/Modal.ConfirmDialog",
    ui: () => (
      <ConfirmDialog
        isOpen
        title="confirm.title"
        message="confirm.message"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    ),
  },
  {
    id: "ui/IconPicker",
    ui: () => <IconPicker value="Home" onChange={() => {}} />,
  },
  {
    id: "ui/DomainValue",
    ui: () => (
      <dl>
        <dt>dv.missing</dt>
        <dd><MissingValue kind="unrecorded" reason="dv.reason" /></dd>
        <dt>dv.enum</dt>
        <dd><DomainEnum namespace="soul.state" value="ALIVE" /></dd>
        <dt>dv.number</dt>
        <dd><DomainNumber value={42} /></dd>
        <dt>dv.identifier</dt>
        <dd><IdentifierChip id="SL-0001" /></dd>
        <dt>dv.text</dt>
        <dd><DomainText value="dv.text.value" /></dd>
      </dl>
    ),
  },
  {
    id: "ui/Toast",
    ui: () => <div />,
    open: () => {
      act(() => {
        showToast("toast.saved", "success");
        showToast("toast.failed", "error");
      });
    },
  },
  {
    id: "ui/DataTable",
    ui: () => (
      <DataTable
        caption="table.caption"
        columns={[
          { key: "id", header: "table.id" },
          { key: "name", header: "table.name", sortable: true },
          { key: "actions", header: "table.actions", srOnlyHeader: true, align: "right" },
        ]}
        data={ROWS}
        keyExtractor={(r: Row) => r.id}
        renderRow={(r: Row) => (
          <>
            <td>{r.id}</td>
            <td>{r.name}</td>
            <td><Button variant="ghost" size="sm">table.view</Button></td>
          </>
        )}
        sort={{ key: "name", direction: "asc" }}
        onSortChange={() => {}}
        page={1}
        totalPages={3}
        totalCount={42}
        onPageChange={() => {}}
      />
    ),
  },
  {
    id: "ui/DataGrid",
    ui: () => (
      <DataGrid
        caption="grid.caption"
        columns={GRID_COLUMNS}
        data={ROWS}
        keyExtractor={(r: Row) => r.id}
        sort={{ key: "name", direction: "asc" }}
        onSortChange={() => {}}
        page={1}
        totalPages={3}
        totalCount={42}
        onPageChange={() => {}}
        selection={{
          selectedIds: new Set<string>(["SL-0001"]),
          getId: (r: Row) => r.id,
          onToggleRow: () => {},
          onToggleAllVisible: () => {},
          onClear: () => {},
          getRowAriaLabel: (r: Row) => `grid.select.${r.name}`,
          labels: {
            selectedCount: (n: number) => `grid.selected.${n}`,
            clearSelection: "grid.clearSelection",
            selectAllLabel: "grid.selectAll",
          },
        }}
      />
    ),
  },
  {
    id: "ui/DataGrid.emptyAndError",
    ui: () => (
      <div>
        <DataGrid
          caption="grid.empty.caption"
          columns={GRID_COLUMNS}
          data={[]}
          keyExtractor={(r: Row) => r.id}
          emptyMessage="grid.empty"
        />
        <DataGrid
          caption="grid.error.caption"
          columns={GRID_COLUMNS}
          isError
          onRetry={() => {}}
          errorMessage="grid.error"
          keyExtractor={(r: Row) => r.id}
        />
        <DataGrid
          caption="grid.loading.caption"
          columns={GRID_COLUMNS}
          isLoading
          keyExtractor={(r: Row) => r.id}
        />
      </div>
    ),
  },
  {
    /**
     * THE ONE BASELINE ENTRY: `region: 1`. Read this before lowering it.
     *
     * The open panel is portaled to `document.body` — outside the `<main>`
     * every other subject here sits in, and outside it in the real app too —
     * so axe's `region` rule ("all page content should be contained by
     * landmarks") counts it. The portal is not incidental: the comment at
     * `ActionsMenu.tsx:25-31` records why it exists, which is that the grid's
     * horizontal scroll container clips `overflow-y` as well and would cut the
     * menu off for any row near the table's edge.
     *
     * NOT FIXED, and the reason is that the two available fixes are both worse
     * than the finding. Portaling into `document.querySelector("main")`
     * instead would satisfy the rule and would couple a data-grid primitive to
     * a page's landmark structure it has no business knowing. Giving the panel
     * a landmark role of its own would be a false claim about what it is.
     *
     * The evidence that this is a rule boundary rather than a defect is one
     * subject above: `ui/Modal.BaseModal` portals to `document.body` in
     * exactly the same way and does NOT trip `region`, because axe exempts
     * `role="dialog"` and does not exempt `role="menu"`. The panel already has
     * `role="menu"`, `aria-label`, roving arrow keys and focus on open
     * (`useRovingPopupKeys`), which is how a screen-reader user reaches it —
     * landmark navigation is not the route to a menu that opens under focus.
     *
     * If someone decides landmark containment wins, the fix is the
     * `querySelector("main")` portal target and this line goes to zero.
     */
    id: "ui/ActionsMenu.open",
    ui: () => (
      <ActionsMenu
        menuLabel="menu.label"
        primary={{ label: "menu.primary", onSelect: () => {} }}
        items={[
          { key: "edit", label: "menu.edit", onSelect: () => {} },
          { key: "delete", label: "menu.delete", onSelect: () => {}, tone: "danger" },
        ]}
      />
    ),
    // Opened by the trigger's visible glyph, NOT by `menu.label`. Selecting it
    // by accessible name makes the harness depend on the one attribute this
    // subject exists to watch: with `aria-label={menuLabel}` deleted from
    // ActionsMenu.tsx the run went red with "no button matching menu.label",
    // thrown from `clickButton` before axe had run at all. Red about the test
    // rather than about the component is the wrong red — it would have been
    // read as proof the engine catches a missing button name, and it is not.
    open: () => clickButton("\u22ef"),
  },
  {
    id: "ui/FilterBar",
    ui: () => (
      <FilterBar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder="filter.search"
        chips={[
          {
            key: "state",
            label: "filter.state",
            value: "",
            options: [
              { value: "ALIVE", label: "filter.alive" },
              { value: "JUDGED", label: "filter.judged" },
            ],
            onChange: () => {},
          },
        ]}
        isFiltered
        onClearAll={() => {}}
        clearAllLabel="filter.clear"
        density={{ compact: false, onToggle: () => {}, label: "filter.density" }}
      />
    ),
  },
  {
    id: "ui/FilterBar.chipOpen",
    ui: () => (
      <FilterBar
        chips={[
          {
            key: "state",
            label: "filter.state",
            value: "",
            options: [
              { value: "ALIVE", label: "filter.alive" },
              { value: "JUDGED", label: "filter.judged" },
            ],
            onChange: () => {},
          },
        ]}
        isFiltered={false}
        onClearAll={() => {}}
        clearAllLabel="filter.clear"
      />
    ),
    open: () => clickButton("filter.state"),
  },
  {
    id: "ui/skeleton",
    ui: () => (
      <PageSection title="section.title" actions={<Button variant="ghost" size="sm">section.action</Button>}>
        {/* `<table><tbody>`, because `TableSkeleton` returns bare `<tr>`s —
            "使用 tr/td 以便在 tbody 中使用", skeleton.tsx:72. Rendering it into
            a `<div>` (which is what this subject did first) makes React log
            `validateDOMNesting: <tr> cannot appear as a child of <div>` and
            hands axe a tree the app never produces. An audit of an invalid
            tree is not an audit of this component. */}
        <table>
          <caption>section.table</caption>
          <tbody>
            <TableSkeleton rows={3} cols={4} />
          </tbody>
        </table>
      </PageSection>
    ),
  },
  {
    id: "LanguageSwitcher",
    ui: () => <LanguageSwitcher />,
  },

  // ── Hand-rolled surfaces ──────────────────────────────────────────────────
  //
  // Everything above is either a primitive with a test file of its own or a
  // Base UI component whose accessibility is the library's. These four are
  // neither: a drawer, two form dialogs that build their own error wiring, and
  // a matrix table with a checkbox per cell. They are where a repo's a11y
  // usually goes wrong, and none of them was in the first pass.
  {
    id: "settings/SettingsDrawer",
    ui: () => (
      <SettingsDrawer open onClose={() => {}} navMode="classic" onNavModeChange={() => {}} />
    ),
  },
  {
    id: "permissions/PermissionFormModal",
    ui: () => (
      <PermissionFormModal
        isOpen
        onClose={() => {}}
        onSubmit={() => {}}
        isPending={false}
        // The rejected-submit state, not the pristine one. The form-level
        // `role="alert"` and the focus target it owns only exist here.
        error="permissions.codename_taken"
        title="permissions.new"
        existingCategories={["ledger", "souls"]}
      />
    ),
  },
  {
    id: "permissions/RoleFormModal",
    ui: () => (
      <RoleFormModal
        isOpen
        onClose={() => {}}
        onSubmit={() => {}}
        isPending={false}
        error="permissions.name_taken"
        title="permissions.role.new"
      />
    ),
  },
  {
    id: "permissions/PermissionMatrixTable",
    ui: () => (
      <PermissionMatrixTable
        matrixReady
        roleNames={MATRIX_ROLES}
        roleMeta={MATRIX_ROLE_META}
        categories={[{ category: "ledger", perms: MATRIX_PERMS }]}
        allPerms={MATRIX_PERMS}
        checked={{ ADMIN: new Set([1]), JUDGE: new Set<number>() }}
        isSaving={false}
        isVisible={() => true}
        onToggle={() => {}}
        categoryTally={() => "1/2"}
      />
    ),
  },

  // ── Whole routes ──────────────────────────────────────────────────────────
  //
  // The component subjects above scored one violation between them, which is a
  // real result and also a narrow one: a primitive is the easiest thing in a
  // codebase to get right, because it is small and it has a test file of its
  // own. What a component-level audit cannot see is composition — two ids
  // colliding because two components generated the same one, a heading level
  // that only skips once a page assembles them, a control whose label ends up
  // somewhere else. These three routes are where that gets checked.
  {
    id: "page/notifications",
    needsQueryClient: true,
    ui: () => <NotificationsPage />,
    ready: async () => {
      await waitFor(() => expect(document.body.textContent).toContain("Verdict ready"));
    },
  },
  {
    id: "page/audit",
    needsQueryClient: true,
    ui: () => <AuditPage />,
    ready: async () => {
      await waitFor(() => expect(document.body.textContent).toContain("created a soul"));
    },
  },
  {
    id: "page/welcome",
    needsQueryClient: true,
    ui: () => <WelcomePage />,
    ready: async () => {
      // BOTH effects, not either. This page fires two independent fetches —
      // `ledgerApi.statsOverview` for the stat tiles and `auditApi.list` for
      // the activity panel — and waiting on one leaves the other's `setState`
      // to land after the audit, outside `act`. `querySelector("h1")` was the
      // first attempt and is worse still: the heading is on screen before
      // either fetch resolves, so the subject audited the loading screen while
      // being named for the loaded one. React logged the act warning twice,
      // once per effect; that count is how the second one was found.
      await waitFor(() => {
        expect(document.body.textContent).toContain("created a soul");
        expect(document.body.textContent).toContain("4242");
      });
    },
  },
];

// ── Baseline ────────────────────────────────────────────────────────────────

const BASELINE_FILE = "axe-baseline.json";
const ROOT = path.join(__dirname, "..", "..");
const BASELINE: Record<string, Record<string, number>> = JSON.parse(
  fs.readFileSync(path.join(ROOT, BASELINE_FILE), "utf8"),
);

/**
 * Every rule axe evaluated across every subject, accumulated while the subjects
 * run so the pins below have something real to check.
 */
const evaluatedRules = new Set<string>();
const measured: Record<string, Record<string, number>> = {};
const details: Record<string, string[]> = {};
const rendered: Record<string, number> = {};

beforeAll(async () => {
  (notificationsApi.list as jest.Mock).mockResolvedValue({
    data: {
      results: [
        {
          id: 1,
          title: "Verdict ready",
          message: "Soul Meng judged",
          notification_type: "JUDGMENT_COMPLETED",
          is_read: false,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          title: "Workflow assigned",
          message: "A node awaits you",
          notification_type: "WORKFLOW_ASSIGNED",
          is_read: true,
          created_at: "2026-01-02T00:00:00Z",
        },
      ],
    },
  });
  (notificationsApi.markRead as jest.Mock).mockResolvedValue({});
  (notificationsApi.markAllRead as jest.Mock).mockResolvedValue({});
  (auditApi.list as jest.Mock).mockResolvedValue({
    data: {
      count: 1,
      results: [
        {
          id: 1,
          action: "CREATE",
          resource: "Soul",
          resource_id: "9",
          description: "created a soul",
          user: "admin",
          user_display: "admin",
          ip_address: "10.0.0.1",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
    },
  });
  // `total_souls` is a number no other part of this page can produce, so
  // `ready` below can wait on it and know which of the two effects it saw.
  (ledgerApi.statsOverview as jest.Mock).mockResolvedValue({
    data: {
      total_souls: 4242,
      state_distribution: [
        { state: "ALIVE", count: 11 },
        { state: "JUDGING", count: 12 },
        { state: "DISPOSED", count: 13 },
      ],
    },
  });
  (menusApi.all as jest.Mock).mockResolvedValue({ data: [] });
  (menusApi.list as jest.Mock).mockResolvedValue({ data: { results: [] } });

  for (const subject of SUBJECTS) {
    // Wrapped in `<main>`, because that is where every one of these
    // components actually renders: `AppLayout.tsx:290` puts the whole routed
    // tree inside one. Without it axe's `region` rule ("all page content
    // should be contained by landmarks") fired on 15 of the 22 subjects for a
    // total of 67 nodes — none of them a defect, all of them an artifact of
    // rendering a fragment at the document root. Deleting the rule instead was
    // the other option and is worse: `region` still has something to say here,
    // and it still says it. `ActionsMenu` portals its panel to `document.body`
    // — outside this `<main>`, exactly as it does in the app — so the rule
    // keeps watching the one case where it is reporting on real placement
    // rather than on the harness.
    const tree = <main>{subject.ui()}</main>;
    // PLAIN `render`, and `page/welcome` prints two React act warnings because
    // of it. Recorded rather than hidden, because both ways of silencing them
    // were tried and both **hang**: `await act(async () => {})` after the
    // render, and `await act(async () => { view = render(...) })` around it,
    // each ran `beforeAll` to jest's 180s timeout on that one subject and took
    // all 30 tests down. Cause not diagnosed — so this is an observation, not
    // an explanation.
    //
    // The warnings are about the window between `render` returning and
    // `waitFor` starting, in which WelcomePage's two mocked fetches resolve.
    // They do not affect what is audited: `ready` below does not return until
    // both effects' output is on screen, and the audit runs after that.
    const view: RenderResult = subject.needsQueryClient
      ? render(
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            {tree}
          </QueryClientProvider>,
        )
      : render(tree);
    try {
      if (subject.ready) await subject.ready();
      subject.open?.();
      // Element count taken BEFORE the audit, so a subject that rendered
      // nothing is caught by a test rather than by a clean score. A component
      // that returns null leaves RTL's wrapper and this `<main>` behind, axe
      // finds no violations in them, and the result is indistinguishable from
      // a component with nothing wrong.
      rendered[subject.id] = document.body.querySelectorAll("*").length;
      const result = await audit();
      measured[subject.id] = result.counts;
      details[subject.id] = result.detail;
      for (const rule of result.evaluated) evaluatedRules.add(rule);
    } finally {
      view.unmount();
      // The toast stack and Base UI's portals live on `document.body`, outside
      // anything RTL cleans up. Without this, subject N+1 audits subject N's
      // leftovers and the counts drift upward in list order — which reads
      // exactly like a real regression.
      document.body.innerHTML = "";
    }
  }
  // 60s: axe walks the whole document once per subject, and there are ~22.
}, 180_000);

describe("the engine is running, and running what we think it is", () => {
  it("evaluates a non-trivial number of rules", () => {
    // The guard for the guard. A subject list that renders nothing, or a
    // `runOnly` typo that matches no tag, both produce `violations: []` — the
    // same value as a clean pass.
    expect(evaluatedRules.size).toBeGreaterThan(30);
  });

  it("has colour rules off — and nothing else", () => {
    // jsdom computes no layout, so axe cannot judge contrast. `cat.color` is
    // the one exemption, and it is not ours to widen: a rule switched off to
    // turn a red run green would otherwise be indistinguishable from this.
    //
    // THE THIRD NAME IN THIS LIST IS A REAL GAP, not a formality.
    // `link-in-text-block` is the rule for "a link inside a paragraph is
    // distinguishable from the surrounding text by something other than
    // colour". axe files it under `cat.color` because deciding it needs
    // computed colours, so it goes off with the other two — and unlike
    // contrast, nothing else in this repo covers it. `inkOnSurfaceContract`
    // and `civilizationColourContract` check token *values*; neither knows
    // which of them ends up on an `<a>` inside a `<p>`. Written down because
    // the alternative is a reader assuming the list is boilerplate.
    expect(DISABLED_RULES).toEqual([
      "color-contrast",
      "color-contrast-enhanced",
      "link-in-text-block",
    ]);
    for (const rule of DISABLED_RULES) {
      expect(evaluatedRules.has(rule)).toBe(false);
    }
  });

  it("actually audited every subject, and each one rendered something", () => {
    const ids = SUBJECTS.map((s) => s.id);
    // Duplicate ids would silently share one budget and one measurement.
    expect(new Set(ids).size).toBe(ids.length);

    // A subject whose component renders `null` — or whose `ready` gave up
    // early — produces an empty tree, zero violations, and a green row. This
    // is the floor that separates "nothing wrong" from "nothing there". The
    // number is low on purpose: the smallest subject here (`LanguageSwitcher`)
    // renders single digits of elements, and a floor tuned to the largest
    // would be a second thing to maintain.
    const thin = ids.filter((id) => (rendered[id] ?? 0) < 5);
    expect(thin).toEqual([]);
  });
});

describe("axe over the shared UI", () => {
  it.each(SUBJECTS.map((s) => s.id))("%s stays within its budget", (id) => {
    const budget = BASELINE[id] ?? {};
    const hits = measured[id] ?? {};
    const rules = new Set([...Object.keys(budget), ...Object.keys(hits)]);

    const over: string[] = [];
    const under: string[] = [];
    for (const rule of rules) {
      const allowed = budget[rule] ?? 0;
      const actual = hits[rule] ?? 0;
      if (actual > allowed) over.push(`${rule}: ${actual} > ${allowed} allowed`);
      if (actual < allowed) under.push(`${rule}: ${actual} < ${allowed} budgeted`);
    }

    const report = [
      over.length ? `NEW VIOLATIONS in ${id}:\n  ${over.join("\n  ")}` : "",
      under.length
        ? `BASELINE STALE for ${id} — lower or delete these entries in ${BASELINE_FILE}:\n  ${under.join("\n  ")}`
        : "",
      over.length ? `\naxe detail:\n  ${(details[id] ?? []).join("\n  ")}` : "",
      over.length || under.length
        ? `\nmeasured: ${JSON.stringify({ [id]: hits })}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    expect(report).toBe("");
  });
});

describe("the baseline is a debt ledger, not a config file", () => {
  it("names only subjects that exist", () => {
    const ids = new Set(SUBJECTS.map((s) => s.id));
    expect(Object.keys(BASELINE).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("carries only positive integer budgets", () => {
    for (const [id, budgets] of Object.entries(BASELINE)) {
      for (const [rule, n] of Object.entries(budgets)) {
        expect({ id, rule, n }).toMatchObject({ n: expect.any(Number) });
        expect(n).toBeGreaterThan(0);
        expect(Number.isInteger(n)).toBe(true);
      }
    }
  });
});
