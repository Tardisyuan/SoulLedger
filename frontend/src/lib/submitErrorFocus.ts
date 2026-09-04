"use client";

import { useEffect, type RefObject } from "react";

/**
 * 提交被拒之后,焦点去哪。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 13 个表单里有 1 个做了这件事。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 提交失败后错误渲染出来了,而焦点还留在提交按钮上。在 `BaseModal` 里这尤其
 * 糟:它的正文是可滚动的(`src/components/ui/Modal.tsx:88`),错误可能就在焦点
 * 所在位置的视野之外 —— 操作员按了一下,什么都没变,而变了的那部分他看不见。
 *
 * 唯一做对的是 `app/dispatch/propose/page.tsx:135`,九行,写在那一页里面。
 * 这里把它抽出来,并且换了一种选法(见下),这样第二个用它的表单不必先抄一遍。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 按 DOM 顺序找,不按一张手写的字段名清单。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * dispatch 那一版带着一个 `order = ["soul_id", "target_tenant_code", "reason"]`
 * —— 一张要和表单结构保持同步的清单,而没有任何东西会在它们分岔时报红。
 * 这里改成问文档:`[aria-invalid="true"]` 在 DOM 里的第一个。DOM 顺序就是视觉
 * 顺序,而 `aria-invalid` 正是 `Field` 已经在设的东西
 * (`src/components/ui/Field.tsx:164-247`),所以这一版对每个走 `Field` 的表单
 * 都成立,不需要各自维护一张清单。
 *
 * **这也是为什么它不能挂在「有没有 error 状态」上**:错误要先渲染出来,属性
 * 才在文档里。所以是 effect,跑在 commit 之后。
 */

/** 能接收焦点的东西。`aria-invalid` 可以挂在包裹层上,焦点不能。 */
const FOCUSABLE = 'input, select, textarea, button, [tabindex]:not([tabindex="-1"])';

/**
 * 把焦点移到 `root` 里第一个被标为 invalid 的控件上。
 *
 * 返回是否真的移动了 —— 调用方据此决定要不要退回到别的落点(例如一条表单级的
 * 错误消息),而不是让焦点悄悄留在原地。
 */
export function focusFirstInvalid(root: HTMLElement | null): boolean {
  if (!root) return false;
  const invalid = root.querySelectorAll<HTMLElement>('[aria-invalid="true"]');
  for (const el of Array.from(invalid)) {
    // 属性本身就在一个可聚焦元素上 —— `Field` 的常态。
    if (el.matches(FOCUSABLE)) {
      el.focus();
      return true;
    }
    // 或者挂在包裹层上:取它里面第一个能聚焦的。
    const inner = el.querySelector<HTMLElement>(FOCUSABLE);
    if (inner) {
      inner.focus();
      return true;
    }
  }
  return false;
}

/**
 * 提交被拒时,把焦点放到该看的地方。
 *
 * `deps` 变化且 `hasError` 为真时跑一次:先试逐字段的 invalid 控件,没有就退回
 * `fallbackRef`(表单级错误消息那种,记得给它 `tabIndex={-1}`)。
 *
 * 两级而不是一级,因为这个仓库两种表单都有:有逐字段错误的(dispatch/propose、
 * 几个 modal),和只有一条表单级消息的(两个 permissions modal —— 它们此前把
 * 那一条消息挂在**每个**字段的 `aria-invalid` 上,于是一个「码名重复」会告诉
 * 读屏用户 name 和 category 也是坏的)。
 */
export function useSubmitErrorFocus(
  hasError: boolean,
  rootRef: RefObject<HTMLElement | null>,
  fallbackRef?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!hasError) return;
    if (focusFirstInvalid(rootRef.current)) return;
    fallbackRef?.current?.focus();
  }, [hasError, rootRef, fallbackRef]);
}
