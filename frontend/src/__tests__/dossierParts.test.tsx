/**
 * 卷宗页的三件(Design 第三十批 第 3 步):脊的「现在」、四种印(+ 虚线预览)、功过记号。
 * 脊上 metal 只有一处,而且就在数据说的那一站;印的地府四字随殿变;记号靠形状分功过,颜色只上数字。
 */
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { spineNow } from "@/src/components/dossier/spineModel";
import { DossierSpine } from "@/src/components/dossier/DossierSpine";
import { DossierSeal } from "@/src/components/dossier/DossierSeal";
import { MeritMark, SignedNumber } from "@/src/components/dossier/MeritMark";

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("spineNow:脊上的「现在」由数据定", () => {
  it.each([
    [{ civilization: "CHINESE", diyuStation: "TUDI_TEMPLE" }, { civ: "cn", at: "pre", n: 1 }],
    [{ civilization: "CHINESE", diyuStation: "FENGDU_CITY", court: "第五殿" }, { civ: "cn", at: "hall", n: 5 }],
    [{ civilization: "CHINESE", currentState: "JUDGING", court: "Third Court" }, { civ: "cn", at: "hall", n: 3 }],
    [{ civilization: "CHINESE", diyuStation: "EIGHTEEN_HELLS", court: "第九殿" }, { civ: "cn", at: "hell", n: 9 }],
    [{ civilization: "CHINESE", currentState: "REINCARNATING" }, { civ: "cn", at: "rebirth" }],
    [{ civilization: "EUROPEAN", realmCode: "EU_HELL_7TH" }, { civ: "eu", at: "circle", n: 7 }],
    [{ civilization: "EUROPEAN", currentState: "JUDGING" }, { civ: "eu", at: "gate" }],
    [{ civilization: "EGYPTIAN", realmCode: "EG_HALL_TWO_TRUTHS" }, { civ: "eg", at: "scale" }],
    [{ civilization: "EGYPTIAN", realmCode: "EG_DEVOURER" }, { civ: "eg", at: "annihilation" }],
    [{ civilization: "EGYPTIAN", realmCode: "EG_AARU" }, { civ: "eg", at: "aaru" }],
    [{ civilization: "GREEK", realmCode: "GR_ASPHODEL_MEADOW" }, { civ: "gr", at: "asphodel" }],
    [{ civilization: "GREEK", currentState: "JUDGING" }, { civ: "gr", at: "fork" }],
  ])("%o → %o", (input, now) => {
    expect(spineNow(input)).toEqual(now);
  });

  it("认不出就没有「现在」,不猜一个位置", () => {
    expect(spineNow({ civilization: "CHINESE", currentState: "ALIVE" })).toBeNull();
    expect(spineNow({ civilization: "EUROPEAN", realmCode: "EU_HEAVEN" })).toBeNull();
    expect(spineNow({ civilization: "UNKNOWN" })).toBeNull();
  });
});

describe("DossierSpine", () => {
  it("全图只有一处「现在」(metal),在数据说的那一站;没有「现在」就一处都没有", () => {
    const { container, rerender } = wrap(<DossierSpine civ="cn" now={{ civ: "cn", at: "hall", n: 5 }} />);
    expect(screen.getAllByTestId("spine-now")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "地府 · 十殿一线" })).toBeInTheDocument();
    // 第五殿那一格是 metal 的字;第一殿不是。
    const numerals = [...container.querySelectorAll("text")].filter((n) => n.textContent === "五" || n.textContent === "一");
    expect(numerals.find((n) => n.textContent === "五")?.getAttribute("class")).toMatch(/nowText/);
    expect(numerals.find((n) => n.textContent === "一")?.getAttribute("class")).not.toMatch(/nowText/);

    rerender(
      <I18nProvider>
        <DossierSpine civ="eu" now={null} />
      </I18nProvider>
    );
    expect(screen.queryAllByTestId("spine-now")).toHaveLength(0);
  });

  it.each([
    ["eu", { civ: "eu", at: "gate" }, "欧洲 · 九圈漏斗"],
    ["eu", { civ: "eu", at: "circle", n: 3 }, "欧洲 · 九圈漏斗"],
    ["eg", { civ: "eg", at: "scale" }, "埃及 · 称心二分"],
    ["eg", { civ: "eg", at: "annihilation" }, "埃及 · 称心二分"],
    ["gr", { civ: "gr", at: "tartarus" }, "希腊 · 三岔分路"],
  ] as const)("%s %o:一处「现在」,读屏名是那家的脊", (civ, now, name) => {
    wrap(<DossierSpine civ={civ} now={now} />);
    expect(screen.getAllByTestId("spine-now")).toHaveLength(1);
    expect(screen.getByRole("img", { name })).toBeInTheDocument();
  });
});

describe("DossierSeal", () => {
  it("地府方印的四个字随殿变,右起竖读;不知道第几殿是「冥府之印」", () => {
    const { container, rerender } = wrap(<DossierSeal civ="cn" hall={5} />);
    expect([...container.querySelectorAll("text")].map((n) => n.textContent)).toEqual(["第", "五", "殿", "印"]);
    rerender(
      <I18nProvider>
        <DossierSeal civ="cn" hall={null} />
      </I18nProvider>
    );
    expect([...container.querySelectorAll("text")].map((n) => n.textContent)).toEqual(["冥", "府", "之", "印"]);
  });

  it("虚线预览与实印是两枚,读屏分得开;实印刚落下时才带落印动效", () => {
    const { rerender } = wrap(<DossierSeal civ="gr" pending />);
    expect(screen.getByTestId("dossier-seal-pending")).toHaveAccessibleName("希腊 · 陶片 · 待落印");
    rerender(
      <I18nProvider>
        <DossierSeal civ="gr" stamp />
      </I18nProvider>
    );
    expect(screen.getByTestId("dossier-seal")).toHaveAccessibleName("希腊 · 陶片");
    expect(screen.getByTestId("dossier-seal").getAttribute("class")).toMatch(/stampIn/);
  });
});

describe("MeritMark", () => {
  it.each([
    ["CHINESE", "功", "过"],
    ["EUROPEAN", "德", "罪"],
    ["EGYPTIAN", "羽", "心"],
    ["GREEK", "白票", "黑票"],
  ])("%s:功是「%s」,过是「%s」,两枚形状不同", (civ, merit, demerit) => {
    wrap(
      <>
        <MeritMark civilization={civ} kind="merit" />
        <MeritMark civilization={civ} kind="demerit" />
      </>
    );
    const m = screen.getByRole("img", { name: merit });
    const d = screen.getByRole("img", { name: demerit });
    // 形状不同:描线 vs 实底(地府是同一个框,过字实底 —— class 不同)。
    expect(m.innerHTML + m.getAttribute("class")).not.toBe(d.innerHTML + d.getAttribute("class"));
    expect(m.getAttribute("data-mark")).toMatch(/-merit$/);
    expect(d.getAttribute("data-mark")).toMatch(/-demerit$/);
  });

  it("颜色只上数字,数字一律带号;0 不上色", () => {
    const { container } = wrap(
      <>
        <SignedNumber value={9} sign={1} />
        <SignedNumber value={17} sign={-1} />
        <SignedNumber value={0} />
      </>
    );
    const spans = [...container.querySelectorAll("span")];
    expect(spans.map((s) => s.textContent)).toEqual(["+9", "−17", "0"]);
    expect(spans[0].className).toMatch(/pos/);
    expect(spans[1].className).toMatch(/neg/);
    expect(spans[2].className).not.toMatch(/pos|neg/);
  });
});
