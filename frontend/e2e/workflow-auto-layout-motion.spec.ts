import { test, expect, type Page } from "@playwright/test";
import { setupAuthenticatedPage, type ApiMock } from "./fixtures";

/**
 * The auto-layout transition, in a real browser, because jsdom cannot see it.
 *
 * `src/__tests__/workflowAutoLayoutMotion.test.tsx` pins the DECISIONS around
 * this animation — reduced motion takes the instant path, Flip is entered once
 * per press, the load path never enters it — against a stub that renders node
 * wrappers but no transforms. None of that is evidence that a card actually
 * travels: jsdom has no layout, no `requestAnimationFrame` budget worth the
 * name, and every `getBoundingClientRect` is zeroes, so gsap would compute a
 * zero delta and animate nothing while every assertion in that file stayed
 * green.
 *
 * What this file adds is the only claim that matters visually and the only one
 * that can be wrong in a way tests elsewhere cannot see:
 *
 *   1. a moved card passes through intermediate positions (it travels);
 *   2. under `prefers-reduced-motion: reduce` it does not (it teleports);
 *   3. where it STOPS is exactly where `layoutNodes` put it — read back off
 *      the DOM `transform` and compared to the coordinates the save payload
 *      carries, which is `layoutNodes`'s own output via `getTemplateNodes`.
 *
 * (3) is the one that keeps the animation honest. An animation that lands a
 * few pixels off, or that leaves gsap's transform fighting xyflow's, would
 * still satisfy (1).
 *
 * THE FIXTURE IS THE PRESET, AND IT MOVES WITHOUT A DRAG. Opening 十殿审判流程
 * in the editor lays its ten cards out before they have ever been on screen,
 * so `sizeOf` falls back to the assumed 110px height and the pitch is 160. The
 * first press of the button runs against rendered cards, whose real height is
 * 92, and the pitch tightens to 142 — documented in `workflowEditorGraph.ts`.
 * Nine of the ten cards therefore move, by a known and growing amount, with no
 * mouse dragging to make flaky.
 *
 * ZOOM IS NOT 1 HERE, WHICH IS THE POINT. Ten cards at a 160px pitch is a
 * ~1.5k-pixel-tall graph in a viewport a few hundred pixels high, and
 * `fitView` zooms out to roughly 0.3 to show it. Every `getBoundingClientRect`
 * Flip takes is multiplied by that. `expectedFinalPositions` below compares
 * the UNSCALED `translate()` xyflow writes on each wrapper against the saved
 * integer coordinates, so a transition that animated in screen space and left
 * screen-space values behind would be off by a factor of three and fail.
 */

const SAMPLE_FRAMES = 90;

/** Open the ten-node preset in the editor tab. */
async function openPresetInEditor(page: Page) {
  await page.goto("/workflow");
  await expect(
    page.getByRole("heading", { name: "十殿审判流程" }).filter({ visible: true })
  ).toBeVisible();

  // The saved-template list is empty in the default mock, so the preview
  // pane's is the only 编辑 on the page.
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  // Ten wrappers, each carrying its template-local id.
  await expect(page.locator(".react-flow__node")).toHaveCount(10);
}

/** Start recording one `transform` per node per animation frame. */
async function startSampling(page: Page) {
  await page.evaluate((frames) => {
    const w = window as unknown as { __flipSamples?: Record<string, string>[] };
    w.__flipSamples = [];
    const tick = () => {
      const row: Record<string, string> = {};
      document.querySelectorAll<HTMLElement>(".react-flow__node").forEach((el) => {
        row[el.getAttribute("data-id") ?? ""] = getComputedStyle(el).transform;
      });
      w.__flipSamples!.push(row);
      if (w.__flipSamples!.length < frames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SAMPLE_FRAMES);
}

async function readSamples(page: Page): Promise<Record<string, string>[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __flipSamples?: Record<string, string>[] };
    return w.__flipSamples ?? [];
  });
}

/** How many distinct `transform` strings each node was seen at. */
function distinctPerNode(samples: Record<string, string>[]): Record<string, number> {
  const seen: Record<string, Set<string>> = {};
  for (const row of samples) {
    for (const [id, transform] of Object.entries(row)) {
      if (!id) continue;
      (seen[id] ??= new Set()).add(transform);
    }
  }
  return Object.fromEntries(Object.entries(seen).map(([id, set]) => [id, set.size]));
}

/**
 * The translation xyflow has written on each wrapper, in the layout's own
 * coordinates — `matrix(a, b, c, d, tx, ty)`, read straight off the element,
 * so the ancestor viewport's `scale()` is not in it.
 */
