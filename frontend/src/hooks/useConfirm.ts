import { useCallback, useRef, useState } from "react";

/**
 * 一个确认框问一句、点「确认」才做事。`ask(message, run)` 打开它;`dialogProps` 摊进 `<ConfirmDialog>`。
 *
 * 要做的事放在 ref 里,不放 state:此前页面把函数存进 `useState`,得写成 `set(() => async () => …)`
 * 才不被 React 当成更新函数调掉。关掉后保留上一句,收起动画期间框里不会变空。
 */
export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const run = useRef<(() => void) | null>(null);

  const ask = useCallback((text: string, onConfirm: () => void) => {
    run.current = onConfirm;
    setMessage(text);
    setOpen(true);
  }, []);

  const onConfirm = useCallback(() => {
    setOpen(false);
    const next = run.current;
    run.current = null;
    next?.();
  }, []);

  const onCancel = useCallback(() => {
    setOpen(false);
    run.current = null;
  }, []);

  return { ask, dialogProps: { isOpen: open, message, onConfirm, onCancel } };
}
