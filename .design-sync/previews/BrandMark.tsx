import { BrandMark } from "soulledger";

// 天平标:官员台导航的品牌位、登录页、空白页都用这一枚。高度随宽度按比例走。
export const Sizes = () => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
    <BrandMark size={20} label="灵魂簿" />
    <BrandMark size={32} label="灵魂簿" />
    <BrandMark size={56} label="灵魂簿" />
    <BrandMark size={96} label="灵魂簿" />
  </div>
);

// 三种着色:ink 用在浅底,gold 用在深色品牌底,white 用在文明色匾上。不传 tone 时浅色主题用墨色、深色主题用金色。
export const Tones = () => (
  <div style={{ display: "flex", gap: 0 }}>
    <div style={{ padding: 20, background: "oklch(var(--color-surface-1))" }}>
      <BrandMark size={48} tone="ink" label="灵魂簿" />
    </div>
    <div style={{ padding: 20, background: "#14161a" }}>
      <BrandMark size={48} tone="gold" label="灵魂簿" />
    </div>
    <div style={{ padding: 20, background: "oklch(var(--color-civ-cn))" }}>
      <BrandMark size={48} tone="white" label="灵魂簿" />
    </div>
  </div>
);

// 与字标并排:登录页与导航展开态的写法。
export const WithWordmark = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <BrandMark size={28} />
    <span className="text-lg font-medium text-[oklch(var(--color-ink))]">灵魂簿</span>
  </div>
);
