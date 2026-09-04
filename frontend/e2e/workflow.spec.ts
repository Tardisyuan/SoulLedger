import { test, expect, type Page } from "@playwright/test";
import { domainEnum, setupAuthenticatedPage, WORKFLOW_INSTANCE, type ApiMock } from "./fixtures";

/**
 * Text locators here must be filtered to the visible match.
 *
 * While the Next dev server is still compiling a route it streams the subtree
 * into a `<div hidden>` parked on <body> and only grafts it into place once the
 * chunk lands. Until then the same text exists twice in the DOM, and a bare
 * getByText() resolves to two elements -> strict mode violation. It is a race,
 * so it fails intermittently on every engine (measured: chromium 7-8 times in
 * 42 runs), not just the slow ones. Filtering to `visible` drops the parked
 * copy, which is inert by definition.
 */
const seen = (page: Page, text: string) => page.getByText(text).filter({ visible: true });
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name }).filter({ visible: true });

/**
 * /workflow — the approval-template screen.
 *
 * Every test in this file used to run unauthenticated, so middleware.ts
 * redirected each one to /login and they all asserted against the login
 * page's <body>. They now authenticate first (see fixtures.ts) and assert on
 * the template list, the preview pane and the instances tab.
 */

let api: ApiMock;

test.beforeEach(async ({ page }) => {
  api = await setupAuthenticatedPage(page);
});

test.describe("Workflow page", () => {
  test("renders the header and all three tabs for an authenticated user", async ({ page }) => {
    await page.goto("/workflow");

    // Reaching the page at all is the first real assertion — unauthenticated
    // this URL is a redirect to /login.
    await expect(page).toHaveURL(/\/workflow$/);
    await expect(page.locator("h1").filter({ visible: true })).toContainText("审批流程");

    for (const tab of ["现有流程", "流程编辑器", "审批实例"]) {
      await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }
  });

  test("previews the default predefined template with its full node list", async ({ page }) => {
    await page.goto("/workflow");

    await expect(seen(page, "预定义模板")).toBeVisible();

    // CHINESE_ROUTINE is the initial selection (page.tsx:91) and has ten
    // nodes, one per court of the Chinese underworld.
    await expect(heading(page, "十殿审判流程")).toBeVisible();
    await expect(seen(page, "10 个节点")).toBeVisible();
    await expect(seen(page, "秦广王 · 分流")).toBeVisible();
    await expect(seen(page, "转轮王 · 终审")).toBeVisible();
  });

  test("selecting a different template swaps the preview", async ({ page }) => {
    await page.goto("/workflow");
    await expect(heading(page, "十殿审判流程")).toBeVisible();

    await page.getByRole("button", { name: "申诉审判流程", exact: true }).click();

    await expect(heading(page, "申诉审判流程")).toBeVisible();
    await expect(heading(page, "十殿审判流程")).toHaveCount(0);
  });

  test("instances tab lists the workflows returned by the API", async ({ page }) => {
    await page.goto("/workflow");

    await page.getByRole("button", { name: "审批实例", exact: true }).click();

    await expect(seen(page, WORKFLOW_INSTANCE.workflow_name)).toBeVisible();
    // The row shows the soul's *name*, and must not show its primary key.
    //
    // This line used to read `WORKFLOW_INSTANCE.soul` and passed -- because
    // the fixture set that field to a Chinese personal name while the list
    // serializer sends a UUID there. The test certified behaviour the fixture
    // had supplied. Both halves are asserted now: the absence is the one that
    // cannot be satisfied by accident.
    await expect(seen(page, WORKFLOW_INSTANCE.soul_name)).toBeVisible();
    await expect(page.getByText(WORKFLOW_INSTANCE.soul, { exact: false })).toHaveCount(0);

    // The row's meta line is `<DomainEnum case_type> · <soul>`. Asserting the
    // enum through `title` rather than either the raw member or one locale's
    // copy — see domainEnum() in fixtures.ts for why.
    await expect(domainEnum(page, WORKFLOW_INSTANCE.case_type)).toBeVisible();
    // The §4.6 regression guard: the raw member must never reach the user.
    await expect(page.getByText(WORKFLOW_INSTANCE.case_type, { exact: true })).toHaveCount(0);

    expect(api.countOf("GET", "/workflows/")).toBeGreaterThan(0);
  });

  test("empty instances list shows the empty state, not a blank pane", async ({ page }) => {
    api.on("GET", "/workflows/", { count: 0, next: null, previous: null, results: [] });
    await page.goto("/workflow");

    await page.getByRole("button", { name: "审批实例", exact: true }).click();
    await expect(seen(page, "暂无审批实例")).toBeVisible();
  });

  test("a 500 on the instances list renders no rows and does not crash the tab", async ({ page }) => {
    api.on("GET", "/workflows/", () => ({ status: 500, body: { detail: "boom" } }));
    await page.goto("/workflow");

    await page.getByRole("button", { name: "审批实例", exact: true }).click();

    // 这个 tab 此前对「加载失败」和「一条都没有」渲染**同一段文案**
    // (「暂无审批实例」),于是这条测试与它上面那条空状态测试共用一个可观察量 ——
    // 一个让实例列表永久为空的变异会让两条都通过。那时这里写着
    // 「Known gap, pinned deliberately」。缺口补上了(`QueryError`),断言跟着换。
    await expect(seen(page, WORKFLOW_INSTANCE.workflow_name)).toHaveCount(0);
    await expect(page.locator("[data-query-error]")).toBeVisible();
    // **这一句才是这条测试的意义**:失败态不能长得像空态。
    await expect(seen(page, "暂无审批实例")).toHaveCount(0);
    await page.getByRole("button", { name: "现有流程", exact: true }).click();
    await expect(heading(page, "十殿审判流程")).toBeVisible();
  });

  test("空列表与 500 渲染的不是同一段文案", async ({ page }) => {
    /* 把 M12 那句话本身写成断言。上面两条各自成立时,「两者可区分」仍然可能
       不成立 —— 比如两条路径都渲染 role="alert"。这一条直接比较两次渲染。 */
    api.on("GET", "/workflows/", { count: 0, next: null, previous: null, results: [] });
    await page.goto("/workflow");
    await page.getByRole("button", { name: "审批实例", exact: true }).click();
    await expect(seen(page, "暂无审批实例")).toBeVisible();
    // `role="alert"` 区分不开 —— 空状态组件自己也带这个角色,第一版就是这么
    // 写的,而它红了。用 `data-query-error` 这个只有失败态才有的标记。
    const emptyShowedError = await page.locator("[data-query-error]").count();

    api.on("GET", "/workflows/", () => ({ status: 500, body: { detail: "boom" } }));
    await page.reload();
    await page.getByRole("button", { name: "审批实例", exact: true }).click();
    await expect(page.locator("[data-query-error]")).toBeVisible();
    await expect(seen(page, "暂无审批实例")).toHaveCount(0);

    expect(emptyShowedError).toBe(0);
  });
});

