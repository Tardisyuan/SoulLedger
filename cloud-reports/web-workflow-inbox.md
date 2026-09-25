# feat(web): 审批流编辑器按规范重做画布、殿司收件箱三栏

Branch `feat/web-workflow-inbox`, from `main` @ `638929e`. Design reference: `design/refs-2026-09`,
`web-third/…C_-_审批流_-_朋友圈审阅_-_殿司收件箱.dc.html` sections 03 and 09 (section 08 not touched),
plus `web-ledger/spec.txt`. Frontend only, on existing APIs.

Screenshots (chromium, route-mocked API, dark theme unless named):
`web-workflow-inbox/workflow-1440-dark.png`, `workflow-1440-light.png`, `workflow-393.png`,
`inbox-1440-dark.png`, `inbox-1440-light.png`, `inbox-393-dark.png`.

## Built

### /workflow 审批流编辑器
- **Nodes**: square boxes with a 1 px block border and no fill of their own (the five per-type border colours are gone). The header row is a mono glyph plus the raw `NodeType`, then `N{order}` on the right, or `!` when the node has issues. The name and `court · approver` lines follow. Condition-like nodes are square too.
- **Glyphs**: `▷ entry · □ step · ◇ branch · ■ end`. These are *derived* from the node's order and edges, because the model has no start/end/condition node kinds (see backend gaps):
  - ▷: `node_order` 1, where the engine starts.
  - ◇: the node has a FAIL route.
  - ■: the last node by order, with no PASS route.
  - □: everything else.
- **Selected node**: shows the focus ring (2 px `--color-focus`, square, offset 2).
- **Node with issues**: gets a danger border, a 3 px danger inset on the left and `!` in the header. The same marks appear in the linear preview.
- **Dragged node**: the one shadow on the canvas (`shadow-overlay`), per the spec's §2.9 exception.
- **Ports**: 7 px squares. The FAIL port has a dashed border.
- **Edges**: a new `route` edge type draws 1 px right-angle polylines in `--color-block`.
  - FAIL routes are dashed.
  - Branches are labelled 通过 / 否决 beside the vertical segment that drops into the target.
  - Plain chains carry no labels.
  - There are no arrowheads, so the colour is now a live token that follows theme switches. The old version was a per-theme literal read once, because it was drawn inside a `<marker>`.
- **Validation** (`workflowValidation.ts`) contains only rules the backend or engine actually acts on:
  - `name_empty`: the serializer returns 400.
  - `self_route`: the engine never follows it.
  - `duplicate_route`: `getTemplateNodes` keeps only the last edge per outcome, so the others vanish on save.
- **Toolbar**: shows 「! 校验 · N」 while any issue exists. Clicking it selects the first offending node and focuses the list. **保存模板 is disabled while validation fails**, and it carries `aria-describedby` pointing at the list.
- **Palette** (left, 「节点库 · 拖入」): lists the five `NodeType` members. Click or Enter appends a node; dragging one onto the canvas drops it where it lands (`screenToFlowPosition`). The palette is a single tab stop with roving arrow keys, so the Tab walk from the template-name field to the first card stays inside the existing ≤ 12 bound.
- **Inspector** (right):
  - Shows the selected node's name, type, court, approver type and role.
  - Shows where PASS and FAIL go, in the engine's own terms: the routed target, or the defaults ("next in order: N3…", "flow completes", "rejected; the flow ends").
  - Has an 编辑 · E button that opens the existing node modal.
  - Lists the validation issues; clicking one selects its node.
- **Linear preview** (bottom): the nodes in `node_order`. Branch nodes are shown in mono, nodes with issues in danger, and the end node dashed. Each chip is a button that selects its node.
- **Below 1024 px**: the page is read-only. It shows the notice 「画布只在 ≥ 1024 px 可编辑」, the template name and meta, the linear preview, and the inspector with validation. It has no xyflow canvas, no inputs and no save. `useWideViewport` was extracted from `AppLayout` so the shell and the editor share the same breakpoint.
- All existing behaviour is kept: auto-layout Flip travel and viewport fit, the `E` shortcut, save/load, priority, the error and loading guards.

### /soul-inbox 殿司收件箱
- **Three columns** (≥ 1024 px): folders | letter list | thread.
- **Folders** are only the ones the list API can answer:
  - 全部来信 (count is the server `count`).
  - 往来中 / 已关闭, from `closed_at`.
  - 按殿, per `hall_names`.
  - Counts for the derived folders are shown only when the first page is the whole inbox. Otherwise they would read as totals.
