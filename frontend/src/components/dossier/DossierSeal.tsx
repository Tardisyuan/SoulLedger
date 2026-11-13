"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import type { SpineCiv } from "./spineModel";
import s from "./dossier.module.css";

const HALL_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/**
 * 卷宗的印(Design 第三十批 第 3 步第 3 条):地府方印(白文「第 N 殿印」,右起竖读,转 −3°)、欧洲圆形蜡封
 * (M 与一颗星,下沿两滴蜡,+4°)、埃及王名圈(日盘与玛阿特之羽,不转)、希腊陶片(ΚΡΙ / ΣΙΣ,−6°)。
 * 几何照定稿 SVG(`seals/seal-*.svg`),颜色读 `--seal`(地府朱只给印,与罪业红分开)与 `--color-canvas`(印上的字),
 * 所以随 `[data-civ]` 与深浅主题走 —— 这是组件而不是 public/ 下 SVG 的原因,另一个是地府的四个字随殿变。
 *
 * `pending`:落印前的虚线预览(22% + 虚线框)。`stamp`:这一次会话里刚落下 —— 240ms 从 1.18 倍落到 1,只播一次;
 * 减少动效时直接出现(样式里)。尺寸 96 / 72 / 40(`--seal-size`)。
 * 印面文字不翻译,读屏读 `aria-label`。
 */
export function DossierSeal({
  civ,
  hall,
  size = 96,
  pending = false,
  stamp = false,
  className = "",
}: {
  civ: SpineCiv | null;
  /** 地府:第几殿(1–10);不知道时印文是「冥府之印」。 */
  hall?: number | null;
  size?: number;
  pending?: boolean;
  stamp?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  if (!civ) return null;
  const label = t(pending ? "caseDesk.dossier.seal.aria_pending" : "caseDesk.dossier.seal.aria", { seal: t(`caseDesk.dossier.seal.${civ}`) });
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      data-testid={pending ? "dossier-seal-pending" : "dossier-seal"}
      data-civ-seal={civ}
      className={`${s.seal} ${stamp && !pending ? s.stampIn : ""} ${className}`}
    >
      <g opacity={pending ? 0.22 : 0.94}>{FACE[civ](hall ?? null)}</g>
      {pending && <rect x="4" y="4" width="88" height="88" rx="8" fill="none" stroke="currentColor" strokeDasharray="4 4" className={s.todo} />}
    </svg>
  );
}

const SERIF = { fontFamily: "var(--font-title)" } as const;

const FACE: Record<SpineCiv, (hall: number | null) => React.ReactNode> = {
  cn: (hall) => {
    // 白文,右起竖读:右列「第 N」,左列「殿 印」。不知道第几殿:「冥府 / 之印」。
    const [r1, r2, l1, l2] = hall && hall >= 1 && hall <= 10 ? ["第", HALL_NUMERALS[hall - 1], "殿", "印"] : ["冥", "府", "之", "印"];
    const glyph = (x: number, y: number, c: string) => (
      <text x={x} y={y} textAnchor="middle" fontSize="26" fontWeight="700" className={s.onSeal} style={SERIF}>
        {c}
      </text>
    );
    return (
      <g transform="rotate(-3 48 48)">
        <rect x="10" y="10" width="76" height="76" rx="5" className={s.sealFill} />
        <rect x="16" y="16" width="64" height="64" rx="2" fill="none" strokeWidth="1.6" strokeOpacity=".9" className={s.onSealStroke} />
        {glyph(64, 46, r1)}
        {glyph(64, 76, r2)}
        {glyph(34, 46, l1)}
        {glyph(34, 76, l2)}
        {/* 两处印泥缺口 */}
        <g className={s.sealFill}>
          <circle cx="24" cy="57" r="1.4" />
          <circle cx="71" cy="24" r="1.1" />
          <circle cx="48" cy="71" r="1" />
        </g>
      </g>
    );
  },
  eu: () => (
    <g transform="rotate(4 48 48)">
      <path
        d="M89.2 48L90.6 53.6L88.2 58.8L84.8 63.2L82.1 67.7L78.7 71.6L74.8 74.8L71.7 78.9L69.1 84.5L64.8 88.4L58.6 87.7L52.8 84.8L48 84.6L42.8 87.1L37.2 88.3L32.1 86.4L27.5 83.5L23.2 80.4L20 76L18.4 70.7L15.7 66.7L10.4 63.6L5.6 59.3L5.7 53.6L9.2 48L11.3 43.2L10.9 38.1L10.9 32.6L12.8 27.7L15.3 22.9L18.2 18.2L23 15.4L29.1 15.3L34.1 14.5L37.9 10.4L42.4 5.5L48 4.6L53.3 7.8L57.9 11L62.7 12.5L67.5 14.2L71.9 16.9L76.6 19.4L81.9 22L85 26.7L84.3 33L82.9 38.6L85 43.1Z"
        className={s.sealFill}
      />
      <circle cx="48" cy="48" r="27" fill="none" strokeOpacity=".55" strokeWidth="2" className={s.onSealStroke} />
      <circle cx="48" cy="48" r="23" fill="none" strokeOpacity=".3" strokeWidth="1" className={s.onSealStroke} />
      <text x="48" y="58" textAnchor="middle" fontSize="30" fontWeight="700" fillOpacity=".8" className={s.onSeal} style={SERIF}>
        M
      </text>
      <path d="M48 26l1.6 3.4 3.4 1.6-3.4 1.6L48 36l-1.6-3.4-3.4-1.6 3.4-1.6z" fillOpacity=".7" className={s.onSeal} />
      <path d="M30 80q-2 8 2 12M64 82q3 6 0 10" strokeWidth="5" strokeLinecap="round" fill="none" className={s.sealStroke} />
    </g>
  ),
  eg: () => (
    <g>
      <rect x="24" y="6" width="48" height="76" rx="24" fillOpacity="0.1" strokeWidth="4" className={`${s.sealFill} ${s.sealStroke}`} />
      <rect x="24" y="6" width="48" height="76" rx="24" fill="none" strokeWidth="1" strokeDasharray="2 3" strokeOpacity=".7" className={s.onSealStroke} />
      <path d="M22 88H74" strokeWidth="4" strokeLinecap="round" className={s.sealStroke} />
      <path d="M40 82v6M56 82v6" strokeWidth="3" className={s.sealStroke} />
      <circle cx="48" cy="22" r="7" className={s.sealFill} />
      <path d="M48 34c-7 10-6 22 0 34 6-12 7-24 0-34z" fill="none" strokeWidth="2" className={s.sealStroke} />
      <path d="M48 36V70" strokeWidth="1.2" className={s.sealStroke} />
    </g>
  ),
  gr: () => (
    <g transform="rotate(-6 48 48)">
      <path d="M14 30L30 10 62 8 84 22 88 52 72 82 40 88 16 72 8 48Z" className={s.sealFill} />
      <path d="M30 10L36 16M84 22l-6 4M16 72l6-4" strokeOpacity=".35" strokeWidth="1.2" className={s.onSealStroke} />
      <text x="48" y="44" textAnchor="middle" fontSize="20" fontWeight="600" letterSpacing="2" fillOpacity=".85" className={s.onSeal} style={SERIF}>
        ΚΡΙ
      </text>
      <text x="48" y="68" textAnchor="middle" fontSize="20" fontWeight="600" letterSpacing="2" fillOpacity=".85" className={s.onSeal} style={SERIF}>
        ΣΙΣ
      </text>
    </g>
  ),
};