test.describe("Workflow editor toolbar", () => {
  /**
   * `WorkflowTemplate.priority` in a real browser, end to end.
   *
   * `20994df` added the column, the toolbar `<select>` and Jest coverage for
   * the label, the three option strings, the default and the save payload —
   * but every one of those assertions runs against a jsdom tree that was never
   * navigated to, and the backend assertion starts from a hand-built POST. The
   * one thing nothing covered is the join: that the control actually renders
   * on /workflow behind the real router, middleware and lazy chunk, and that
   * what a user picks in it is what leaves the browser.
   *
   * That join is exactly where this column used to be lost — the editor sent a
   * body with no `priority` key at all, so the three `priority: 1` presets were
   * saved back as ordinary ones and nothing anywhere went red.
   *
   * No product code was changed to make this writable: the select is located by
   * the `aria-label` it already carries (`t("workflow.detail.priority")`), the
   * same key `app/workflow/[id]/page.tsx` labels `ApprovalWorkflow.priority`
   * with, so this test also fails if that shared label is forked.
   */
  test("priority select renders, offers exactly three tiers, and its choice reaches the POST body", async ({
    page,
  }) => {
    // The default mock has no POST handler for this path, so it would fall
    // through to the empty-page fallback and still 200. Answering 201 with the
    // echoed body is what the real WorkflowTemplateViewSet does.
    api.on("POST", "/workflow/templates/", (call) => ({
      status: 201,
      body: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ...call.body },
    }));

    await page.goto("/workflow");
    await page.getByRole("button", { name: "流程编辑器", exact: true }).click();

    const priority = page.getByLabel("优先级", { exact: true }).filter({ visible: true });
    await expect(priority).toBeVisible();

    // Three tiers, and each option's value paired with its own copy — a select
    // whose labels drifted off their values reads correctly and saves the wrong
    // number. `toHaveCount(3)` is the absence half: a fourth tier would have to
    // be a deliberate edit here, because 0/1/2 is the whole of the model column.
    await expect(priority.locator("option")).toHaveCount(3);
    for (const [value, label] of [["0", "普通"], ["1", "紧急"], ["2", "危急"]]) {
      await expect(priority.locator(`option[value="${value}"]`)).toHaveText(label);
    }

    // A fresh editor opens at the column's own floor.
    await expect(priority).toHaveValue("0");

    await page.getByLabel("模板名称", { exact: true }).filter({ visible: true }).fill("危急模板");
    await priority.selectOption("2");
    await expect(priority).toHaveValue("2");

    await page.getByRole("button", { name: "保存模板", exact: true }).click();

    await expect.poll(() => api.countOf("POST", "/workflow/templates/")).toBe(1);
    const body = api.lastCall("POST", "/workflow/templates/")!.body;

    // `toBe(2)`, not `toBe("2")`: the select hands back a string and
    // `WorkflowEditor` is what calls Number() on it. Dropping that conversion
    // would leave a payload DRF still coerces, so the type is the only place
    // the regression is visible — and 2 is neither the default (0) nor the
    // value any preset carries (1), so it can only have come from the click.
    expect(body.priority).toBe(2);
    expect(body.name).toBe("危急模板");

    // The save really was the create path, not a silent no-op that left the
    // editor's other fields behind.
    expect(body.case_type).toBe("ROUTINE");
    expect(body.civilization).toBe("CHINESE");
  });
});

