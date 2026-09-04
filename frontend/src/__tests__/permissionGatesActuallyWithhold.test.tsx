/**
 * 每一道 `<RequirePermission>` 真的**扣住**了它包着的东西。
 *
 * WHY THIS FILE EXISTS。灵魂详情的三个套件里都有这一行:
 *
 *     jest.mock("@/src/components/rbac/RequirePermission", () => ({
 *       RequirePermission: ({ children }) => children,
 *     }));
 *
 * 那个桩**不看 `permissions` 这个 prop**,永远渲染 children。于是在这三个文件
 * 覆盖到的组件里:
 *
 *   - 把 `<RequirePermission permissions="soul.delete">` 整个删掉  → 1689 条全绿
 *   - 把它改成 `permissions="banana.split"`(一个不存在的码名)   → 1689 条全绿
 *
 * E2E 也补不上这一层:`e2e/fixtures.ts` 以 ADMIN 登录,而 `usePermissions` 对
 * ADMIN 直接短路成 true —— 那条路径下,门有没有、门上写的什么,行为完全一样。
 *
 * WHAT THIS FILE DOES DIFFERENTLY。这里不桩 `RequirePermission`,桩的是它下面
 * 那层 `useTenant`。真实的门组件跑起来,真实的 `usePermissions` 去查那份权限
 * 数组。每一道门都断言**两次**:
 *
 *   缺权限 → 控件不在 DOM 里(这一半才抓得住「门被删了」)
 *   有权限 → 控件在(正对照。没有它,一个「什么都不渲染」的组件同样满足上一半)
 *
 * 用户身份一律是非 ADMIN(GUARDIAN),因为 ADMIN 短路会让整份文件变成
 * 一组永远为真的断言 —— 这正是 e2e 现在的处境。
 */
import { fireEvent, render, screen } from "@testing-library/react";

import { makeTranslateWithFallback } from "@/src/contexts/I18nContext";

import { DateProblemsPanel } from "@/src/components/souls/DateProblemsPanel";
import { SoulActionsCard } from "@/src/components/souls/detail/SoulActionsCard";
import { SoulHeaderActions } from "@/src/components/souls/detail/SoulHeaderActions";
import { SoulLifecycleTimeline } from "@/src/components/souls/SoulLifecycleTimeline";
import type { Soul } from "@soulledger/core/api/souls";

let grantedPermissions: string[] = [];

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    user: {
      id: 1,
      username: "guardian",
      display_name: "Guardian",
      email: "g@example.com",
      // 刻意不是 ADMIN。见文件头。
      role: "GUARDIAN",
      tenant: null,
      permissions: grantedPermissions,
    },
  }),
}));

