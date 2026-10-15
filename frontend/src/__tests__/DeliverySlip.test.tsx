/**
 * 登录交付单的二维码与内容(第二十批 §一.1、§三 F2)。
 *
 * 二维码库(qrcode-generator)只出矩阵、没有解码器,所以「内容是 SL1:<编号>」不能靠回读证明;
 * 这里钉的是能从矩阵上看见的东西:字母数字模式 + 纠错 M 下 14 个字符是版本 1(21×21),
 * 三个定位角的外圈全深、同一输入矩阵稳定、不同编号矩阵不同。真机扫码要在设备上手动验。
 */
import { render, screen } from "@testing-library/react";
import { QrCode, qrMatrix } from "@/src/components/print/QrCode";
import { DeliverySlip } from "@/src/components/soul-accounts/DeliverySlip";
import { SoulCode } from "@/src/components/soul-accounts/SoulCode";
import { sliceSlipTexts } from "@/src/components/soul-accounts/slipTexts";
import zhBundle from "@soulledger/core/messages/zh-Hans.json";
import enBundle from "@soulledger/core/messages/en.json";
import egyBundle from "@soulledger/core/messages/egy.json";
import { tZh } from "./support/zhBundle";

/** 官员台的界面语言:存根、剪线说明、页脚跟它走,上联不跟。 */
let mockDesk: "zh-Hans" | "en" | "egy" = "zh-Hans";
const BUNDLES = { "zh-Hans": zhBundle, en: enBundle, egy: egyBundle } as const;
const pick = (b: unknown, key: string) => key.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], b);
const tDesk = (key: string, params?: Record<string, string>) => {
  const v = pick(BUNDLES[mockDesk], key) ?? pick(zhBundle, key);
  return typeof v === "string" ? v.replace(/\{\{(\w+)\}\}/g, (w, k) => params?.[k] ?? w) : key;
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tDesk, locale: mockDesk, formatDateTime: (v: string) => `dt(${v})`, hydrated: true }),
}));
beforeEach(() => {
  mockDesk = "zh-Hans";
});

const TEXTS = { "zh-Hans": sliceSlipTexts(zhBundle), en: sliceSlipTexts(enBundle), egy: sliceSlipTexts(egyBundle) };
const HALLS: Record<string, string> = { "zh-Hans": "酆都 · 第二殿", en: "Second Court", egy: "Wesekhet Sen-Nu" };
const SLIP = {
  soul_name: "塞内布",
  soul_code: "QU33Q9FW5F",
  home_tenant: { code: "CN_DIYU", display_name: "Chinese Afterlife", hall_names: HALLS, seal_glyphs: [] as string[] },
  expires_at: "2026-10-14T13:40:00Z",
  officer_name: "书吏阿尼",
  printed_at: "2026-10-11T13:52:00Z",
};
const pad = (n: number) => String(n).padStart(2, "0");
/** 与组件同一口径的预期值:本地时间,YYYY-MM-DD HH:mm。 */
const local = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const withCode = (code: string, seal_glyphs: string[] = []) => ({ ...SLIP, home_tenant: { ...SLIP.home_tenant, code, seal_glyphs } });
const renderSlip = (slip = SLIP, color = false) => render(<DeliverySlip slip={slip} texts={TEXTS} color={color} />);
/** 剪线说明之前的全部文字 = 上联(剪线说明本身跟官员台语言,是上联与存根的分界)。 */
const upperPart = () => {
  const all = screen.getByTestId("delivery-slip").textContent ?? "";
  return all.slice(0, all.indexOf(tDesk("soul_accounts.credentials.slip.cut")));
};
const stubPart = () => (screen.getByTestId("delivery-slip").querySelector("section") as HTMLElement).textContent ?? "";
/** 灵魂名与官员名是不翻译的数据(这里恰好是汉字),其余文字里不许有汉字。 */
const noHan = (text: string) => expect(text.replace(SLIP.soul_name, "").replace(SLIP.officer_name, "")).not.toMatch(/[\u4e00-\u9fff]/);

