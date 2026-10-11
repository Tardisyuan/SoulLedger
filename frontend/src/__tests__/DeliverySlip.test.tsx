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
  home_tenant: { code: "eg", display_name: "Egyptian Afterlife", hall_names: { "zh-Hans": "杜阿特 · 第二殿" }, seal_glyphs: [] as string[] },
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
      tZh("soul_accounts.credentials.slip.title"),
      "第 1 页 / 共 1 页",
    ]) {
      expect(text).toContain(piece);
    }
    expect(slip.querySelector("[data-slip-code]")).toHaveTextContent("QU3 3Q9F W5F");
    expect(baseElement.querySelectorAll("svg[data-qr]")).toHaveLength(1);
  });

  it("has an empty box where the password goes, and no password text or field anywhere", () => {
    render(<DeliverySlip slip={SLIP} />);
    const slip = screen.getByTestId("delivery-slip");
    expect(slip.querySelector("[data-slip-password-box]")).toBeEmptyDOMElement();
    expect(slip.querySelector("input, textarea")).toBeNull();
    // 「密码」只在空框的说明和存根的有效期那一行里出现,后面不跟任何值。
    const text = (slip.textContent ?? "")
      .replace(tZh("soul_accounts.credentials.slip.password_box"), "")
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
