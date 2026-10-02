/**
 * A5 帖子配图与查看器:方格规则、过期格(不留破图、可重取)、查看器的 ← → / 位置 / 缩略图。
 */
import { render, fireEvent, within } from "@testing-library/react";
import type { PostMedia } from "@soulledger/core/domain/postMedia";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}:${Object.values(p).join(",")}` : k) }),
}));

import { PostMediaGrid } from "@/src/components/social/PostMedia";

const media = (n: number): PostMedia[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, url: `/api/v1/social-media/m${i}/?t=sig${i}`, width: 64, height: 48 }));

function grid(n: number, onRefetch = jest.fn()) {
  render(<PostMediaGrid media={media(n)} onRefetch={onRefetch} author="梅瑞特" time="10-02 09:00" />);
  return onRefetch;
}

const cells = () => Array.from(document.querySelectorAll("[data-media-cell]"));

describe("方格规则", () => {
  it("没有图就什么都不画", () => {
    grid(0);
    expect(document.querySelector("[data-media-grid]")).toBeNull();
  });

  it("1 张:16:10、至多 480,不是方格", () => {
    grid(1);
    const ul = document.querySelector("[data-media-grid]")!;
    expect(ul).toHaveClass("max-w-[480px]");
    expect(ul).not.toHaveClass("grid");
    expect(cells()[0]).toHaveClass("aspect-[16/10]");
  });

  it("2–4 张:两列方格、至多 400;393 三列;没有 +N", () => {
    grid(3);
    const ul = document.querySelector("[data-media-grid]")!;
    expect(ul).toHaveClass("grid-cols-2", "max-w-[400px]", "max-[768px]:grid-cols-3");
    expect(cells().every((c) => c.classList.contains("aspect-square"))).toBe(true);
    expect(document.querySelector("[data-media-more]")).toBeNull();
  });

  it("7 张:桌面排前四格、第四格 +3;393 排前六格、第六格 +1", () => {
    grid(7);
    const c = cells();
    expect(c.filter((x) => x.classList.contains("min-[769px]:hidden")).map((x) => x.getAttribute("data-media-cell")))
      .toEqual(["4", "5", "6"]);
    expect(c.filter((x) => x.classList.contains("max-[768px]:hidden")).map((x) => x.getAttribute("data-media-cell")))
      .toEqual(["6"]);
    const more = document.querySelectorAll("[data-media-more]");
    expect(more).toHaveLength(2);
    expect(c[3].querySelector("[data-media-more]")!.textContent).toContain("+3");
    expect(c[3].querySelector("[data-media-more]")).toHaveClass("max-[768px]:hidden");
    expect(c[5].querySelector("[data-media-more]")!.textContent).toContain("+1");
    expect(c[5].querySelector("[data-media-more]")).toHaveClass("min-[769px]:hidden");
  });
});

describe("签名地址过期", () => {
  it("取图失败:不留 <img>,换成「◌ 链接已过期 · 重新获取」,点了就重拉", () => {
    const onRefetch = grid(2);
    const img = cells()[0].querySelector("img")!;
    fireEvent.error(img);
    expect(cells()[0].querySelector("img")).toBeNull();
    const expired = cells()[0].querySelector("[data-media-expired]")!;
    expect(expired.textContent).toContain("social.media.expired");
    fireEvent.click(within(expired as HTMLElement).getByRole("button"));
    expect(onRefetch).toHaveBeenCalledTimes(1);
    // 另一格不受影响
    expect(cells()[1].querySelector("img")).not.toBeNull();
  });

  it("重拉之后地址换了,格子重新挂载、再试一次", () => {
    const onRefetch = jest.fn();
    const { rerender } = render(<PostMediaGrid media={media(1)} onRefetch={onRefetch} author="a" time="t" />);
    fireEvent.error(cells()[0].querySelector("img")!);
    expect(cells()[0].querySelector("img")).toBeNull();
    const fresh = media(1).map((m) => ({ ...m, url: m.url + "-new" }));
    rerender(<PostMediaGrid media={fresh} onRefetch={onRefetch} author="a" time="t" />);
    expect(cells()[0].querySelector("img")).toHaveAttribute("src", expect.stringContaining("-new"));
  });

  it("加载完之前是斜线占位,加载完撤掉", () => {
    grid(1);
    const img = cells()[0].querySelector("img")!;
    expect(img.className).toContain("repeating-linear-gradient");
    fireEvent.load(img);
    expect(img.className).not.toContain("repeating-linear-gradient");
  });
});

describe("查看器", () => {
  it("点第二格打开,位置 2 / 3;→ 到 3、再 → 回到 1;← 回到 3", () => {
    grid(3);
    fireEvent.click(within(cells()[1] as HTMLElement).getByRole("button"));
    const viewer = document.querySelector("[data-media-viewer]") as HTMLElement;
    expect(viewer).not.toBeNull();
    const pos = () => within(viewer).getByTestId("viewer-position").textContent?.replace(/\s/g, "");
    expect(pos()).toBe("2/3");
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(pos()).toBe("3/3");
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(pos()).toBe("1/3");
    fireEvent.keyDown(viewer, { key: "ArrowLeft" });
    expect(pos()).toBe("3/3");
    expect(within(viewer).getByText("梅瑞特")).toBeInTheDocument();
  });

  it("缩略图:当前那张有 ink 描边,别的没有;点缩略图跳过去", () => {
    grid(3);
    fireEvent.click(within(cells()[0] as HTMLElement).getByRole("button"));
    const viewer = document.querySelector("[data-media-viewer]") as HTMLElement;
    const thumbs = Array.from(viewer.querySelectorAll("[data-thumb]"));
    expect(thumbs.map((t) => t.getAttribute("aria-current"))).toEqual(["true", null, null]);
    expect(thumbs[0].className).toContain("outline-2");
    expect(thumbs[1].className).not.toContain("outline-2");
    fireEvent.click(thumbs[2]);
    expect(within(viewer).getByTestId("viewer-position").textContent?.replace(/\s/g, "")).toBe("3/3");
  });

  it("过期的那张在查看器里也是虚线格,缩略图是 ◌", () => {
    grid(2);
    fireEvent.error(cells()[1].querySelector("img")!);
    fireEvent.click(within(cells()[0] as HTMLElement).getByRole("button"));
    const viewer = document.querySelector("[data-media-viewer]") as HTMLElement;
    const thumb = viewer.querySelector('[data-thumb="1"]')!;
    expect(thumb.querySelector("img")).toBeNull();
    expect(thumb.querySelector("[data-media-expired]")).not.toBeNull();
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(viewer.querySelector('[data-media-expired] button')).not.toBeNull();
  });

  it("单张不画 ← → 与缩略图条", () => {
    grid(1);
    fireEvent.click(within(cells()[0] as HTMLElement).getByRole("button"));
    const viewer = document.querySelector("[data-media-viewer]") as HTMLElement;
    expect(within(viewer).queryByRole("button", { name: "social.media.next" })).toBeNull();
    expect(viewer.querySelector("[data-thumb]")).toBeNull();
  });
});
