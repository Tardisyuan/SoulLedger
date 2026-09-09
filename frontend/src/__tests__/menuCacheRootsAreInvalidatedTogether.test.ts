/**
 * A menu write must invalidate BOTH menu cache roots, and the workflow-template
 * detail key must be the plural one the save invalidates.
 *
 * Why this file exists
 * --------------------
 * Menus are cached under two roots that share no prefix: `["menus", …]` for the
 * admin list on `/menus`, and `["menus-sidebar", role, signedIn]` for the tree
 * `AppLayout` renders. TanStack matches by key prefix, so
 * `invalidateQueries({queryKey: ["menus"]})` does not touch the second one.
 *
 * Measured 2026-09-06: all three mutations on `app/menus/page.tsx` invalidated
 * only `["menus"]`. `useSidebarMenus` sets `staleTime: 5 * 60 * 1000` and
 * `AppLayout` never unmounts, so adding, renaming or deleting a menu left the
 * sidebar — and the breadcrumbs and the `MenuGloss` page titles, which read the
 * same entry — showing the old tree for up to five minutes. No test noticed,
 * because a cache miss is not an exception: the UI just kept rendering the
 * previous answer.
 *
 * The same shape, one file over: `WorkflowEditor` read its template from
 * `["workflow-template", id]` (singular) while its own save invalidated
 * `["workflow-templates"]` (plural).
 *
 * This is a SOURCE-TEXT test, deliberately. Rendering the menus page and
 * asserting on cache contents would need the mutation to actually resolve, and
 * would then assert about a QueryClient built by the test rather than about the
 * page. What decayed here was a literal, so a literal is what gets pinned.
 *
 * What "would really fail" means here
 * -----------------------------------
 * Every assertion was checked by breaking it:
 *
 * - putting `["menus"]` back as a literal in a mutation on the menus page
 *   reddens `test_the_menus_page_invalidates_through_the_factory`;
 * - dropping `["menus-sidebar"]` from `menuKeys.invalidateAll` reddens
 *   `test_invalidateAll_covers_both_roots`;
 * - restoring the hand-written sidebar key in `useSidebarMenus` reddens
 *   `test_the_sidebar_reads_its_key_from_the_factory`;
 * - re-singularising the WorkflowEditor query key reddens
 *   `test_the_workflow_template_detail_key_is_the_plural_one`.
 */

import fs from "fs";
import path from "path";
import { menuKeys, workflowKeys } from "@soulledger/core/query_keys";

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Read a source file with its comments blanked out.
 *
 * Not optional. The first run of this file failed on `WorkflowEditor.tsx`
 * because the *comment explaining the fix* quotes the buggy literal it replaced
 * — the guard read the explanation as the defect. That is the same shape as the
 * four other cases this repo has recorded (`domainDisplayContract` reading a
 * comment as a call, `civilizationCopyCoverage` not seeing prose, the two
 * design-guard baselines counting commented-out class names): the check runs,
 * the check goes red, and the subject is wrong.
 *
 * Blanking rather than deleting keeps line numbers intact, so a failure message
 * still points at the right line.
 */
const read = (rel: string) =>
  fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

const MENUS_PAGE = "app/menus/page.tsx";
const SIDEBAR_HOOK = "src/hooks/useSidebarMenus.ts";
const WORKFLOW_EDITOR = "src/components/workflow/WorkflowEditor.tsx";

describe("menu cache roots", () => {
  it("test_invalidateAll_covers_both_roots", () => {
    const roots = menuKeys.invalidateAll.map((k) => k[0]);
    // Non-vacuity first: an empty list would satisfy every `toContain` below.
    expect(roots.length).toBeGreaterThanOrEqual(2);
    expect(roots).toContain("menus");
    expect(roots).toContain("menus-sidebar");
    expect(menuKeys.sidebar("ADMIN", true)[0]).toBe("menus-sidebar");
  });

  it("test_the_sidebar_reads_its_key_from_the_factory", () => {
    const src = read(SIDEBAR_HOOK);
    expect(src).toContain("menuKeys.sidebar(");
    // The literal must be gone, not merely joined by the factory call.
    expect(src).not.toMatch(/queryKey:\s*\[\s*["']menus-sidebar["']/);
  });

  it("test_the_menus_page_invalidates_through_the_factory", () => {
    const src = read(MENUS_PAGE);
    expect(src).toContain("menuKeys.invalidateAll");

    // Every invalidateQueries on this page must go through the helper. A literal
    // `["menus"]` here is exactly the defect: it looks complete and covers half.
    const literalMenuInvalidations = [
      ...src.matchAll(/invalidateQueries\(\{\s*queryKey:\s*\[\s*["']menus["']\s*\]/g),
    ];
    expect(literalMenuInvalidations).toHaveLength(0);

    // And the mutations must actually call it — three writes, three calls.
    const helperCalls = [...src.matchAll(/invalidateMenus\(\)/g)];
    expect(helperCalls.length).toBeGreaterThanOrEqual(3);
  });
});

describe("workflow template detail key", () => {
  it("test_the_workflow_template_detail_key_is_the_plural_one", () => {
    // The factory itself: detail must sit under the root that `save` invalidates.
    expect(workflowKeys.templates.detail("x")[0]).toBe(workflowKeys.templates.all[0]);
    expect(workflowKeys.templates.all[0]).toBe("workflow-templates");
  });

  it("test_the_editor_reads_its_template_through_the_factory", () => {
    const src = read(WORKFLOW_EDITOR);
    expect(src).toContain("workflowKeys.templates.detail(");
    // The singular literal is the bug; assert its absence, not just the presence
    // of the factory call.
    expect(src).not.toMatch(/\[\s*["']workflow-template["']\s*,/);
  });
});