test.describe("Workflow editor keyboard access", () => {
  /**
   * THE NODE EDIT MODAL, WITHOUT A MOUSE.
   *
   * `onNodeDoubleClick` was the only way to open it, so a keyboard-only
   * operator could not edit a single node of a template. `E` on a focused node
   * is the way in now.
   *
   * WHY THIS FILE AND NOT JSDOM. `src/__tests__/WorkflowEditor.test.tsx` pins
   * the DECISIONS — which key, which modifiers, what happens when the modal is
   * already open — against a stub that renders one wrapper per node because
   * this file's product code needs one to exist. What that stub cannot say is
   * the thing the whole change turns on: that a node is REACHABLE. `tabIndex`
   * there is a string the test file itself writes; jsdom has no sequential
   * navigation to speak of, so "Tab lands on a card" is not a claim it can
   * make. Here, `page.keyboard.press("Tab")` is chromium's own focus order over
   * `@xyflow/react`'s own wrapper.
   *
   * THE FIXTURE IS 申诉审判流程, the four-node chain, for the same reason
   * `workflow-auto-layout-motion.spec.ts` uses it: four cards fit in the pane
   * at the init `fitView`, so nothing here depends on scrolling or on
   * `autoPanOnNodeFocus` having moved the viewport first.
   */

  /** The four cards, in the order the preset declares them. */
  const APPEAL_LABELS = [
    "魏征 · 察查司, APPEAL, 察查司",
    "原殿阎王 · 复核, TRIAL, 原审判殿",
    "上级殿阎王, TRIAL, 上一殿",
    "酆都大帝 · 终审, FINAL, 酆都",
  ];

  async function openAppealPresetInEditor(page: Page) {
    await page.goto("/workflow");
    await page.getByRole("button", { name: /申诉审判流程/ }).first().click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
  }

  /** Which node the browser's own focus is on, or null. */
  function focusedNodeId(page: Page): Promise<string | null> {
    return page.evaluate(
      () =>
        document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id") ?? null
    );
  }

  /**
   * Tab forward from wherever focus is until it lands on a card.
   *
   * Bounded and reported rather than looped until it works: "a node is
   * reachable after some unbounded number of tabs" is not reachability. The
   * count is returned so the assertion can be about a small number.
   */
  async function tabUntilNode(page: Page, max = 12) {
    for (let presses = 1; presses <= max; presses += 1) {
      await page.keyboard.press("Tab");
      const id = await focusedNodeId(page);
      if (id) return { presses, id };
    }
    return { presses: max, id: null as string | null };
  }

  test("a keyboard-only operator can Tab to a node and open its edit modal with E", async ({
    page,
  }) => {
    await openAppealPresetInEditor(page);

    // Start at the first toolbar control, which is where a Tab from the page
    // chrome arrives, and walk forward. Nothing here is focused by script
    // except this starting point.
    await page.getByLabel("模板名称", { exact: true }).filter({ visible: true }).focus();

    const landed = await tabUntilNode(page);
    // THE ASSERTION THIS FILE EXISTS FOR. Before this change the cards were
    // still focusable — `nodesFocusable` defaults true — but reaching one
    // bought nothing, because no key did anything once you were there.
    expect(landed.id).not.toBeNull();
    expect(landed.presses).toBeLessThanOrEqual(12);

    const label = await page
      .locator(`.react-flow__node[data-id="${landed.id}"]`)
      .getAttribute("aria-label");
    expect(APPEAL_LABELS).toContain(label);

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("e");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The modal opened on THE focused node, not on some node. `aria-label`'s
    // first field is the node name, which is what the form is seeded with.
    await expect(dialog.getByLabel("节点名称", { exact: true })).toHaveValue(
      label!.split(", ")[0]
    );
  });

  test("every card carries a non-empty accessible name built from what it shows", async ({
    page,
  }) => {
    await openAppealPresetInEditor(page);

    const labels = await page.locator(".react-flow__node").evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label"))
    );
    expect(labels).toEqual(APPEAL_LABELS);
    // Absence, and the reason the builder falls back to the node id: an empty
    // `aria-label` is worse than none — it silences the element's other naming
    // paths rather than deferring to them.
    for (const label of labels) {
      expect(label).toBeTruthy();
    }

    // The shortcut is announced on the element it applies to. This is the half
    // of discoverability a screen reader gets; the `<kbd>E</kbd>` in the hint
    // panel is the half a sighted keyboard operator gets.
    const shortcuts = await page.locator(".react-flow__node").evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-keyshortcuts"))
    );
    expect(shortcuts).toEqual(["E", "E", "E", "E"]);
    await expect(page.getByText("E 编辑节点", { exact: false }).first()).toBeVisible();
  });

  test("E in the template-name field types a letter and opens nothing", async ({ page }) => {
    await openAppealPresetInEditor(page);

    const name = page.getByLabel("模板名称", { exact: true }).filter({ visible: true });
    // The field is not empty — opening a preset fills it with that preset's
    // name — so the letter is appended to what is already there rather than
    // being the whole value.
    const before = await name.inputValue();
    expect(before).not.toBe("");
    await name.click();
    await page.keyboard.press("End");
    await page.keyboard.press("e");

    // Both halves. "No modal" alone would also pass if the key had been
    // swallowed by `preventDefault` somewhere and the operator could no longer
    // type the letter at all.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(name).toHaveValue(`${before}e`);
  });

  test("E with a modifier is left to the browser", async ({ page }) => {
    await openAppealPresetInEditor(page);
    const landed = await (async () => {
      await page.getByLabel("模板名称", { exact: true }).filter({ visible: true }).focus();
      return tabUntilNode(page);
    })();
    expect(landed.id).not.toBeNull();

    for (const combo of ["Meta+e", "Control+e", "Alt+e"]) {
      await page.keyboard.press(combo);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    // The same key without a modifier still works — otherwise the three
    // assertions above would be satisfied by a shortcut that never fires.
    expect(await focusedNodeId(page)).toBe(landed.id);
    await page.keyboard.press("e");
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("E with the modal already open does not re-seed the form", async ({ page }) => {
    await openAppealPresetInEditor(page);
    await page.getByLabel("模板名称", { exact: true }).filter({ visible: true }).focus();
    const landed = await tabUntilNode(page);
    expect(landed.id).not.toBeNull();
    await page.keyboard.press("e");

    const dialog = page.getByRole("dialog");
    const nameField = dialog.getByLabel("节点名称", { exact: true });
    await expect(nameField).toBeVisible();
    await nameField.fill("改到一半");

    // Whatever the dialog's focus trap has focused, `E` must not re-enter the
    // handler and replace the operator's half-finished edit.
    await page.keyboard.press("e");

    await expect(dialog).toHaveCount(1);
    await expect(nameField).toHaveValue(/^改到一半/);
  });
});

test.describe("Workflow page health", () => {
  test("loads without an uncaught exception", async ({ page }) => {
    // pageerror fires only for uncaught exceptions, so this cannot be muted
    // by network noise the way a console-error filter can.
    const crashes: string[] = [];
    page.on("pageerror", (err) => crashes.push(err.message));

    await page.goto("/workflow");
    await expect(heading(page, "十殿审判流程")).toBeVisible();

    expect(crashes).toEqual([]);
  });
});