describe("qrMatrix", () => {
  const m = qrMatrix("SL1:QU33Q9FW5F");

  it("is a version-1 symbol (21 x 21) with solid finder-pattern rings in three corners", () => {
    expect(m).toHaveLength(21);
    expect(m.every((row) => row.length === 21)).toBe(true);
    const ring = (r0: number, c0: number) => {
      for (let i = 0; i < 7; i++) {
        for (const [r, c] of [
          [r0, c0 + i],
          [r0 + 6, c0 + i],
          [r0 + i, c0],
          [r0 + i, c0 + 6],
        ]) {
          expect(m[r][c]).toBe(true);
        }
      }
      expect(m[r0 + 1][c0 + 1]).toBe(false); // the light ring inside
      expect(m[r0 + 3][c0 + 3]).toBe(true); // the dark core
    };
    ring(0, 0);
    ring(0, 14);
    ring(14, 0);
  });

  it("is stable for one input and differs for another number", () => {
    expect(qrMatrix("SL1:QU33Q9FW5F")).toEqual(m);
    expect(qrMatrix("SL1:QU33Q9FW5G")).not.toEqual(m);
  });
});

it("QrCode draws a black-on-white vector at the requested size", () => {
  const { container } = render(<QrCode text="SL1:QU33Q9FW5F" size="42mm" />);
  const svg = container.querySelector("svg[data-qr]") as SVGElement;
  expect(svg).toHaveAttribute("width", "42mm");
  expect(svg).toHaveAttribute("viewBox", "0 0 29 29"); // 21 + a 4-module quiet zone on each side
  expect(svg.querySelector("path")).toHaveAttribute("fill", "black");
});

describe("DeliverySlip", () => {
  it("prints the soul, the grouped number, hall, times and officer; one QR", () => {
    const { baseElement } = renderSlip();
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.parentElement).toBe(document.body);
    const text = slip.textContent ?? "";
    for (const piece of ["酆都 · 第二殿", "塞内布", "QU3 3Q9F W5F", local(SLIP.expires_at), local(SLIP.printed_at), "书吏阿尼", "登录交付单", "第 1 页 / 共 1 页"]) {
      expect(text).toContain(piece);
    }
    // 编号 3-4-3,每组一个 span(组间距是版面的,不是空格)。
    expect([...slip.querySelectorAll("[data-slip-code] > span")].map((e) => e.textContent)).toEqual(["QU3", "3Q9F", "W5F"]);
    expect(baseElement.querySelectorAll("svg[data-qr]")).toHaveLength(1);
  });

  it("prints every time as YYYY-MM-DD HH:mm in a mono font, and prints the valid-until time once on the upper slip", () => {
    renderSlip();
    const slip = screen.getByTestId("delivery-slip");
    expect(local(SLIP.expires_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(slip.querySelector("[data-slip-valid]")).toHaveTextContent(local(SLIP.expires_at));
    expect(slip.querySelector("[data-slip-valid]")).toHaveStyle({ fontFamily: "var(--font-mono)" });
    expect(upperPart().split(local(SLIP.expires_at))).toHaveLength(2);
    expect(slip.textContent).not.toContain("dt(");
  });

  it("names the time zone beside the times, lets a long soul name wrap to two lines, and a reprint drops the first-sign-in claim", () => {
    const long = { ...SLIP, soul_name: "阿蒙霍特普·赛特纳赫特·拉美西斯·塞内布·伊西多拉" };
    const { unmount } = renderSlip(long);
    const slip = screen.getByTestId("delivery-slip");
    const name = [...slip.querySelectorAll("span")].find((e) => e.textContent === long.soul_name && e.style.maxWidth === "290px") as HTMLElement;
    expect(name.style.whiteSpace).toBe("");
    expect(name.style.textOverflow).toBe("");
    expect(name.style.webkitLineClamp || name.style.getPropertyValue("-webkit-line-clamp")).toBe("2");
    const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date(SLIP.expires_at)).find((p) => p.type === "timeZoneName")!.value;
    expect(slip.querySelector("[data-slip-valid]")?.parentElement).toHaveTextContent(zone);
    expect(slip.textContent).toContain("首次登录");
    expect(slip.textContent).not.toContain(tDesk("soul_accounts.credentials.slip.reprint"));
    unmount();

    render(<DeliverySlip slip={SLIP} texts={TEXTS} reprint />);
    const reprint = screen.getByTestId("delivery-slip").textContent ?? "";
    expect(reprint).not.toContain("首次登录");
    expect(reprint).toContain(tDesk("soul_accounts.credentials.slip.reprint"));
  });

  it("has an empty box where the password goes, and no password value or field anywhere", () => {
    renderSlip();
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelector("[data-slip-password-box]")).toBeEmptyDOMElement();
    expect(slip.querySelector("input, textarea")).toBeNull();
  });

  it("falls back to the tenant's display name when the hall has no name in this language", () => {
    renderSlip({ ...SLIP, home_tenant: { ...SLIP.home_tenant, hall_names: {} as Record<string, string> } });
    expect(screen.getByTestId("delivery-slip")).toHaveTextContent("Chinese Afterlife");
  });
});

