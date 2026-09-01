import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The suite's own shape: which files run, and roughly how much runs in them.
 *
 * WHY THIS EXISTS. The backend has `test_collection_scope.py`, which pins the
 * set of `apps/*&#47;tests.py` modules and floors the number of tests collected from
 * them, because `pytest.ini` losing `tests.py` from `python_files` would take
 * several hundred tests out of the run and leave the suite green. The frontend
 * had no counterpart. `jest.config.js`'s `testMatch` is the same single point of
 * failure, and a file that stops matching it does not fail — it stops existing,
 * which is not a state a test run reports.
 *
 * The general rule this is an instance of: **pin the subject set, not the
 * parse.** A check that scans for offenders is clean when it scans nothing, so
 * "did the scanner find something" is the wrong question — finding nothing is
 * the passing state. What has to be asserted is that the set being examined is
 * the set we believe is being examined. Every contract test in this directory
 * that derives its subject from a scan already carries a floor of its own
 * (`SOURCE_FILES.length > 30` in domainDisplayContract, `OBJECT_CONSTS.length >
 * 40` in statusTokenLayering, `CIV_PREFIXES.length > 1` in
 * civilizationColourContract). This file is the floor for the layer above them:
 * the files themselves.
 *
 * WHAT THIS DOES NOT CATCH, said plainly because the failure mode of a file
 * like this is reading as more complete than it is. It counts `it(` / `test(`
 * *declarations* by regex, not tests. An `it.each` whose list goes empty keeps
 * its declaration and contributes zero tests, and nothing here would notice.
 * That case is covered per-file by the floors named above, on the lists those
 * `each` calls are fed from — which is where it belongs, because only the file
 * that owns the list knows how long it should be.
 */

// Every test file jest collects, pinned by name.
//
// A count would be weaker in the specific way that matters: adding one file and
// deleting another in the same change nets to zero and passes, which is exactly
// the edit where a file goes missing without anyone deciding it should. The list
// is the record of a deliberate set; adding a test file means adding a line
// here, and removing one means removing a line here on purpose.
const COLLECTED_FILES = [
  "ActorsPage.test.tsx",
  "AppLayout.test.tsx",
  "AuditPage.test.tsx",
  "Badge.test.tsx",
  "Button.test.tsx",
  "CommentThread.test.tsx",
  "CorpusPage.test.tsx",
  "DashboardPage.test.tsx",
  "DataGrid.test.tsx",
  "DataTable.test.tsx",
  "EmptyState.test.tsx",
  "Field.test.tsx",
  "I18nContext.formatters.test.tsx",
  "I18nContext.test.tsx",
  "IconPicker.test.tsx",
  "JudgmentGroundsPanel.test.tsx",
  "JudgmentQueueConsole.test.tsx",
  "LedgerPage.test.tsx",
  "Modal.test.tsx",
  "NotificationsPage.test.tsx",
  "PageError.test.tsx",
  "PageShell.test.tsx",
  "Pagination.test.tsx",
  "PermissionDenied.test.tsx",
  "PermissionFormModal.test.tsx",
  "PermissionsMatrixDiff.test.ts",
  "PostCard.test.tsx",
  "permissionGatesActuallyWithhold.test.tsx",
  "ProfileCard.test.tsx",
  "RebirthFormSelect.test.tsx",
  "RequireButton.test.tsx",
  "RequirePermission.test.tsx",
  "RoleFormModal.test.tsx",
  "SettingsDrawer.test.tsx",
  "Skeleton.test.tsx",
  "SoulDetailPage.inheritance.test.tsx",
  "SoulDetailPage.rebirthForm.test.tsx",
  "SoulEditModal.test.tsx",
  "SoulLedgerBook.test.tsx",
  "SoulLifecycleTimeline.test.tsx",
  "SoulReadingPanel.test.tsx",
  "SoulReadingPanelFork.test.tsx",
  "SoulReadingPanelSentence.test.tsx",
  "Spinner.test.tsx",
  "TenantContext.test.tsx",
  "Toast.test.tsx",
  "UserDeleteDialog.test.tsx",
  "WebSocketContext.test.tsx",
  "WelcomePage.test.tsx",
  "WorkflowEditor.test.tsx",
  "WorkflowPage.instances.test.tsx",
  "WorkflowPage.test.tsx",
  "accessTokenNeverBecomesACookie.test.ts",
  "api.test.ts",
  "auditGrouping.test.ts",
  "chartColourContract.test.ts",
  "civilizationColourContract.test.ts",
  "civilizationCopyCoverage.test.ts",
  "civilizationMapCoverage.test.ts",
  "civilizationSigilContract.test.ts",
  "connectionRecovery.test.tsx",
  "cssTokenReferenceContract.test.ts",
  "dispatchApproveConfirms.test.tsx",
  "dataGridToneContract.test.ts",
  "designGuardContract.test.ts",
  "domainDisplayContract.test.tsx",
  "domainDisplayRendering.test.tsx",
  "domainNamespaceContract.test.ts",
  "drawerFocusTrap.test.tsx",
  "eventInvalidationReachesCache.test.ts",
  "eventRegistry.test.ts",
  "errorIsNotAnEmptyState.test.ts",
  "focusRingContract.test.ts",
  "gridPopupKeyboardContract.test.tsx",
  "inkOnSurfaceContract.test.ts",
  "ledgerQuantityContract.render.test.tsx",
  "messageValuesAreNotTheirOwnKeys.test.ts",
  "middlewareAuthGate.test.ts",
  "ledgerQuantityContract.test.tsx",
  "presetNodeTypes.test.tsx",
  "readingQuantityContract.test.tsx",
  "setup.test.ts",
  "socialWsClient.test.ts",
  "soulLifecycleEventCopy.test.tsx",
  "soulLifecycleRows.test.ts",
  "soulMutationFeedback.test.tsx",
  "soulReadingCopyCoverage.test.tsx",
  "statusTokenLayering.test.ts",
  "suiteShape.test.ts",
  "tenantSignalContract.test.tsx",
  "useDispositions.test.ts",
  "useJudgmentQueue.test.tsx",
  "useJudgments.test.ts",
  "usePermissions.test.ts",
  "useReincarnation.test.ts",
  "useSidebarMenus.test.tsx",
  "useSocial.queries.test.ts",
  "useSocial.test.ts",
  "useSouls.lifecycle.test.ts",
  "useSouls.test.ts",
  "viewportHeightContract.test.ts",
  "workflowTemplateLore.test.ts",
  "wsClient.reconnect.test.ts",
  "wsClient.test.ts",
];

