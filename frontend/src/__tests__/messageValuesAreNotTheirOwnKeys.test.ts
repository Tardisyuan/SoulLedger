/**
 * 三份 bundle 里,没有哪条文案等于它自己的键。
 *
 * WHY。约 40 个前端套件把 i18n 桩成 `t: (k) => k`,其中 13 个直接断言键:
 * `WorkflowPage.test.tsx:105` 写着 `getByText("workflow.no_description")`,另有
 * WelcomePage / AuditPage / NotificationsPage / LedgerPage / JudgmentQueueConsole /
 * DataGrid / CommentThread / PostCard / ProfileCard / SoulEditModal /
 * PermissionDenied。那些断言的形状是 `key === key`,与 bundle 里写的是什么无关。
 *
 * 实证:把三份 bundle 里 `workflow.no_description` 的值都改成字面量
 * `"workflow.no_description"` —— 界面上从此显示一串键名 —— **全量 jest 1689
 * passed**。键集对齐守卫比的是三份**互相之间**,而三份被同样地改了,所以它也不响。
 *
 * 对照组说明守卫机制本身是好的:`ledger.civ.GREEK` 改成 `"GREEK"`,
 * `civilizationCopyCoverage` **红了** —— 它覆盖 `CIVILIZATION_OPTIONS` 成员在 10 个
 * 写死的命名空间里,`workflow.*` 不在其中。
 *
 * WHAT THIS ASSERTS。恰好是那次变异的逆命题:任何一条文案不得等于它自己的点号
 * 键路径,也不得是空串。这不需要知道正确的文案是什么 —— 那是翻译的事,不是守卫
 * 的事 —— 只需要知道「键名本身不是文案」。
 *
 * 它抓不到什么,说清楚:一条被改成**别的**错误文案(比如把「无描述」改成「有描述」)
 * 的键,这里照样绿。要守那一层得逐条钉写死的期望文案,而那份清单会随每次文案
 * 微调而红,最后被人整体删掉。这条守的是**退化**,不是正确性。
 */
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zh from "@soulledger/core/messages/zh-Hans.json";

type Bundle = Record<string, unknown>;

const BUNDLES: Array<[string, Bundle]> = [
  ["zh-Hans", zh as Bundle],
  ["en", en as Bundle],
  ["egy", egy as Bundle],
];

/** 把嵌套 bundle 摊成 `a.b.c` → 值。 */
function flatten(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (node && typeof node === "object" && !Array.isArray(node)) {
    return Object.entries(node as Bundle).flatMap(([k, v]) =>
      flatten(v, prefix ? `${prefix}.${k}` : k)
    );
  }
  return [];
}

describe.each(BUNDLES)("%s", (locale, bundle) => {
  const entries = flatten(bundle);

  it("摊平之后确实拿到了整份 bundle,而不是空集合", () => {
    // 守卫的守卫。`flatten` 返回 [] 时,下面两条都会以「没有违规者」通过 ——
    // 一个扫不到任何东西的扫描器,和一个什么都没扫出来的扫描器,输出一模一样。
    expect(entries.length).toBeGreaterThan(1000);
  });

  it("没有哪条文案等于它自己的键", () => {
    const identity = entries
      .filter(([key, value]) => value === key)
      .map(([key]) => `${locale}: ${key}`);
    expect(identity).toEqual([]);
  });

  it("没有哪条文案是空串", () => {
    // 空串是同一种退化的另一半:`t()` 返回空串时,界面上什么都不显示,而
    // 断言键的测试连这个都看不见 —— 它拿到的仍然是键。
    const blank = entries
      .filter(([, value]) => value.trim() === "")
      .map(([key]) => `${locale}: ${key}`);
    expect(blank).toEqual([]);
  });

  it("没有哪条带下划线的键把自己的末段当成了文案", () => {
    // 第三种形状,比整条键路径更容易被写出来:`{"no_description": "no_description"}`。
    // 它逃得过上面那条(值不等于 `workflow.no_description`),而界面上同样是
    // 一串标识符。
    //
    // 只查**含下划线**的键。不加这个限定,en 里有四条真实文案会被误报:
    // `souls.detail.records` = "records"、`users.optional` = "optional"、
    // `admin.souls` = "souls"、`admin.on` = "on" —— 它们都是正确的英文文案,
    // 只是碰巧等于键的末段。下划线是标识符特有的,正常文案里不出现,所以它把
    // 「退化成键名」和「英文词恰好同形」分得干净。
    //
    // 代价:`admin.souls` 那一类真的退化了也抓不到。这是有意选的方向 ——
    // 一个会误报四条的守卫,寿命是到下一个人把它删掉为止。
    const leaf = entries
      .filter(([key, value]) => {
        const last = key.split(".").pop() ?? "";
        return last.includes("_") && value === last;
      })
      .map(([key]) => `${locale}: ${key}`);
    expect(leaf).toEqual([]);
  });
});
