/**
 * 每个预设步骤名都判读得到一个 NodeType——漏一个就红。
 *
 * 缺陷：`workflow-templates.ts` 的 `type` 是中文步骤名而不是 NodeType 成员，
 * `app/workflow/page.tsx` 的「编辑」按钮原样映射成 `node_type`，于是
 * `POST /api/v1/workflow/templates/` 对任何被编辑保存的预设返回 400：
 *
 *     {'nodes': [{'node_type': ['"分流" is not a valid choice.']}, …]}
 *
 * 修复是 `src/config/workflow-node-types.ts` 的 `PRESET_NODE_TYPE`。一张手写的
 * 表的失败模式是**沉默**：新增一套预设、或给现有预设加一个步骤名，表不会自己
 * 长出条目，而 `nodeTypeFor` 抛错要等到有人点开那套预设的「编辑」才会发生。
 * 这个文件把那一刻提前到 CI。
 *
 * 双向断言：少一个键（漏映射）红，多一个键（步骤名改过、旧条目留着）也红——
 * 一条没有节点在用的映射是一个没人在行使的判读，下一个恰好叫这个名字的步骤会
 * 无声地继承它。同一个形状 `NODES_THAT_NAME_NO_ACTOR` 的
 * `test_the_preset_reason_table_has_no_stale_entries` 已经用过。
 */

import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkflowPage from "@/app/workflow/page";
import { workflowApi } from "@soulledger/core/api";
import { WORKFLOW_TEMPLATES } from "@soulledger/core/config/workflow-templates";
import {
  PRESET_NODE_TYPE,
  nodeTypeFor,
  type NodeTypeMember,
} from "@soulledger/core/config/workflow-node-types";

// ── the page that used to send the Chinese label ─────────────────────

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock("@soulledger/core/api", () => ({
  workflowApi: {
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
    templates: {
      list: jest.fn().mockResolvedValue({ data: [] }),
      get: jest.fn(),
      delete: jest.fn(),
    },
  },
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { role: "ADMIN" } }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    locale: "en",
    hydrated: true,
  }),
}));

// The editor is stubbed to *report what it was handed* rather than to render.
// The defect is in the payload `page.tsx` builds, so a stub that swallowed the
// payload would be the stub reproducing the bug under test — the trap
// `WorkflowPage.test.tsx` records in its own header.
jest.mock("@/src/components/charts/LazyWorkflowEditor", () => ({
  LazyWorkflowEditor: ({ initialTemplateData }: { initialTemplateData?: unknown }) => (
    <div data-testid="editor-payload">{JSON.stringify(initialTemplateData)}</div>
  ),
}));

/** `apps/workflow/models.py::NodeType.values`，后端测试逐条核对这份副本。 */
const NODE_TYPE_VALUES: NodeTypeMember[] = [
  "TRIAL",
  "EVALUATION",
  "APPEAL",
  "FINAL",
  "EXECUTION",
];

const allNodes = Object.entries(WORKFLOW_TEMPLATES).flatMap(([key, template]) =>
  template.nodes.map((node) => ({ key, node }))
);

const stepNames = [...new Set(allNodes.map(({ node }) => node.type))].sort();

describe("preset step names map onto NodeType", () => {
  it("reads every preset node, so the assertions below are not over a subset", () => {
    // 17 套预设、56 个节点。数字写死是故意的：新增一套预设必须有人来改这一行，
    // 而改这一行的人会看到下面三条断言。
    expect(Object.keys(WORKFLOW_TEMPLATES)).// EGYPTIAN_AFTERLIFE 已合并进 EGYPTIAN_ROUTINE:埃及文献里没有独立于称心之外的
    // 「按功德分流」仪轨,它的地点与两个结局逐项就是称心的(Budge《亚尼纸草》1895
    // 图版 III–IV;docs/lore-verification/verify-egyptian.md §3.3)。两套同文明同
    // case_type,`.first()` 只取得到一套,另一套在界面上可见而永远路由不到。
    toHaveLength(16);
    expect(allNodes).toHaveLength(53)  // 56 − EGYPTIAN_AFTERLIFE 的三个节点;
    expect(stepNames.length).toBeGreaterThan(0);
  });

  it("has a NodeType for every step name any preset uses", () => {
    const unmapped = stepNames.filter((step) => !(step in PRESET_NODE_TYPE));
    expect(unmapped).toEqual([]);
  });

  it("maps every step name to an actual NodeType member", () => {
    const bad = Object.entries(PRESET_NODE_TYPE).filter(
      ([, member]) => !NODE_TYPE_VALUES.includes(member)
    );
    expect(bad).toEqual([]);
  });

  it("records no mapping for a step name no preset has", () => {
    const stale = Object.keys(PRESET_NODE_TYPE)
      .filter((step) => !stepNames.includes(step))
      .sort();
    expect(stale).toEqual([]);
  });

  it("resolves every node in every preset, which is what the editor does", () => {
    // 这是「编辑」按钮真正跑的那行代码，对全部 56 个节点跑一遍。
    for (const { key, node } of allNodes) {
      expect(() => nodeTypeFor(node.type)).not.toThrow();
      expect(NODE_TYPE_VALUES).toContain(nodeTypeFor(node.type));
      // 断言不存在：没有一个节点还带着中文步骤名进入 node_type。
      expect(nodeTypeFor(node.type)).not.toBe(node.type);
      expect(`${key}:${nodeTypeFor(node.type)}`).not.toContain("审判流程");
    }
  });

  it("refuses to invent a NodeType for a step nobody classified", () => {
    // 回退到 TRIAL 会把「没人判读过」伪装成「判作 TRIAL」，也就是把这次要修的
    // 缺陷下沉一层：不再是 400，而是一条谁也没决定过的数据。
    expect(() => nodeTypeFor("某个新步骤")).toThrow(/no NodeType/);
  });
});