- **List rows**: name, hall, time (mono) and soul code (mono), plus a closed badge. The selected row gets the 3 px ink inset.
- **Thread**:
  - Letters and replies are set in serif; signatures and times in mono.
  - The newest letter is at quote size. The previous one steps down with a 2 px structure line and a 「前一封」 tag. Earlier ones fold behind 「更早的 N 封」.
  - 「待回复 · N 天」 appears when the newest message in the open thread is the soul's.
- **Reply box**: the serif QuoteInput styling. Typing `/` at the start of a line or after a space searches statutes (`/judgment/statutes/?search=`), and Enter or Tab writes `〔CODE · title〕` into the text. ↑↓ choose, Esc dismisses, ⌘/Ctrl+Enter sends. The search is only enabled with `judgment.read`; without it `/` is an ordinary character and no hint is shown.
- **At 393 px**: the folders become a `<select>` in the list header (44 px), and the thread stacks below the list with no horizontal overflow.

### i18n
New keys are in all three bundles: `workflow.editor.{role,branch,issues,issues_none,issue,palette,inspector,inspector_empty,unnamed,exit,preview,preview_empty,narrow_title,narrow_body}` and `soul_inbox.{folders,folder,by_hall,folder_empty,newest_first,from_soul,officer_reply,previous,earlier,awaiting,cite_hint,cite_label,cite_results,cite_empty}`. The egy strings use existing word forms only. The key set in `egyVocabulary.json` is unchanged; only its counts were regenerated (`EGY_VOCAB_WRITE=1`).

## Defects found and fixed on the way
1. **Loaded FAIL routes were saved as PASS.** `edgesFor` built edges without `sourceHandle`. Opening a routed template and saving it unchanged turned `on_pass→c, on_fail→b` into `on_pass→b, on_fail→null`. Fixed, and a regression test was added (`workflowRoutingRoundTrip.test.ts`).
2. **The canvas was painted with light tokens in the dark theme.** xyflow's default `colorMode="light"` adds a `.light` class to its root, and `globals.css` scopes the paper palette to any `.light`. The fix is `colorMode="dark"`: no token block matches that class, so the canvas inherits the theme from `<html>`.
3. **Selecting a second card cleared the selection.** `onNodesChangeHandler` read only the first `select` change, which is usually the old card's deselect. The card showed the focus ring while 删除选中 stayed disabled. Fixed. The new E2E test "Workflow editor selection" failed against the old handler (checked by reverting it).
4. **The canvas hint covered the first card.** It was a floating panel and swallowed clicks at 1280 px. It now sits under the palette.

## Skipped: backend gaps (not faked)
- **Node kinds.** `NodeType` is TRIAL / EVALUATION / APPEAL / FINAL / EXECUTION. Every node is an approval step. The design's `⧉ 会签` (countersign) and `✉ 通知` (notify) have no model, so they are neither drawn nor offered. ▷ / ◇ / ■ are derived roles, not stored kinds.
- **Conditions.** Routing is pass/fail only (`on_pass` / `on_fail`), with no expressions such as 「余额 < 0」. Branch labels are therefore 通过 / 否决.
- **Draft vs publish.** There are no template versions (草稿 v4 · 已发布 v3), no 存草稿 and no 发布. Saving is a direct PUT that is live at once. The design's 「发布」 gate is applied to **保存模板**, and the label is kept (it is also what the existing tests and E2E use).
- **Inspector 超时 / 转交上级 / 驳回到.** There are no timeout, escalation or reject-target fields on template nodes. The reject route is `on_fail`, shown as the 否决 exit.
- **审批人「按目标文明解析」.** Resolution happens server-side (`WorkflowService._resolve_approver`), but there is no endpoint to preview who a node resolves to.
- **Design rules 「没有出口」 / 「缺少审批人」.** Neither applies to this engine. An unrouted PASS goes to the next node by order, an unrouted FAIL ends the flow as rejected, and an empty role is filled from the court. The comment in `workflowValidation.ts` says so.
- **Inbox unread (6 px accent square).** There is no read state on `OfficerInbox`, so the mark is not rendered.
- **Inbox folders 待回复 / 已回复 / 草稿 / 归档.** The list payload has no last-sender field, and there are no drafts or archive. Derived folders are used instead; 「待回复」 is computed only on the open thread.
- **Subject lines and snippets.** Bodies live in Synapse and are fetched one thread at a time.
- **写信给灵魂** (an officer writing first), **转交**, **归档**, **回复模板**, **存草稿**: none of these have endpoints.
- **Statute citations in letters** are plain text in the body. There is no structured citation on a letter.
- **Pagination.** Only the first page of 20 is shown; this is unchanged from before.

