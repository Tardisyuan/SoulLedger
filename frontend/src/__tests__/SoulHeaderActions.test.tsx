/**
 * `role="menu"` 承诺的键盘契约 —— 这是同一个缺陷的**第三个**实例。
 *
 * `SoulHeaderActions` 声明 `role="menu"` / `role="menuitem"`,而一个都没兑现:
 * 打开时不移焦、没有方向键、没有 Escape、关闭后焦点不回触发器。它唯一的关闭
 * 路径是点遮罩,而那个遮罩是 `aria-hidden tabIndex={-1}` —— 键盘够不着。
 *
 * `components/ui/data-grid/useRovingPopupKeys.ts` 正是 2026-09-01 那轮为这件事
 * 写的,它自己的表头点名了当时找到的两个实例(`ActionsMenu` / `FilterBar`)。
 * 在这次改动之前,`grep -rn useRovingPopupKeys` 的消费者就只有那两个。
 * **hook 早就在了,这个菜单没进那次清扫。**
 *
 * 删除本身一直是键盘可完成的(菜单项是真 `<button>`,在 tab 序里),所以这是
 * 对辅助技术的失信,不是死路。这也是为什么每一条断言都问的是「契约兑现了吗」,
 * 而不是「删得掉吗」—— 后者在缺陷版本里同样会绿。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";

import { SoulHeaderActions } from "@/src/components/souls/detail/SoulHeaderActions";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tf: (_key: string, fallback: string) => fallback,
    locale: "en",
    hydrated: true,
  }),
}));

// 真门禁,喂真权限清单 —— `suiteShape` 禁止把门本身桩掉,而且有道理:
// 一个直通的桩会让门被删掉时什么都不红。
jest.mock("@/src/hooks/usePermissions", () => {
  const held = new Set(["soul.update", "soul.delete"]);
  const has = (p: string) => held.has(p);
  return {
    usePermissions: () => ({
      hasPermission: has,
      hasAnyPermission: (l: string[]) => l.some(has),
      hasAllPermissions: (l: string[]) => l.every(has),
      isAdmin: false,
      permissions: [...held],
    }),
  };
});

/** 开关状态归页面所有(见组件里的 prop 注释),所以这里也由外面持有。 */
function Harness({ onDelete = jest.fn() }: { onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <SoulHeaderActions
      onEdit={jest.fn()}
      onDelete={onDelete}
      isOverflowMenuOpen={open}
      setIsOverflowMenuOpen={setOpen}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: "更多操作" });

describe("SoulHeaderActions 的溢出菜单", () => {
  it("打开时焦点进到菜单里,而不是留在触发器上", async () => {
    render(<Harness />);

    await act(async () => {
      fireEvent.click(trigger());
    });

    // 改动前这里是 `expect(document.activeElement).toBe(trigger())` ——
    // 菜单在键盘后面打开,role 宣告了导航而 Tab 直接走过去。
    expect(screen.getByRole("menuitem")).toHaveFocus();
  });

  it("Escape 关掉菜单,并把焦点还给 ⋯ 触发器", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(trigger());
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // 两半都要断言。只断言「菜单没了」在一个把焦点丢到 <body> 的实现下同样会绿,
    // 而焦点丢到 body 意味着键盘用户得从头 Tab 一遍。
    expect(trigger()).toHaveFocus();
  });

  it("选中删除时,焦点在 onDelete 之前就还回去", async () => {
    // `onDelete` 打开确认对话框,而对话框关闭时把焦点还给「打开时持有焦点的
    // 那个元素」。所以触发器必须在 onDelete 跑之前就是那个元素,否则焦点最终
    // 落在 <body> 上。
    let focusedWhenCalled: Element | null = null;
    const onDelete = jest.fn(() => {
      focusedWhenCalled = document.activeElement;
    });
    render(<Harness onDelete={onDelete} />);
    await act(async () => {
      fireEvent.click(trigger());
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem"));
    });

    expect(onDelete).toHaveBeenCalled();
    expect(focusedWhenCalled).toBe(trigger());
  });

  it("关掉之后菜单项确实不在文档里", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(trigger());
    });
    expect(screen.getByRole("menuitem")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(trigger());
    });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("触发器报告菜单的开合状态", async () => {
    render(<Harness />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(trigger());
    });
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });
});
