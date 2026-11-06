/**
 * 演示站的灵魂入口(v4 第十批第 1 条)读一份录制,照 App 的样子画几屏。这里给它一份手写的录制(欧洲、炼狱第三台、
 * 调拨来的第二世),看它读到的地方与 App 的 `soulRoute` 一致,这一世写「此生 · 此前另有 1 世」,锁屏有实时进度;
 * 没录到的灵魂写「未记录」而不是一份空档案。
 */
import { render, screen } from "@testing-library/react";
import zh from "@soulledger/core/messages/zh-Hans.json";

import { I18nProvider } from "@/src/contexts/I18nContext";
import { REBIRTH_CIVS, SoulScreenBody, soulView } from "@/demo/DemoSoulScreens";
import type { Recording } from "@/demo/store";

const tZh = (key: string, params: Record<string, string> = {}) => {
  let cur: unknown = zh;
  for (const seg of key.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[seg];
  return typeof cur === "string" ? cur.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? "") : key;
};

const ME = {
  name: "Tristan", soul_code: "TRS 3T4N 9EU", civilization: "EUROPEAN", current_state: "DISPOSED",
  merit_score: 62, demerit_score: 30, account: { cycle: 1 }, european_vestibule: false,
};
const PLAN = {
  state: "serving", rebirth_open: false,
  stations: [{
    id: "s1", n: 1, status: "active", is_home: true, civilization: "EUROPEAN",
    realm: { realm_code: "EU_PURGATORY_T3_WRATH", name_local: "", name_zh: "", name_en: "" },
    sentence_years: 7, is_eternal: false, started_on: "2026-01-01", ends_on: "2033-01-01", elapsed_years: null,
  }],
};
const recording = (docs: Recording["docs"]): Recording =>
  ({ role: "judge", lang: "zh", recordedAt: "2026-11-06T00:00:00Z", login: { user: {} }, lists: {}, docs }) as Recording;
const REC = recording({ "/me/": { s: 200, b: ME }, "/me/sentence-plan/": { s: 200, b: PLAN } });

function renderScreen(screenName: "life" | "lock", rec = REC) {
  const view = soulView(rec, "eu", tZh);
  return render(
    <I18nProvider>
      <SoulScreenBody screen={screenName} view={view} civ="eu" />
    </I18nProvider>
  );
}

describe("the demo's soul screens", () => {
  it("本世: the place on the road is the app's reading, and Europe's life has no number", () => {
    renderScreen("life");
    const realm = tZh("realms.names.EU_PURGATORY_T3_WRATH");
    expect(screen.getByTestId("demo-soul-place")).toHaveTextContent(tZh("map.europe.terraces"));
    expect(screen.getByText(tZh("soul.here.eu_realm", { realm }))).toBeInTheDocument();
    expect(screen.getByText(/此生 · 此前另有 1 世/)).toBeInTheDocument();
    expect(screen.queryByText(/第 2 世/)).toBeNull();
    // Walked, here, ahead: the road is drawn with the soul on its second step.
    expect(document.querySelectorAll('[data-route-step="here"]')).toHaveLength(1);
  });

  it("the lock screen's live progress says the soul and the step", () => {
    renderScreen("lock");
    expect(screen.getByText(tZh("live.headline", { soul: "Tristan", step: tZh("map.europe.terraces") }))).toBeInTheDocument();
  });

  it("a soul not recorded says so, rather than drawing an empty profile", () => {
    renderScreen("life", recording({}));
    expect(screen.getByText(tZh("common.value.unrecorded"))).toBeInTheDocument();
    expect(screen.queryByTestId("demo-soul-life")).toBeNull();
  });

  it("转生 is a screen only where souls go round", () => {
    expect([...REBIRTH_CIVS].sort()).toEqual(["cn", "gr"]);
  });
});
