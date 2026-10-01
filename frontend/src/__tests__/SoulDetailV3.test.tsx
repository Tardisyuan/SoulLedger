/**
 * v3 灵魂详情(app/souls/[id]/page.tsx)新加的几块:页头首字与功 / 过 / 承自前世、右栏「功过」、
 * 账页的两个标签、身份栏的本名与生平描述、「全部审判」每行的「查看」,以及 PageShell 的首格 / 尾格。
 *
 * 真 I18nProvider(默认 zh-Hans),不用回显键的替身 —— 断言的是读者看到的字。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Judgment, Soul } from "@soulledger/core/api";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { SoulBalance, SoulHeadingFigures, SoulMonogram } from "@/src/components/souls/detail/SoulFigures";
import { SoulLedgerTabs } from "@/src/components/souls/detail/SoulLedgerTabs";
import { SoulInfoCard } from "@/src/components/souls/detail/SoulInfoCard";
import { SoulJudgmentHistory } from "@/src/components/souls/detail/SoulLedgerSections";
import { PageShell } from "@/src/components/ui/PageShell";

const SOUL = {
  id: "s1",
  name: "沈砚之",
  birth_name: "沈小砚",
  civilization: "CHINESE",
  current_state: "JUDGING",
  birth_date: null,
  death_date: null,
  origin_location: "杭州",
  description: "一生行医,不取穷人分文。",
  merit_score: 1842,
  demerit_score: 391,
  karmic_balance: 1451,
  life_index: 3,
  inherited_merit: 120,
  inherited_demerit: 34,
  date_problems: [],
  is_eval_identity: false,
} as unknown as Soul;

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("页头首字", () => {
  it("取名字的第一个字,装饰性(aria-hidden),不用文明色", () => {
    wrap(<SoulMonogram name="沈砚之" />);
    const mono = screen.getByTestId("soul-monogram");
    expect(mono).toHaveTextContent(/^沈$/);
    expect(mono).toHaveAttribute("aria-hidden", "true");
    expect(mono.className).not.toMatch(/--color-(main|civ)/);
  });

  it("没有名字就不画一个空方块", () => {
    wrap(<SoulMonogram name="  " />);
    expect(screen.queryByTestId("soul-monogram")).toBeNull();
  });
});

describe("页头功 / 过 / 承自前世", () => {
  it("功与过各是一个数,读 Soul 自己的分;第二世起才有承自前世", () => {
    wrap(<SoulHeadingFigures soul={SOUL} />);
    const dl = screen.getByTestId("soul-heading-figures");
    const cells = within(dl).getAllByRole("definition");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveTextContent("1842");
    expect(cells[1]).toHaveTextContent("391");
    expect(cells[2]).toHaveTextContent(/功\s*120.*过\s*34/);
    expect(within(dl).getByText("承自前世")).toBeInTheDocument();
    // 不相抵:余额(1451)不出现在页头。
    expect(dl).not.toHaveTextContent("1451");
  });

  it("第一世不画承自前世那一格", () => {
    wrap(<SoulHeadingFigures soul={{ ...SOUL, life_index: 0 }} />);
    expect(within(screen.getByTestId("soul-heading-figures")).getAllByRole("definition")).toHaveLength(2);
    expect(screen.queryByText("承自前世")).toBeNull();
  });

  it("VIEWER 拿不到分数:整块不画,也不画「尚未记录」", () => {
    const viewer = { ...SOUL, merit_score: null, demerit_score: null } as unknown as Soul;
    const { container } = wrap(
      <>
        <SoulHeadingFigures soul={viewer} />
        <SoulBalance soul={viewer} />
      </>
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("右栏「功过」", () => {
  it("功、过两个数,不算余额;带 #soul-karma 锚点", () => {
    wrap(<SoulBalance soul={SOUL} />);
    const aside = screen.getByTestId("soul-balance");
    expect(aside).toHaveAttribute("id", "soul-karma");
    expect(within(aside).getByRole("heading", { name: "功过" })).toBeInTheDocument();
    expect(aside).toHaveTextContent("1842");
    expect(aside).toHaveTextContent("391");
    expect(aside).not.toHaveTextContent("1451");
  });
});

describe("账页的两个标签", () => {
  const tabs = () =>
    wrap(
      <SoulLedgerTabs
        judgmentCount={2}
        recordCount={7}
        judgments={<p>审判那一页</p>}
        records={<p>功过那一页</p>}
      />
    );

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("默认是「全部审判」,另一页只是隐藏、不卸载", () => {
    tabs();
    expect(screen.getByRole("tab", { name: /全部审判/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /全部功过记录/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("审判那一页")).toBeVisible();
    expect(screen.getByText("功过那一页")).not.toBeVisible();
  });

  it("点击与方向键都能换页,焦点跟着走", () => {
    tabs();
    fireEvent.click(screen.getByRole("tab", { name: /全部功过记录/ }));
    expect(screen.getByText("功过那一页")).toBeVisible();
    expect(screen.getByText("审判那一页")).not.toBeVisible();

    fireEvent.keyDown(screen.getByRole("tab", { name: /全部功过记录/ }), { key: "ArrowRight" });
    const first = screen.getByRole("tab", { name: /全部审判/ });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveFocus();
  });

  it("带着 #soul-karma 进来(功过总账的链接)就打开「全部功过记录」", () => {
    window.history.replaceState(null, "", "/souls/s1#soul-karma");
    tabs();
    expect(screen.getByRole("tab", { name: /全部功过记录/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("功过那一页")).toBeVisible();
  });

  it("选中标是墨色下划线,不是文明色", () => {
    tabs();
    const selected = screen.getByRole("tab", { selected: true });
    expect(selected.className).toContain("--color-ink");
    expect(selected.className).not.toMatch(/--color-(main|civ)/);
  });
});

describe("身份栏", () => {
  it("写本名与生平描述;生平描述不用衬线(那是官员写的,不是本人说的)", () => {
    wrap(<SoulInfoCard soul={SOUL} loading={false} birthDisplay={null} deathDisplay={null} />);
    const section = screen.getByTestId("soul-identity");
    expect(within(section).getByText("本名")).toBeInTheDocument();
    expect(within(section).getByText("沈小砚")).toBeInTheDocument();
    expect(within(section).getByRole("heading", { name: "生平描述" })).toBeInTheDocument();
    const desc = screen.getByTestId("soul-description");
    expect(desc).toHaveTextContent("一生行医,不取穷人分文。");
    expect(section.querySelector(".font-serif")).toBeNull();
  });

  it("没写生平描述就是「尚未记录」,不是空白", () => {
    wrap(<SoulInfoCard soul={{ ...SOUL, description: "" }} loading={false} birthDisplay={null} deathDisplay={null} />);
    expect(screen.getByTestId("soul-description").querySelector('[data-missing="unrecorded"]')).not.toBeNull();
  });
});

describe("「全部审判」的每一行", () => {
  const j = (id: string, over: Partial<Judgment> = {}) =>
    ({
      id,
      soul: "s1",
      soul_name: "沈砚之",
      civilization: "CHINESE",
      judge: null,
      judge_name: "秦广王",
      court: "第一殿",
      evidence_json: {},
      confession: "",
      verdict: null,
      notes: "",
      citations: [],
      is_final: false,
      created_at: "2026-06-01T00:00:00Z",
      concluded_at: null,
      ...over,
    }) as Judgment;

  it("「查看」链到那一份判决", () => {
    wrap(<SoulJudgmentHistory judgments={[j("j1"), j("j2", { created_at: "2026-07-01T00:00:00Z" })]} />);
    const links = screen.getAllByRole("link", { name: "查看" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/judgment/j2", "/judgment/j1"]);
  });

  it("一份都没有时说没有,不画空表", () => {
    wrap(<SoulJudgmentHistory judgments={[]} />);
    expect(screen.getByText("暂无审判记录")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-judgment-row")).toBeNull();
  });
});

describe("PageShell 的首格与尾格", () => {
  it("给了才渲染,并且都在页头里", () => {
    const { container } = render(
      <PageShell title="沈砚之" leading={<span>首</span>} aside={<span>尾</span>}>
        body
      </PageShell>
    );
    const header = container.querySelector("[data-page-shell-header]")!;
    expect(header.querySelector("[data-page-shell-leading]")).toHaveTextContent("首");
    expect(header.querySelector("[data-page-shell-aside]")).toHaveTextContent("尾");
  });

  it("不给就没有那层 flex 包装 —— 其他页面的页头 DOM 一个节点都不变", () => {
    const { container } = render(<PageShell title="判决卷宗">body</PageShell>);
    expect(container.querySelector("[data-page-shell-leading], [data-page-shell-aside]")).toBeNull();
    const inner = container.querySelector("[data-page-shell-header]")!.firstElementChild!;
    // 宽度盒子的第一个孩子仍是标题行,不是新加的包装。
    expect(inner.firstElementChild!.querySelector("h1")).toHaveTextContent("判决卷宗");
    expect(inner.firstElementChild!.className).toBe("flex items-start gap-4");
  });
});
