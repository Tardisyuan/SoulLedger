import { LogoutConfirmDialog } from "soulledger";

// 用户菜单点「退出登录」时弹出的确认框;状态在 AppLayout,这里直接渲染为打开态。
export const Open = () => <LogoutConfirmDialog open onClose={() => {}} onConfirm={() => {}} />;