/** Floor, not a pin — `it.each` makes the real test count larger and it moves
 *  whenever a table grows. Lower it deliberately, with the reason, if a block of
 *  tests is genuinely retired. */
const MIN_DECLARATIONS = 900;

const TESTS_DIR = path.join(__dirname);

function collect(dir: string, out: string[] = [], base = dir): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out, base);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

const PRESENT = collect(TESTS_DIR).sort();

describe("the suite is the suite we think it is", () => {
  it("collects exactly the files this list names", () => {
    // `testMatch` is `**&#47;__tests__&#47;**&#47;*.test.ts(x)`. A file renamed to `.spec.tsx`,
    // moved out of `__tests__/`, or given a name the glob no longer matches
    // stops running without failing — the suite reports one fewer file and
    // nothing reports that as a problem.
    expect(PRESENT).toEqual([...COLLECTED_FILES].sort());
  });

  it("finds a non-trivial number of them, so the walk itself is doing something", () => {
    // The guard for the guard. If `collect` returned `[]` the assertion above
    // would compare two empty lists on the day COLLECTED_FILES was also
    // emptied, and this file would be the thing it exists to prevent.
    expect(PRESENT.length).toBeGreaterThan(50);
  });

  it("gives every collected file at least one test to run", () => {
    // A file that collects and declares nothing is invisible in a run summary:
    // it contributes a passing suite with zero tests. Everything that used to
    // be in it is simply not being asserted any more.
    const empty = PRESENT.filter((file) => {
      const source = readFileSync(path.join(TESTS_DIR, file), "utf8");
      return !/(?:^|\n)\s*(?:it|test)(?:\.each\([\s\S]*?\))?\s*\(/.test(source);
    });
    expect(empty).toEqual([]);
  });

  it("declares at least as many tests as it used to", () => {
    // Catches the shape the file list cannot: a `describe` block deleted, or an
    // early `return` inside one, leaving the file present and most of its
    // assertions gone.
    const declarations = PRESENT.reduce((total, file) => {
      const source = readFileSync(path.join(TESTS_DIR, file), "utf8");
      return total + (source.match(/(?:^|\n)\s*(?:it|test)(?:\.each\([\s\S]*?\))?\s*\(/g) ?? []).length;
    }, 0);
    expect(declarations).toBeGreaterThanOrEqual(MIN_DECLARATIONS);
  });

  it("runs the whole of every file — no .only, no .skip", () => {
    // `.only` is the dangerous one. It does not fail: jest runs the one test,
    // reports the rest as skipped, and exits green. A summary reading
    // "1 passed, 40 skipped" is the same colour as one reading "41 passed", and
    // it is the shape most likely to be committed by accident, because it is
    // what you write while debugging.
    const offenders: string[] = [];
    for (const file of PRESENT) {
      const source = readFileSync(path.join(TESTS_DIR, file), "utf8");
      for (const match of source.matchAll(/\b(?:it|test|describe)\.(only|skip)\s*\(/g)) {
        offenders.push(`${file}: .${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never stubs the permission gate itself", () => {
    // Three suites used to carry this:
    //
    //     jest.mock("@/src/components/rbac/RequirePermission", () => ({
    //       RequirePermission: ({ children }) => children,
    //     }));
    //
    // The stub ignores the `permissions` prop and renders children
    // unconditionally, so inside those files a gate could be **deleted
    // outright** — or pointed at a codename that does not exist — and all
    // 1689 tests stayed green. Verified, not assumed: removing
    // `<RequirePermission permissions="soul.delete">` from SoulHeaderActions
    // failed nothing until `permissionGatesActuallyWithhold.test.tsx` existed.
    //
    // E2E does not compensate. `e2e/fixtures.ts` authenticates as ADMIN, and
    // `usePermissions` returns true for ADMIN before it reads the string — on
    // that path a gate and its absence are behaviourally identical.
    //
    // The rule is the whole module, not "the passthrough shape". A stub that
    // does consult the prop is a reimplementation of the thing under test, and
    // the repo has already been bitten by a stub that reproduced the defect it
    // was standing in for (see docs/design-handoff/BRIEF.md §4.6 on the
    // `DomainEnum` stub). Mock `@/src/contexts/TenantContext` instead and let
    // the real gate run — that is what the three suites do now.
    // 逐行判断,不用正则:这份文件和那份守卫都在**注释里**引用了那段桩代码,
    // 而注释行以 `//` 或 ` * ` 开头。第一版用正则扫全文,把两份说明这条规则的
    // 文件自己报成了违规者 —— 一个连自己的文档都读成违规的扫描器,说明它读的
    // 不是代码。
    const offenders = PRESENT.filter((file) =>
      readFileSync(path.join(TESTS_DIR, file), "utf8")
        .split("\n")
        .some(
          (line) =>
            line.trimStart().startsWith("jest.mock(") &&
            line.includes("rbac/RequirePermission")
        )
    );
    expect(offenders).toEqual([]);
  });
});