async function domPositions(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number }> = {};
    document.querySelectorAll<HTMLElement>(".react-flow__node").forEach((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      out[el.getAttribute("data-id") ?? ""] = { x: Math.round(m.m41), y: Math.round(m.m42) };
    });
    return out;
  });
}

/** `layoutNodes`'s own output, via the save payload. */
async function savedPositions(page: Page, api: ApiMock) {
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect.poll(() => api.countOf("POST", "/workflow/templates/")).toBeGreaterThan(0);
  const body = api.lastCall("POST", "/workflow/templates/")!.body;
  return Object.fromEntries(
    (body.nodes as { id: string; position: { x: number; y: number } }[]).map((n) => [
      n.id,
      n.position,
    ])
  );
}

let api: ApiMock;

test.beforeEach(async ({ page }) => {
  api = await setupAuthenticatedPage(page);
  api.on("POST", "/workflow/templates/", (call) => ({
    status: 201,
    body: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...call.body },
  }));
});

test.describe("auto layout narrates the move", () => {
  test("a re-laid-out card passes through intermediate positions and lands where layoutNodes put it", async ({
    page,
  }) => {
    await openPresetInEditor(page);

    const before = await domPositions(page);
    await startSampling(page);
    await page.getByRole("button", { name: "自动布局", exact: true }).click();
    // Comfortably past the 450ms travel.
    await page.waitForTimeout(1500);

    const distinct = distinctPerNode(await readSamples(page));
    const after = await domPositions(page);

    // Nine of the ten cards move (the first rank stays at the top).
    const movedIds = Object.keys(after).filter(
      (id) => before[id].x !== after[id].x || before[id].y !== after[id].y
    );
    expect(movedIds.length).toBeGreaterThanOrEqual(8);

    // TRAVEL. A teleport shows two values: the old one and the new one. Every
    // card that moved was seen at four or more, i.e. it was rendered at
    // positions that are neither where it started nor where it ended.
    for (const id of movedIds) {
      expect(distinct[id], `node ${id} was only seen at ${distinct[id]} position(s)`)
        .toBeGreaterThanOrEqual(4);
    }

    // A card that did NOT move must not have been animated either — absence,
    // and the thing a blanket `Flip.from` over every wrapper would break.
    for (const id of Object.keys(after)) {
      if (movedIds.includes(id)) continue;
      expect(distinct[id], `node ${id} did not move but was seen moving`).toBe(1);
    }

    // WHERE IT STOPS. The DOM translation equals the integer coordinates
    // `layoutNodes` produced, to the pixel and in the layout's own space —
    // not the screen space Flip measured in at zoom ≈ 0.3.
    expect(after).toEqual(await savedPositions(page, api));
  });

  test("the load path animates nothing — one transform per card, start to finish", async ({
    page,
  }) => {
    // Absence. Opening a preset lays out every node; if the transition were
    // wired to the layout rather than to the button, ten cards would fly in
    // from the origin on every open.
    await page.goto("/workflow");
    await expect(
      page.getByRole("heading", { name: "十殿审判流程" }).filter({ visible: true })
    ).toBeVisible();
    await startSampling(page);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(10);
    await page.waitForTimeout(1500);

    const distinct = distinctPerNode(await readSamples(page));
    expect(Object.keys(distinct).length).toBe(10);
    for (const [id, count] of Object.entries(distinct)) {
      expect(count, `node ${id} was seen at ${count} positions while merely loading`).toBe(1);
    }
  });

  test("a second press mid-travel does not strand the cards where the first one had got to", async ({
    page,
  }) => {
    /**
     * The defect the `moved` guard in `autoLayout` prevents, which is
     * invisible to every other test here.
     *
     * Press two arrives 150ms into a 450ms travel. By then the editor's state
     * ALREADY holds the final coordinates, so a re-layout computes the same
     * answer and React writes no new `transform`. An implementation that
     * entered Flip anyway would kill the running tween — abandoning the cards
     * at whatever fraction of the journey they had reached — then measure a
     * zero delta and animate nothing, and they would stay there. The screen
     * would show a layout that matches nothing the editor would save.
     */
    await openPresetInEditor(page);

    const button = page.getByRole("button", { name: "自动布局", exact: true });
    await button.click();
    await page.waitForTimeout(150);
    await button.click();
    await page.waitForTimeout(1500);

    expect(await domPositions(page)).toEqual(await savedPositions(page, api));
  });

  test("pressing the button a second time, with nothing left to move, animates nothing", async ({
    page,
  }) => {
    await openPresetInEditor(page);
    await page.getByRole("button", { name: "自动布局", exact: true }).click();
    await page.waitForTimeout(1500);

    const settled = await domPositions(page);
    await startSampling(page);
    await page.getByRole("button", { name: "自动布局", exact: true }).click();
    await page.waitForTimeout(1500);

    const distinct = distinctPerNode(await readSamples(page));
    for (const [id, count] of Object.entries(distinct)) {
      expect(count, `node ${id} moved on a no-op re-layout`).toBe(1);
    }
    expect(await domPositions(page)).toEqual(settled);
  });
});