describe("DeliverySlip language", () => {
  const SUB = ["SOUL NUMBER", "INITIAL PASSWORD", "VALID UNTIL", "■ Change the password at first sign-in.", "Tap Scan, then scan this"];

  it("CN: Chinese main text with English sub-lines, even while the desk is English", () => {
    mockDesk = "en";
    renderSlip();
    const up = upperPart();
    for (const piece of ["酆都 · FENGDU", "登录交付单", "SOUL LEDGER · SIGN-IN SLIP", "初始密码", "(72 小时 · 72 h)", "■ 首次登录必须改密码。改完以后", "点「扫码」扫这里", ...SUB]) {
      expect(up).toContain(piece);
    }
    expect(screen.getByTestId("delivery-slip").querySelector("[data-slip-doc-title]")).toHaveStyle({ letterSpacing: ".3em" });
    // 存根跟官员台:只有英文,没有中文。
    expect(stubPart()).toContain("Stub · kept by the hall");
    noHan(stubPart());
    expect(screen.getByTestId("delivery-slip").querySelector("[data-slip-stub-hall]")).toHaveTextContent("Fengdu · Second Court");
  });

  it("CN with a Chinese desk: the stub is Chinese, and the upper slip still carries the English lines", () => {
    renderSlip();
    expect(stubPart()).toContain("存根 · 本殿留存");
    expect(stubPart()).not.toContain("Stub");
    expect(upperPart()).toContain("INITIAL PASSWORD");
    expect(screen.getByTestId("delivery-slip")).toHaveTextContent("✂ 沿此线剪下");
  });

  it("EU: English only (no sub-lines, no Chinese anywhere on the upper slip), with the Latin eyebrow", () => {
    renderSlip(withCode("EU_HEAVEN_HELL"));
    const up = upperPart();
    expect(up).toContain("LIBER ANIMARVM");
    expect(up).toContain("Sign-in slip");
    expect(up).toContain("INITIAL PASSWORD");
    expect(up).toContain("(72 hours)");
    noHan(up);
    expect(up).not.toContain("72 h)");
    // 每一项只印一次:没有副行,于是 "Initial password" 的大写形式只出现一次。
    expect(up.split("INITIAL PASSWORD")).toHaveLength(2);
    expect(up.split("■ You must change the password at first sign-in.")).toHaveLength(2);
    expect(up).not.toContain("■ Change the password at first sign-in.");
    expect(up).toContain("Second Court");
    // 桌面是中文,存根仍是中文。
    expect(stubPart()).toContain("存根");
  });

  it("GR: English only, with both Greek eyebrows", () => {
    renderSlip(withCode("GR_HADES"));
    const up = upperPart();
    expect(up).toContain("ΑΙΔΗΣ · HADES");
    expect(up).toContain("ΒΙΒΛΟΣ ΨΥΧΩΝ");
    noHan(up);
    expect(up).not.toContain("72 h)");
  });

  it("EG: Egyptian main text with English sub-lines; the realm name prints once when both languages agree", () => {
    renderSlip(withCode("EG_DUAT"));
    const up = upperPart();
    expect(up.startsWith("DUAT")).toBe(true);
    expect(up).not.toContain("DUAT · DUAT");
    expect(up).toContain("Wesekhet Sen-Nu");
    expect(up).toContain("Djama Redi");
    expect(up).toContain("(Unut 72 · 72 h)");
    expect(up).toContain("Sab Sesh, Mi Djed");
    expect(up).toContain("Written or told in person by the officer");
    expect(up).toContain("■ Change the password at first sign-in.");
    noHan(up);
    expect(screen.getByTestId("delivery-slip").querySelector("[data-slip-doc-title]")).toHaveStyle({ letterSpacing: ".06em" });
  });

  it("neutral hall: printed in the desk language, with English lines unless the desk is English", () => {
    const { unmount } = renderSlip(withCode("XX_NOWHERE"));
    expect(upperPart()).toContain("登录交付单");
    expect(upperPart()).toContain("INITIAL PASSWORD");
    unmount();
    mockDesk = "en";
    renderSlip(withCode("XX_NOWHERE"));
    expect(upperPart()).toContain("Sign-in slip");
    noHan(upperPart());
    expect(upperPart()).not.toContain("72 h)");
  });

  it("joins the must-change sentence with no space in Chinese and one space in English", () => {
    const { unmount } = renderSlip();
    expect(upperPart()).toContain("■ 首次登录必须改密码。改完以后");
    unmount();
    renderSlip(withCode("EU_HEAVEN_HELL"));
    expect(upperPart()).toContain("sign-in. After that");
  });
});

