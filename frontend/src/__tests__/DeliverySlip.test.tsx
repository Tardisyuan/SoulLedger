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
import { tZh } from "./support/zhBundle";

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, locale: "zh-Hans", formatDateTime: (v: string) => `dt(${v})`, hydrated: true }),
}));

const SLIP = {
  soul_name: "塞内布",
  soul_code: "QU33Q9FW5F",
  home_tenant: { code: "EG_DUAT", display_name: "Egyptian Afterlife", hall_names: { "zh-Hans": "杜阿特 · 第二殿" }, seal_glyphs: [] as string[] },
  expires_at: "2026-10-14T13:40:00Z",
  officer_name: "书吏阿尼",
  printed_at: "2026-10-11T13:52:00Z",
};

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
  it("prints the soul, the grouped number, hall, dates and officer; one QR", () => {
    const { baseElement } = render(<DeliverySlip slip={SLIP} />);
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.parentElement).toBe(document.body);
    const text = slip.textContent ?? "";
    for (const piece of [
      "杜阿特 · 第二殿",
      "塞内布",
      "QU3 3Q9F W5F",
      "dt(2026-10-14T13:40:00Z)",
      "书吏阿尼",
      "登录交付单",
      "第 1 页 / 共 1 页",
    ]) {
      expect(text).toContain(piece);
    }
    // 编号 3-4-3,每组一个 span(组间距是版面的,不是空格)。
    expect([...slip.querySelectorAll("[data-slip-code] > span")].map((e) => e.textContent)).toEqual(["QU3", "3Q9F", "W5F"]);
    expect(baseElement.querySelectorAll("svg[data-qr]")).toHaveLength(1);
  });

  it("has an empty box where the password goes, and no password text or field anywhere", () => {
    render(<DeliverySlip slip={SLIP} />);
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelector("[data-slip-password-box]")).toBeEmptyDOMElement();
    expect(slip.querySelector("input, textarea")).toBeNull();
    // 「密码」只在空框的说明和存根的有效期那一行里出现,后面不跟任何值。
    const text = (slip.textContent ?? "")
      .replace(tZh("soul_accounts.credentials.slip.password_box").split(" · ")[0], "")
      .replace(tZh("soul_accounts.credentials.slip.password_box").split(" · ")[1], "")
      .replace(tZh("soul_accounts.credentials.slip.stub_until"), "")
      .replace(tZh("soul_accounts.credentials.slip.must_change"), "");
    expect(text).not.toMatch(/密码|password/i);
  });

  it("falls back to the tenant's display name when the hall has no name in this language", () => {
    render(<DeliverySlip slip={{ ...SLIP, home_tenant: { ...SLIP.home_tenant, hall_names: {} } }} />);
    expect(screen.getByTestId("delivery-slip")).toHaveTextContent("Egyptian Afterlife");
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
  const withCode = (code: string, seal_glyphs: string[] = []) => ({ ...SLIP, home_tenant: { ...SLIP.home_tenant, code, seal_glyphs } });
  const CIVS = [
    ["CN_DIYU", "cn"],
    ["EG_DUAT", "eg"],
    ["EU_HEAVEN_HELL", "eu"],
    ["GR_HADES", "gr"],
  ] as const;

  it.each(CIVS)("%s draws its own emblem and none of the other three", (code, civ) => {
    render(<DeliverySlip slip={withCode(code)} />);
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelectorAll(`[data-slip-emblem="${civ}"]`)).toHaveLength(1);
    for (const other of ["cn", "eg", "eu", "gr"].filter((c) => c !== civ)) {
      expect(slip.querySelector(`[data-slip-emblem="${other}"]`)).toBeNull();
    }
    expect(slip.querySelector("[data-slip-band]")).not.toBeNull();
    expect(slip.querySelector("[data-slip-seal-slot] [data-testid='seal']")).toHaveAttribute("data-civ", civ);
  });

  it("puts the civilisation name over the hall name and again on the stub", () => {
    render(<DeliverySlip slip={withCode("CN_DIYU")} />);
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelector("[data-slip-stub-hall]")).toHaveTextContent(`${tZh("plaque.realm.cn")} · 杜阿特 · 第二殿`);
    expect(slip.querySelector("[data-slip-hall]")?.previousElementSibling).toHaveTextContent(tZh("plaque.realm.cn"));
  });

  it("draws the seal even when the hall has no seal glyphs of its own", () => {
    render(<DeliverySlip slip={withCode("GR_HADES", [])} />);
    expect(screen.getByTestId("seal")).toHaveTextContent("Μ");
  });

  it("is neutral for a hall outside the four: no emblem, no seal, a brand mark in the seal slot", () => {
    render(<DeliverySlip slip={withCode("XX_NOWHERE")} />);
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelector("[data-slip-emblem]")).toBeNull();
    expect(slip.querySelector("[data-testid='seal']")).toBeNull();
    expect(slip.querySelector("[data-slip-seal-slot] [data-brand-mark]")).not.toBeNull();
    expect(slip.querySelector("[data-slip-band]")).not.toBeNull();
  });

  it("carries the footer brand mark and the page label on every civ", () => {
    render(<DeliverySlip slip={withCode("EU_HEAVEN_HELL")} />);
    expect(screen.getByTestId("delivery-slip").querySelector("[data-slip-foot] [data-brand-mark]")).not.toBeNull();
  });

  it("is black by default; with colour only the band, frame, rules and seal take the civilisation's ink", () => {
    const { rerender } = render(<DeliverySlip slip={withCode("CN_DIYU")} />);
    const inks = () => [...screen.getByTestId("delivery-slip").querySelectorAll("[data-slip-ink]")].map((e) => e.getAttribute("data-slip-ink"));
    expect(new Set(inks())).toEqual(new Set(["mono"]));
    expect(screen.getByTestId("delivery-slip")).not.toHaveAttribute("data-slip-color");

    rerender(<DeliverySlip slip={withCode("CN_DIYU")} color />);
    const slip = screen.getByTestId("delivery-slip");
    expect(new Set(inks())).toEqual(new Set(["cn"]));
    // frame, two rules, seal slot — and nothing else, in particular not the QR or the number.
    expect(inks()).toHaveLength(4);
    expect(slip.querySelector("[data-slip-qr]")?.closest("[data-slip-ink]")).toBeNull();
    expect(slip.querySelector("[data-slip-code]")?.closest("[data-slip-ink]")).toBeNull();
    expect(slip.querySelector("[data-slip-password-box]")?.closest("[data-slip-ink]")).toBeNull();
  });

  it("encodes SL1:<number> in the QR whatever the colour", () => {
    render(<DeliverySlip slip={withCode("CN_DIYU")} color />);
    const svg = screen.getByTestId("delivery-slip").querySelector("svg[data-qr]") as SVGElement;
    expect(svg).toHaveAttribute("width", "160px");
    expect(svg.querySelector("path")).toHaveAttribute("fill", "black");
    const m = qrMatrix("SL1:QU33Q9FW5F");
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    expect(d.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(m.flat().filter(Boolean).length);
  });

  it("gives the two dividers' patterns different ids", () => {
    render(<DeliverySlip slip={withCode("EG_DUAT")} />);
    const ids = [...screen.getByTestId("delivery-slip").querySelectorAll("pattern")].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