test.describe("auto layout under prefers-reduced-motion", () => {
  /**
   * `page.emulateMedia`, NOT `test.use({ reducedMotion: "reduce" })`.
   *
   * The declarative form is the one that reads as obviously correct, and under
   * this config it does not reach the page: measured 2026-09-05 against a
   * probe that did nothing but read the query,
   * `window.matchMedia("(prefers-reduced-motion: reduce)").matches` came back
   * **false** with `test.use` and **true** with `emulateMedia`. Written the
   * declarative way, this test would have exercised the ANIMATED path and
   * asserted the animated path had no motion — which is how the first run of
   * it failed, and the only reason the difference was noticed at all.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  /**
   * A COUNT OF DISTINCT POSITIONS IS NOT ENOUGH HERE, AND FINDING THAT OUT IS
   * MOST OF WHY THIS TEST IS SHAPED THE WAY IT IS.
   *
   * The first version of this case asserted only "at most two distinct
   * transforms per card", which is the same evidence the animated cases use.
   * It passed — and it went on passing with the `prefersReducedMotion()` call
   * deleted from `WorkflowEditor.tsx`, which is the one mutation it exists to
   * catch. Measured 2026-09-05 with the guard removed and reduced motion
   * emulated: gsap took the transform over (the inline value turned from
   * xyflow's `translate(0px, 640px)` into gsap's `translate3d(0px, 640px,
   * 0px)`) and then **did not advance it for the whole 1200ms window** before
   * snapping to the end. With the same build and the emulation off, the same
   * card walked 640 → 639.9 → 639.6 → … → 568 exactly as it should. Something
   * in headless chromium's reduced-motion emulation stalls a gsap tween on its
   * own; the cause was not chased down, and it does not need to be, but it
   * means a frame count cannot tell "we never animated" from "we animated and
   * the browser froze it".
   *
   * So the assertion that carries the weight is the timing one: with the guard
   * in place the card is ALREADY at its final coordinates on the first read
   * after the click. A stalled tween is not; nor is a running one.
   */
  test("the operator who asked for no motion gets the instant re-layout", async ({ page }) => {
    // The emulation has to be in place before the button is pressed, because
    // the preference is read at click time rather than subscribed to.
    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
    ).toBe(true);
    await openPresetInEditor(page);

    const before = await domPositions(page);
    await startSampling(page);
    await page.getByRole("button", { name: "自动布局", exact: true }).click();
    /*
     * 120ms — long enough that React has certainly committed, far too short
     * for a 450ms `power2.inOut` travel to have covered a tenth of its
     * distance. NOT zero: `click()` resolves when the event has been
     * dispatched, and on the instant path the commit lands a tick later, so a
     * read with no wait at all catches the OLD coordinates and fails against
     * correct code. (That lag is also the reason the animated path cannot use
     * `useLayoutEffect` — see `WorkflowEditor.tsx`.)
     */
    await page.waitForTimeout(120);
    const immediate = await domPositions(page);
    await page.waitForTimeout(1500);

    const distinct = distinctPerNode(await readSamples(page));
    const after = await domPositions(page);

    // INSTANT. Not "quick" — the layout is finished before anything is
    // painted, which is what "no motion" has to mean.
    expect(immediate).toEqual(after);

    // The re-layout still HAPPENED — this preference removes the motion, not
    // the feature. Without this half the test would pass on a button that did
    // nothing at all.
    const movedIds = Object.keys(after).filter(
      (id) => before[id].x !== after[id].x || before[id].y !== after[id].y
    );
    expect(movedIds.length).toBeGreaterThanOrEqual(8);

    // Two values at most: where it was, and where it is. Weak on its own (see
    // above), kept because it is the direct reading of "no frame in between".
    for (const [id, count] of Object.entries(distinct)) {
      expect(count, `node ${id} was animated despite prefers-reduced-motion`).toBeLessThanOrEqual(2);
    }

    // And it lands in the same place the animated path lands.
    expect(after).toEqual(await savedPositions(page, api));
  });
});