describe("the presets keep the Chinese step name", () => {
  it("does not replace `type` with a NodeType member", () => {
    // 步骤名比 NodeType 具体，而且 workflowTemplateLore.test.ts 直接锁定其中
    // 几个（Ammit 必须是「失败分支」，希腊三位必须是「分区审判」）。修法是加一
    // 张判读表，不是把 `type` 改写成枚举。
    for (const { node } of allNodes) {
      expect(NODE_TYPE_VALUES).not.toContain(node.type as NodeTypeMember);
    }
  });

  it("gives 分流 and 案件分类 separate step names", () => {
    // 后端 WORKFLOW_TEMPLATES 把「秦广王 · 分流」记作 TRIAL、把「案件分类」记作
    // EVALUATION。两个节点原本共用 type「分流」，一张按步骤名索引的表给不出两个
    // 答案，所以跨域流程第一步用自己的名字。
    const routine = WORKFLOW_TEMPLATES.CHINESE_ROUTINE.nodes[0];
    const crossRealm = WORKFLOW_TEMPLATES.CHINESE_CROSS_REALM.nodes[0];
    expect(routine.name).toBe("秦广王 · 分流");
    expect(crossRealm.name).toBe("案件分类");
    expect(routine.type).not.toBe(crossRealm.type);
    expect(nodeTypeFor(routine.type)).toBe("TRIAL");
    expect(nodeTypeFor(crossRealm.type)).toBe("EVALUATION");
  });
});

describe("the 编辑 button hands the editor a saveable template", () => {
  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return render(<WorkflowPage />, { wrapper: Wrapper });
  }

  beforeEach(() => {
    (workflowApi.list as jest.Mock).mockResolvedValue({ data: { results: [] } });
    (workflowApi.templates.list as jest.Mock).mockResolvedValue({ data: [] });
  });

  it("maps every node_type onto a NodeType member, not the Chinese step name", async () => {
    // CHINESE_ROUTINE 是首屏选中的预设。这一步走的是真的按钮和真的
    // onClick——不是把 page.tsx 的那行代码抄到测试里再断言抄件。
    renderPage();
    fireEvent.click(await screen.findByText("common.edit"));

    const payload = JSON.parse(
      screen.getByTestId("editor-payload").textContent as string
    ) as { nodes_json: { node_name: string; node_type: string }[] };

    expect(payload.nodes_json).toHaveLength(10);
    expect(payload.nodes_json.map((n) => n.node_type)).toEqual([
      ...Array(9).fill("TRIAL"),
      "FINAL",
    ]);
    // 断言不存在：一个中文步骤名都没有随出去。这是 POST 出去必定 400 的那个值。
    const steps = new Set(Object.keys(PRESET_NODE_TYPE));
    for (const node of payload.nodes_json) {
      expect(steps.has(node.node_type)).toBe(false);
      expect(NODE_TYPE_VALUES).toContain(node.node_type as NodeTypeMember);
    }
    // 名字与殿号照旧透传——修的是类型，不是别的。
    expect(payload.nodes_json[0].node_name).toBe("秦广王 · 分流");
    expect(payload.nodes_json[9].node_name).toBe("转轮王 · 终审");
  });
});
