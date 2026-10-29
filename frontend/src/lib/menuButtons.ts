/**
 * 接上了菜单按钮配置的关键按钮(第四十批 W-b)。配置页(/menus/buttons)只列这里的,一行一个;
 * 页面上每个按钮用 `useMenuButtonConfig()(id)` 问配置,同时保留它原来的权限门 —— 两者都允许才显示。
 *
 * - `menu` + `code` 是配置行的键(`MenuButton.menu.path` + `MenuButton.code`)。没有那一行 = 允许,
 *   所以存量部署一个按钮都不少;配置页第一次关掉某个按钮时才建那一行。
 * - `permission` 是那个按钮**原来的**权限门,配置页「也需要权限」一列照抄。改了页面上的门要改这里。
 * - `label` 复用按钮自己的文案键;`where` 是「出现在」的说法。
 *
 * 加签、转交在网页上还没有按钮(只在官员 App 里),不在这里 —— 列进来就是「配了没用」。
 */
export interface WiredButton {
  id: string;
  menu: string;
  code: string;
  permission: string;
  label: string;
  where: string;
}

export const WIRED_BUTTONS = [
  { id: "souls.create", menu: "/souls", code: "create", permission: "soul.create", label: "souls.create", where: "menu_buttons.where.list_top" },
  { id: "souls.export", menu: "/souls", code: "export", permission: "soul.export", label: "common.export", where: "menu_buttons.where.list_top" },
  { id: "souls.edit", menu: "/souls", code: "edit", permission: "soul.update", label: "souls.detail.edit", where: "menu_buttons.where.detail_header" },
  { id: "souls.delete", menu: "/souls", code: "delete", permission: "soul.delete", label: "souls.detail.delete", where: "menu_buttons.where.detail_more" },
  { id: "judgment.export", menu: "/judgment", code: "export", permission: "judgment.export", label: "common.export", where: "menu_buttons.where.list_top" },
  { id: "judgment.archive", menu: "/judgment", code: "archive", permission: "judgment.execute", label: "records.archive.confirm", where: "menu_buttons.where.detail_header" },
  { id: "crossJudgments.export", menu: "/cross-judgments", code: "export", permission: "cross_judgment.export", label: "common.export", where: "menu_buttons.where.list_top" },
  { id: "disposition.export", menu: "/disposition", code: "export", permission: "disposition.export", label: "common.export", where: "menu_buttons.where.section_top" },
  { id: "disposition.archive", menu: "/disposition", code: "archive", permission: "disposition.execute", label: "records.archive.confirm", where: "menu_buttons.where.row_more" },
  { id: "dispatch.export", menu: "/dispatch", code: "export", permission: "dispatch.export", label: "common.export", where: "menu_buttons.where.section_top" },
  { id: "dispatch.approve", menu: "/dispatch", code: "approve", permission: "dispatch.approve", label: "dispatch.approve", where: "menu_buttons.where.detail_actions" },
  { id: "dispatch.reject", menu: "/dispatch", code: "reject", permission: "dispatch.reject", label: "dispatch.reject", where: "menu_buttons.where.detail_actions" },
] as const satisfies readonly WiredButton[];

export type WiredButtonId = (typeof WIRED_BUTTONS)[number]["id"];

/** 配置行的键:菜单 path + 按钮 code。 */
export const buttonKey = (menu: string, code: string) => `${menu}#${code}`;
