/**
 * 快捷键提示按平台写(设计参照 2026-11-15 §9)、关页前先问(同节)。
 *
 * 变异:把 `keyLabel` 的 `mac ? key :` 改成恒返回 key → 「非 Mac 写 Ctrl」红;把 `useUnsavedGuard` 的 `if (!dirty) return`
 * 删掉 → 「干净时不拦」红。
 */
import { render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

import { Kbd } from "@/src/components/judgment/JudgmentDesk";
import { keyLabel } from "@/src/lib/platformKeys";
import { useUnsavedGuard } from "@/src/hooks/useUnsavedGuard";

function withPlatform(platform: string, run: () => void) {
  const spy = jest.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
}

describe("keyLabel", () => {
  it("Mac keeps ⌘; elsewhere ⌘ becomes Ctrl", () => {
    expect(keyLabel("⌘⏎", true)).toBe("⌘⏎");
    expect(keyLabel("⌘⏎", false)).toBe("Ctrl ⏎");
    expect(keyLabel("⌘Z · U", false)).toBe("Ctrl Z · U");
    expect(keyLabel("1–4", false)).toBe("1–4");
  });

  it("a keycap renders the platform's spelling", () => {
    withPlatform("Win32", () => {
      render(<Kbd>⌘⏎</Kbd>);
      expect(screen.getByText("Ctrl ⏎")).toBeInTheDocument();
      expect(screen.queryByText("⌘⏎")).not.toBeInTheDocument();
    });
  });

  it("on a Mac the keycap keeps ⌘", () => {
    withPlatform("MacIntel", () => {
      render(<Kbd>⌘⏎</Kbd>);
      expect(screen.getByText("⌘⏎")).toBeInTheDocument();
    });
  });
});

describe("useUnsavedGuard", () => {
  const fire = () => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it("asks only while dirty, and stops asking once clean or unmounted", () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedGuard(dirty), { initialProps: { dirty: false } });
    expect(fire()).toBe(false);
    rerender({ dirty: true });
    expect(fire()).toBe(true);
    rerender({ dirty: false });
    expect(fire()).toBe(false);
    rerender({ dirty: true });
    unmount();
    expect(fire()).toBe(false);
  });
});