// `t` echoes the key, which is exactly what the real `t` does for a key no
// bundle carries — so `tf` takes its fallback branch and the 「更多操作」 gate
// below finds the literal written in SoulHeaderActions.
//
// `tf` is the REAL helper applied to that `t` (`requireActual`, so the spread
// also keeps every other export of the module alive), not a second
// implementation of it. A double that re-derives the thing under test is how a
// broken fallback stays green. One frozen object, not a fresh one per call.
const mockT = (key: string) => key;
const mockI18n = {
  t: mockT,
  tf: makeTranslateWithFallback(mockT),
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const noop = () => {};

function soul(overrides: Partial<Soul> = {}): Soul {
  return {
    id: "soul-1",
    name: "Test Soul",
    civilization: "CHINESE",
    current_state: "ALIVE",
    birth_date: null,
    death_date: null,
    date_problems: [],
    origin_location: "",
    description: "",
    ...overrides,
  } as Soul;
}

/** 一道门 = 一个渲染函数 + 一个码名 + 一个只在门开时出现的可访问名。 */
interface Gate {
  /** 出现在失败信息里的名字。 */
  what: string;
  /** 守这道门的码名,与源码里写的那个字符串逐字相同。 */
  codename: string;
  render: () => void;
  /** 门开时能找到、门关时找不到的东西。 */
  find: () => HTMLElement | null;
}

const GATES: Gate[] = [
  {
    what: "灵魂详情页头部的「编辑」",
    codename: "soul.update",
    render: () =>
      render(
        <SoulHeaderActions
          onEdit={noop}
          onDelete={noop}
          isOverflowMenuOpen={false}
          setIsOverflowMenuOpen={noop}
        />
      ),
    find: () => screen.queryByText("souls.detail.edit"),
  },
  {
    what: "灵魂详情页头部的溢出菜单(删除住在里面)",
    codename: "soul.delete",
    render: () =>
      render(
        <SoulHeaderActions
          onEdit={noop}
          onDelete={noop}
          isOverflowMenuOpen={false}
          setIsOverflowMenuOpen={noop}
        />
      ),
    find: () => screen.queryByRole("button", { name: "更多操作" }),
  },
  {
    what: "操作卡的「标记身故」",
    codename: "soul.die",
    render: () =>
      render(
        <SoulActionsCard
          soul={soul({ current_state: "ALIVE" })}
          loading={false}
          actionLoading=""
          dispositions={[]}
          reincarnations={[]}
          rebirthForm="HUMAN"
          onRebirthFormChange={noop}
          onDie={noop}
          onStartJudgment={noop}
          onReincarnate={noop}
        />
      ),
    find: () => screen.queryByText("souls.detail.mark_dead"),
  },
  {
    what: "操作卡的「发起审判」",
    codename: "judgment.create",
    render: () =>
      render(
        <SoulActionsCard
          soul={soul({ current_state: "JUDGING" })}
          loading={false}
          actionLoading=""
          dispositions={[]}
          reincarnations={[]}
          rebirthForm="HUMAN"
          onRebirthFormChange={noop}
          onDie={noop}
          onStartJudgment={noop}
          onReincarnate={noop}
        />
      ),
    find: () => screen.queryByText("souls.detail.start_judgment"),
  },
  {
    what: "日期问题面板的「知悉」",
    codename: "soul.update",
    render: () => {
      render(
        <DateProblemsPanel
          soulId="soul-1"
          soulProblems={[]}
          records={[
            {
              id: "rec-1",
              record_type: "EVENT",
              title: "身后事",
              date_problems: [
                {
                  code: "event_after_death",
                  severity: "warning",
                  message: "事件晚于死亡",
                },
              ],
            } as never,
          ]}
          onChanged={noop}
        />
      );
      // 分组默认是折叠的,得先展开才谈得上「按钮在不在」。
      // 这一步是正对照逼出来的:没有它,阴性那一半也会通过 —— 通过的理由是
      // 「面板折叠着」,而不是「权限门扣住了它」。一个因为错误的理由而绿的
      // 断言,和一个不存在的断言等价。
      fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]);
    },
    find: () => screen.queryByText("souls.detail.date_problems.acknowledge"),
  },
];

describe("权限门真的扣住了东西", () => {
  afterEach(() => {
    grantedPermissions = [];
  });

  describe.each(GATES.map((g, i) => [i, g] as const))(
    "%s",
    (_i, gate) => {
      it(`${gate.what} — 没有 ${gate.codename} 时不渲染`, () => {
        // 给一个不相干的权限而不是空数组:空数组下,一个「权限列表为空就
        // 什么都不显示」的实现也能过,而那不是这里要守的东西。
        grantedPermissions = ["some.unrelated.codename"];
        gate.render();
        expect(gate.find()).not.toBeInTheDocument();
      });

      it(`${gate.what} — 有 ${gate.codename} 时渲染(正对照)`, () => {
        grantedPermissions = [gate.codename];
        gate.render();
        expect(gate.find()).toBeInTheDocument();
      });
    }
  );
});

describe("时间轴上的审判入口", () => {
  /** 单独一段:这道门要先有一条未结的审判才会出现,构造成本比上面那批高。 */
  function renderTimeline() {
    render(
      <SoulLifecycleTimeline
        soul={soul({ current_state: "JUDGING" })}
        judgments={[
          {
            id: "j-1",
            soul: "soul-1",
            status: "PENDING",
            verdict: null,
            created_at: "2026-01-01T00:00:00Z",
          } as never,
        ]}
        dispositions={[]}
        reincarnations={[]}
        events={[]}
        ledgerRecords={[]}
        onOpenJudgmentQueue={noop}
      />
    );
  }

  it("没有 judgment.create 时,「在审判队列中打开」不在 DOM 里", () => {
    grantedPermissions = ["some.unrelated.codename"];
    renderTimeline();
    expect(screen.queryByText("在审判队列中打开")).not.toBeInTheDocument();
  });

  it("有 judgment.create 时它在(正对照)", () => {
    grantedPermissions = ["judgment.create"];
    renderTimeline();
    expect(screen.getByText("在审判队列中打开")).toBeInTheDocument();
  });
});
