import { useEffect } from "react";
import { showToast, ToastContainer } from "soulledger";

// 提示是直接挂到 DOM 的;ToastContainer 本身不渲染内容。预览里长时间留屏。
export const Toasts = () => {
  useEffect(() => {
    showToast("判词已提交", "success", 600000);
    showToast("王守仁的处置未能保存", "error", 600000);
    showToast("已有 3 条新案件进入队列", "info", 600000);
  }, []);
  return (
    <div style={{ minHeight: 260 }}>
      <ToastContainer />
    </div>
  );
};
