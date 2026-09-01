const defaultTheme = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'hsl(var(--color-canvas))',
        surface: {
          1: 'hsl(var(--color-surface-1))',
          2: 'hsl(var(--color-surface-2))',
          3: 'hsl(var(--color-surface-3))',
          4: 'hsl(var(--color-surface-4))',
        },
        hairline: {
          DEFAULT: 'hsl(var(--color-hairline))',
          strong: 'hsl(var(--color-hairline-strong))',
          tertiary: 'hsl(var(--color-hairline-tertiary))',
        },
        ink: {
          DEFAULT: 'hsl(var(--color-ink))',
          muted: 'hsl(var(--color-ink-muted))',
          subtle: 'hsl(var(--color-ink-subtle))',
          tertiary: 'hsl(var(--color-ink-tertiary))',
        },
        accent: {
          DEFAULT: 'hsl(var(--color-accent))',
          hover: 'hsl(var(--color-accent-hover))',
        },
        // The `amber` override that used to sit here is gone, deliberately.
        // It declared 400:#fcd34d / 500:#fbbf24 / 600:#f59e0b — every step one
        // brighter than Tailwind's own (400:#fbbf24 / 500:#f59e0b). Since
        // `--color-accent` is hsl(38 92% 50%) = #f59e0b, the effect was that
        // `bg-amber-500` and `text-amber-400` — 40 sites — rendered a colour
        // that was NEVER the accent, and could not be, by one fixed step.
        // The most visible casualty was the accent picker in
        // src/components/settings/SettingsDrawer.tsx:9, whose swatch is
        // `class: "bg-amber-500"` next to `value: "#f59e0b"`: the square you
        // clicked and the colour you got were different. Dropping the override
        // restores Tailwind's scale, so amber-500 IS the accent and those 40
        // sites finally render what they always claimed to.
      },

      // ── Stage 11 A1 · 三支字族 ────────────────────────────────────────
      // 拉丁走 next/font 注入的 CSS 变量;CJK 是 @fontsource-variable 包里
      // @font-face 声明的字面族名(见 app/layout.tsx 的 import)。
      // 顺序即回退顺序:拉丁字形先命中拉丁族,CJK 码位落到 Noto SC。
      fontFamily: {
        sans: ["var(--font-sans-latin)", "'Noto Sans SC Variable'", ...defaultTheme.fontFamily.sans],
        serif: ["var(--font-serif-latin)", "'Noto Serif SC Variable'", ...defaultTheme.fontFamily.serif],
        // mono 的 CJK 位仍接 Noto Sans SC:等宽族不含汉字,而 ID/时间戳旁边偶尔
        // 会出现中文单位(“年”“卷”),让它落在无衬线而不是浏览器默认等宽回退。
        mono: ["var(--font-mono-latin)", "'Noto Sans SC Variable'", ...defaultTheme.fontFamily.mono],
      },

      // ── Stage 11 A2 · 八档字号 ────────────────────────────────────────
      // 最大/正文从 1.71 倍拉到 3.7 倍(56/15)。密度不降:表格正文落 03=13px,
      // 比迁移前的 text-sm(14px)更紧;跨度全部加在 13px 以上的三档。
      // 这些键是**新增**的,text-xs/sm/base/… 仍然可用——迁移期间两套并存,
      // 收口靠 lint 而不是靠让旧类名消失(一次性删掉会让 722 处同时变红)。
      fontSize: {
        "01": ["11px", { lineHeight: "1.45", letterSpacing: "0.10em", fontWeight: "600" }],
        "02": ["12px", { lineHeight: "1.5", letterSpacing: "0.04em" }],
        "03": ["13px", { lineHeight: "1.55", letterSpacing: "0" }],
        "04": ["15px", { lineHeight: "1.6", letterSpacing: "-0.005em" }],
        "05": ["18px", { lineHeight: "1.55", letterSpacing: "-0.01em" }],
        "06": ["22px", { lineHeight: "1.35", letterSpacing: "-0.015em", fontWeight: "600" }],
        "07": ["32px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
        "08": ["56px", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "600" }],
      },

      letterSpacing: {
        label: "0.10em",   // 01 档 uppercase 标签
        meta: "0.04em",    // 02 档 ID / 时间戳
        tight: "-0.015em", // 06 档区块标题
        display: "-0.03em", // 08 档 KPI / 主文
      },

      // ── Stage 11 A4 · 圆角:全部方角 ───────────────────────────────────
      // 迁移前 514 处 rounded*,其中 191 处是裸 `rounded`——那不是决策,是默认值。
      // 归零的是 443 处(514 减去保留的 71 处 rounded-full)。
      // 两处例外都不是装饰:`full` 给 7px 文明点与头像(圆 = 这是个身份物);
      // `focus` 2px 给焦点环外扩,避免方角焦点在小控件上打架——与 globals.css:459
      // 那条 :focus-visible 规则里的 border-radius:2px 同值。
      borderRadius: {
        none: "0",
        DEFAULT: "0",
        sm: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        focus: "2px",
        full: "9999px",
      },

      // ── Stage 11 D · 四条线宽阶梯 ─────────────────────────────────────
      // 1px hairline = 行线(数量最多,权重最低);1px hairline-strong = 区块边界
      // (只给真正可独立操作的容器);2px ink-subtle = 章节下划线(取代 font-bold
      // 做层级);3px = 文明身份线与判决落印带,全站只有这两处。
      // Tailwind 已有 border-2,这里补 border-3。
      borderWidth: {
        3: "3px",
      },

      // ── 层级 ─────────────────────────────────────────────────────────
      // 命名的四层,取代 `z-[9999]` / `z-[99998]` / `z-[99999]` 那场军备竞赛
      // —— 那三个值本身说明不了谁该压谁,只说明了谁后写。
      //
      // **顺序照抄现状,不趁机改。** 眼下 drawer 压在 dialog 之上(99998 > 9999),
      // 这多半是反的:一个从抽屉里开出来的确认框应该在抽屉之上。但改相对次序
      // 会让某个东西看不见或点不到,而这只是一次命名重构;把它记在这里,
      // 留给真正要动层级的那一次。
      //
      // Tailwind 自带的 z-10..50 保持原样,页面内的层次仍然用它们。
      zIndex: {
        progress: "60", // 路由进度条(globals.css 的 #nprogress .bar 也用这个数)
        dialog: "70",   // Modal / ConfirmDialog
        drawer: "80",   // 侧栏抽屉、设置抽屉、登出确认
      },

      // ── Stage 11 B · 内容宽度:八种收到三种 ────────────────────────────
      // `full` 不在这里——它的含义是「不设 max-width」,由 PageShell 的 variant
      // 直接不加类名实现,而不是一个值。
      // 注意 `prose` 覆盖了 Tailwind 自带的 max-w-prose(65ch)。这是有意的:
      // 行长在这套版式里由 px 定,好让判决理由与条文详情在任何字号下都是同一列宽。
      maxWidth: {
        prose: "720px",
        page: "1200px",
      },

      // 关于 spacing:设计稿给了 {1:4px, 2:8px, 3:12px, 4:16px, 6:24px, 10:40px,
      // 16:64px}。这七个值与 Tailwind 默认逐一相同(1=0.25rem=4px … 16=4rem=64px),
      // 所以写进 extend 是彻底的 no-op,不写。六档节奏是一条**限制**(禁用 5/7/9
      // 等),而 extend 只能新增或覆盖、不能删除——限制必须由 lint 施加。
    },
  },
  plugins: [],
};
