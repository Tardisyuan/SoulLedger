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

/**
 * Open the FOUR-node preset instead — the graph that fits.
 *
 * 申诉审判流程 is a plain chain of four, and the init `fitView` frames it with
 * ~20px of slack top and bottom in the 1008×441 pane (measured 2026-09-05).
 * The button then TIGHTENS the pitch from 160 to 142, so the result is
 * strictly smaller than something that already fitted — which is the only
 * shape of press that can prove the viewport is left alone.
 */
async function openSmallPresetInEditor(page: Page) {
  await page.goto("/workflow");
  await page.getByRole("button", { name: /申诉审判流程/ }).first().click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
}

/** The viewport's own `transform`, verbatim — the string the browser reports. */
async function viewportTransform(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".react-flow__viewport");
    return el ? getComputedStyle(el).transform : "MISSING";
  });
}

/** Every card's box in screen pixels, and the pane's, so overflow is checkable. */
async function screenBoxes(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".react-flow")!.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(".react-flow__node")
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute("data-id") ?? "", ...r.toJSON() };
    });
    return { pane: pane.toJSON(), cards };
  });
}

/** How far outside the pane the worst card sticks, in pixels. 0 = all inside. */
function overflowOf(boxes: Awaited<ReturnType<typeof screenBoxes>>): number {
  return Math.max(
    0,
    ...boxes.cards.map((c) =>
      Math.max(
        boxes.pane.left - c.left,
        boxes.pane.top - c.top,
        c.right - boxes.pane.right,
        c.bottom - boxes.pane.bottom
      )
    )
  );
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

/**
 * THE VIEWPORT, WHICH IS A DIFFERENT SUBJECT FROM EVERYTHING ABOVE.
 *
 * `<ReactFlow fitView>` as a bare prop fits ONCE, at init. While every node
 * sat at x: 250 in one column that was enough for the editor's whole life; a
 * re-layout could not push anything sideways, so nothing could leave the pane.
 * dagre's `rankdir: "TB"` spreads branches left and right and a re-layout can
 * now put cards outside the pane — with nothing to bring them back.
 *
 * The fix is conditional, and BOTH halves need holding down. "Fit whenever the
 * button is pressed" closes the defect and would pass the first test here on
 * its own; it is the second one — the viewport transform must come back
 * BYTE-IDENTICAL when the result already fits — that says why the condition
 * exists. A zoom and pan on every press drowns out the one thing the 450ms
 * travel is for.
 *
 * These are e2e and not jest for the ordinary reason: jsdom has no layout, no
 * viewport `transform`, and every rect is zeroes, so an assertion there about
 * fitting would be an assertion about nothing.
 */
test.describe("auto layout brings the result back on screen, and only then", () => {
  test("a layout that would overflow moves the viewport, and the cards land inside it", async ({
    page,
  }) => {
    /*
     * THE FOUR-NODE PRESET, NOT THE TEN-COURT ONE, AND THE REASON IS A REAL
     * LIMIT RATHER THAN A CONVENIENCE. xyflow's default `minZoom` is 0.5, and
     * `fitBounds` clamps to it. The ten-court graph at the tightened pitch is
     * ~1370 layout pixels tall in a 441px pane, so fitting it needs zoom 0.32
     * — refused. Measured on that preset the fit still helps enormously (the
     * worst card goes from ~1000px outside the pane to 122px, centred), but
     * "the cards end up inside" is simply not true there and asserting it
     * would be asserting a wish. Four nodes fit at ~0.77, well inside the
     * clamp, so the strong form of the claim is available.
     */
    await openSmallPresetInEditor(page);
    await page.waitForTimeout(500);

    /*
     * Zoom in six times — the operator who leaned in to read a card and then
     * pressed the button. 1.2 per press takes the init fit of 0.70 past
     * `maxZoom`, so this parks at 2 and the chain is more than twice the
     * height of the pane.
     */
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Zoom In" }).click();
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);

    // The premise: at this zoom the graph really is off screen, by a lot.
    // Without this the test could pass on a canvas that never overflowed.
    const overflowBefore = overflowOf(await screenBoxes(page));
    expect(overflowBefore).toBeGreaterThan(200);

    const vpBefore = await viewportTransform(page);
    await page.getByRole("button", { name: "自动布局", exact: true }).click();
    await page.waitForTimeout(1500);

    // THE VIEWPORT MOVED. This is the defect, directly: before the fix it
    // did not, and nothing else in the editor would have moved it either.
    expect(await viewportTransform(page)).not.toBe(vpBefore);

    /*
     * AND THE CARDS ARE BACK. Not merely "the viewport changed" — a fit that
     * framed the wrong rectangle would satisfy that. 1px of slack, because the
     * fit is computed from `layoutNodes`'s integer coordinates and the assumed
     * card box while the browser measures the rendered one; the graph here is
     * ~700 screen pixels tall, so this is a tolerance on rounding and not on
     * being roughly right.
     */
    expect(overflowOf(await screenBoxes(page))).toBeLessThanOrEqual(1);

    // AND THE NODE COORDINATES ARE UNTOUCHED BY IT. A fit is a camera move;
    // if this ever fails it means the fit moved the layout, which is wrong.
    expect(await domPositions(page)).toEqual(await savedPositions(page, api));
  });

  test("a layout that already fits leaves the viewport byte-identical", async ({ page }) => {
    await openSmallPresetInEditor(page);
    await page.waitForTimeout(500);

    // The premise, again asserted rather than assumed: nothing is outside the
    // pane, so a correct implementation has no reason to touch the viewport.
    expect(overflowOf(await screenBoxes(page))).toBe(0);

    const vpBefore = await viewportTransform(page);
    const before = await domPositions(page);

    await page.getByRole("button", { name: "自动布局", exact: true }).click();
    await page.waitForTimeout(1500);

    // The press DID something — otherwise "the viewport did not move" is the
    // trivially true statement about a button that does nothing.
    const after = await domPositions(page);
    expect(
      Object.keys(after).filter((id) => before[id].y !== after[id].y).length
    ).toBeGreaterThanOrEqual(2);

    // BYTE-IDENTICAL. The string, not a rounded comparison: an unconditional
    // fit re-frames a four-node chain to a different zoom and this fails.
    expect(await viewportTransform(page)).toBe(vpBefore);
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

  /**
   * NO MOTION IS NOT NO FIT.
   *
   * The instant branch returns before Flip is ever entered, so it was the easy
   * place to leave the viewport out — and the operator who asked for no motion
   * is exactly the one who cannot chase a card that went off screen. The fit
   * there shares the single React commit with `setNodes`, so it arrives with
   * the layout rather than a frame ahead of it; the "immediate equals final"
   * assertion above is what holds that down for the cards, and this holds it
   * down for the camera.
   */
  test("the instant path still brings an overflowing layout back on screen", async ({ page }) => {
    await openSmallPresetInEditor(page);
    await page.waitForTimeout(500);
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Zoom In" }).click();
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    expect(overflowOf(await screenBoxes(page))).toBeGreaterThan(200);

    const vpBefore = await viewportTransform(page);
    await page.getByRole("button", { name: "自动布局", exact: true }).click();
    // 120ms: the same window the case above uses for "already finished".
    await page.waitForTimeout(120);

    expect(await viewportTransform(page)).not.toBe(vpBefore);
    expect(overflowOf(await screenBoxes(page))).toBeLessThanOrEqual(1);
  });
});