describe("SoulCode", () => {
  it("shows 3-4-3 with the spelled label", () => {
    render(<SoulCode code="QU33Q9FW5F" />);
    const el = screen.getByText("QU3 3Q9F W5F");
    expect(el).toHaveAttribute("aria-label", tZh("soul_app.login.id_aria", { spelled: "Q U 3，3 Q 9 F，W 5 F" }));
    expect(el).toHaveClass("font-mono");
  });
});

describe("DeliverySlip by civilisation", () => {
  const CIVS = [
    ["CN_DIYU", "cn"],
    ["EG_DUAT", "eg"],
    ["EU_HEAVEN_HELL", "eu"],
    ["GR_HADES", "gr"],
  ] as const;

  it.each(CIVS)("%s draws its own emblem and none of the other three", (code, civ) => {
    renderSlip(withCode(code));
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelectorAll(`[data-slip-emblem="${civ}"]`)).toHaveLength(1);
    for (const other of ["cn", "eg", "eu", "gr"].filter((c) => c !== civ)) {
      expect(slip.querySelector(`[data-slip-emblem="${other}"]`)).toBeNull();
    }
    expect(slip.querySelector("[data-slip-band]")).not.toBeNull();
    expect(slip.querySelector("[data-slip-seal-slot] [data-testid='seal']")).toHaveAttribute("data-civ", civ);
  });

  it("puts the civilisation name (own script · English) over the hall name, and the desk-language one on the stub", () => {
    renderSlip(withCode("CN_DIYU"));
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelector("[data-slip-stub-hall]")).toHaveTextContent(`${tZh("plaque.realm.cn")} · 酆都 · 第二殿`);
    expect(slip.querySelector("[data-slip-hall]")?.previousElementSibling).toHaveTextContent("酆都 · FENGDU");
  });

  it("the hall name on the band follows the civilisation's script, not the desk", () => {
    mockDesk = "en";
    renderSlip(withCode("CN_DIYU"));
    expect(screen.getByTestId("delivery-slip").querySelector("[data-slip-hall]")).toHaveTextContent("酆都 · 第二殿");
    expect(screen.getByTestId("delivery-slip").querySelector("[data-slip-stub-hall]")).toHaveTextContent("Fengdu · Second Court");
  });

  it("draws the seal even when the hall has no seal glyphs of its own", () => {
    renderSlip(withCode("GR_HADES", []));
    expect(screen.getByTestId("seal")).toHaveTextContent("Μ");
  });

  it("is neutral for a hall outside the four: no emblem, no seal, a brand mark in the seal slot", () => {
    renderSlip(withCode("XX_NOWHERE"));
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelector("[data-slip-emblem]")).toBeNull();
    expect(slip.querySelector("[data-testid='seal']")).toBeNull();
    expect(slip.querySelector("[data-slip-seal-slot] [data-brand-mark]")).not.toBeNull();
    expect(slip.querySelector("[data-slip-band]")).not.toBeNull();
  });

  it("carries the footer brand mark and the page label on every civ", () => {
    renderSlip(withCode("EU_HEAVEN_HELL"));
    expect(screen.getByTestId("delivery-slip").querySelector("[data-slip-foot] [data-brand-mark]")).not.toBeNull();
  });

  it("is black by default; with colour only the band, frame, rules and seal take the civilisation's ink", () => {
    const { rerender } = renderSlip(withCode("CN_DIYU"));
    const inks = () => [...screen.getByTestId("delivery-slip").querySelectorAll("[data-slip-ink]")].map((e) => e.getAttribute("data-slip-ink"));
    expect(new Set(inks())).toEqual(new Set(["mono"]));
    // The colour arrives through --color-main, selected by data-civ on the inked element itself; black ink carries none.
    const civs = () => [...screen.getByTestId("delivery-slip").querySelectorAll("[data-slip-ink]")].map((e) => e.getAttribute("data-civ"));
    expect(new Set(civs())).toEqual(new Set([null]));
    expect(screen.getByTestId("delivery-slip")).not.toHaveAttribute("data-slip-color");

    rerender(<DeliverySlip slip={withCode("CN_DIYU")} texts={TEXTS} color />);
    const slip = screen.getByTestId("delivery-slip");
    expect(new Set(inks())).toEqual(new Set(["cn"]));
    expect(new Set(civs())).toEqual(new Set(["cn"]));
    // frame, two rules, seal slot — and nothing else, in particular not the QR or the number.
    expect(inks()).toHaveLength(4);
    expect(slip.querySelector("[data-slip-qr]")?.closest("[data-slip-ink]")).toBeNull();
    expect(slip.querySelector("[data-slip-code]")?.closest("[data-slip-ink]")).toBeNull();
    expect(slip.querySelector("[data-slip-password-box]")?.closest("[data-slip-ink]")).toBeNull();
  });

  it("encodes SL1:<number> in the QR whatever the colour", () => {
    renderSlip(withCode("CN_DIYU"), true);
    const svg = screen.getByTestId("delivery-slip").querySelector("svg[data-qr]") as SVGElement;
    expect(svg).toHaveAttribute("width", "160px");
    expect(svg.querySelector("path")).toHaveAttribute("fill", "black");
    const m = qrMatrix("SL1:QU33Q9FW5F");
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    expect(d.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(m.flat().filter(Boolean).length);
  });

  it("gives the two dividers' patterns different ids", () => {
    renderSlip(withCode("EG_DUAT"));
    const ids = [...screen.getByTestId("delivery-slip").querySelectorAll("pattern")].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
