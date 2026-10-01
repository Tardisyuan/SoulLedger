/**
 * 规范 v3「页面切换」:新页 opacity 0→1、translateY 8px→0,240ms 进场曲线;减少动态效果下
 * 只留 80ms 淡入(`data-motion="fade"`,见 globals.css)。
 *
 * template 而不是 layout:Next 在根之下那一段路由变了时重新挂载它,于是每次导航都重播
 * 一次进场;外壳(AppLayout 的侧栏、牌匾)在 layout 里,不跟着动。同一段内的跳转
 * (`/souls` → `/souls/123`)不重播 —— 那是 Next 按段挂载 template 的规则。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div data-motion="fade" className="animate-page-enter">
      {children}
    </div>
  );
}