## Deviations from the canvas, and why
- **Previous letter at 16 px, not 15.** The seven-step type scale has no 15, and the `type-scale` lint forbids arbitrary sizes. It uses `text-md font-normal`.
- **Composer at 20 px, not 17.** It uses `text-quote`, the same size as the judgment QuoteInput it reuses.
- **Node min-width 180, not 190.** This keeps the dagre fallback `NODE_WIDTH` and the tests that pin it in step.
- **The list header says 「最近在上」, not 「最早在上」.** That is the order the backend actually returns.
- **`WorkflowEditor.tsx` is about 690 code lines** (it was about 574 before this change). The three panels went to `WorkflowEditorPanels.tsx`. No further split was made for the line count, per `CLAUDE.md`.

## Existing tests changed (each deliberately)
- `workflowEdgeArrowSingleSource.test.ts`: it asserted the accent colour plus `markerEnd`, and now asserts the `--color-block` token, 1 px, the `route` type and no arrowhead. The single-source assertions are unchanged.
- `workflowAutoLayoutMotion.test.tsx`: its matchMedia stub answered every query `false`, which is a 393 px phone. It now answers `(min-width: 1024px)` true.
- `e2e/workflow.spec.ts` (the editor toolbar and keyboard describes) and `e2e/workflow-auto-layout-motion.spec.ts`: these now use `test.use({ viewport: 1280×720 })` on every project. On mobile-chrome's native 393 px the canvas no longer exists by design. The 393 px behaviour has its own new test.
- `eslint.design-guard-baseline.json`: the `WorkflowEditor.tsx` palette quota of 6 was removed. The raw red/green classes are gone, and the guard demanded that the quota drop.
- `egyVocabulary.json`: counts regenerated.

New tests:
- jest:
  - Validation gates the save, including the absence of a request.
  - The preview and inspector show the right node and exits.
  - The read-only view below 1024 px.
  - The routing round trip and the role and validation rules.
  - Inbox folders, including counts withheld on a partial page.
  - 待回复 present and absent.
  - Folding of earlier letters.
  - `/` citation, with and without `judgment.read`.
- E2E:
  - Selection moving between cards.
  - The 393 px read-only editor.
  - The inbox as three columns at 1280 and stacked at 393.
- Mutation-checked, each seen red and then restored:
  - Removing `sourceHandle` from loaded edges.
  - Removing the validation gate on save.
  - Making the 已关闭 folder include every letter and showing counts on a partial page.
  - The old selection handler.

## Gates (final tree)
All run on the committed tree at `494d888`, and each result is the command's exit code.

| gate | command | result |
|---|---|---|
| tsc | `cd frontend && npx tsc --noEmit` | exit 0 |
| lint | `cd frontend && npm run lint` (`--max-warnings 0`) | exit 0 |
| jest + coverage | `cd frontend && npm run test:coverage` | exit 0 · 182 suites / **2989 passed** · all files 79.43 / 71.2 / 69.76 / 80.41 |
| build | `cd frontend && npm run build` | exit 0 |
| E2E chromium | `npx playwright test --project=chromium` | exit 0 · **143 passed**, 0 flaky (includes `workflow-auto-layout-motion.spec.ts`) |
| E2E mobile-chrome | `npx playwright test --project=mobile-chrome` | exit 0 · **143 passed**, 0 flaky |
| E2E firefox | — | **not run**: no firefox binary in this container |
| core typecheck | `npm run --workspace packages/core typecheck` | exit 0 |
| core lint | `npm run --workspace packages/core lint` | exit 0 |
| core test | `npm run --workspace packages/core test` | exit 0 · 13 files / **122 passed** |

Environment notes:
- Node v22.22.2. Installed with `npx -y npm@11 ci` and `npm rebuild …`, then `git checkout -- package-lock.json`.
- This container has only chromium build 1194 under `/opt/pw-browsers`, while the pinned Playwright expects build 1243 and firefox. Chromium and mobile-chrome were run through a scratch `PLAYWRIGHT_BROWSERS_PATH` that symlinks the 1194 headless shell under the 1243 name. That is a different chromium build from CI's.
- **Firefox was not run** because no firefox binary is available here. CI's firefox job is the first run of these changes in that engine.
