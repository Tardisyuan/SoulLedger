import { useId } from "react";

/**
 * 登录交付单的装饰(Design 第二十四批第二稿,`docs/design-handoff/v3-pages/soul-login/DeliverySlipCiv.dc.html`):
 * 外框 + 匾额带 + 带上的纹样,与正文分隔线。坐标原样取自画稿(746 × 376 的框,左上角距纸边 24)。
 *
 * 颜色:线与实心块取 `currentColor`,由外层的 `data-slip-ink`(`app/print-slip-ink.css`)决定是纯黑还是文明色;
 * 匾额上的白色纹样固定 `white`。装饰里没有文字,四种语言共用。
 * 同一页上框与两条分隔线各带一份 pattern,id 带 `useId`,互不冲突。
 */

export type SlipCiv = "cn" | "eg" | "eu" | "gr" | "neutral";

/** EU 尖拱带:36 个拱,画稿 `renderVals` 的生成算法。 */
function euBandPath() {
  const n = 36;
  const w = 730 / n;
  const r = (w * 0.75).toFixed(2);
  let d = "M8 8H738V68";
  for (let i = 0; i < n; i++) {
    const x1 = 738 - i * w;
    d += `A${r} ${r} 0 0 0 ${(x1 - w / 2).toFixed(2)} 58A${r} ${r} 0 0 0 ${(x1 - w).toFixed(2)} 68`;
  }
  return `${d}Z`;
}

const EU_BAND = euBandPath();

const BAND = <rect data-slip-band="" x="8" y="8" width="730" height="60" fill="currentColor" stroke="none" />;

export function SlipFrame({ civ }: { civ: SlipCiv }) {
  const uid = useId().replace(/:/g, "");
  const common = { width: 746, height: 376, viewBox: "0 0 746 376", fill: "none", stroke: "currentColor", "aria-hidden": true } as const;
  const emblem = civ === "neutral" ? undefined : civ;

  if (civ === "cn") {
    return (
      <svg {...common} data-slip-emblem={emblem}>
        <rect x="1" y="1" width="744" height="374" strokeWidth="2" />
        <rect x="5.5" y="5.5" width="735" height="365" strokeWidth=".75" />
        {BAND}
        <rect x="11.5" y="11.5" width="723" height="53" stroke="white" strokeWidth=".75" />
        <path stroke="white" strokeWidth="1" d="M16 16H28V28H20V22H24M16 60H28V48H20V54H24M730 16H718V28H726V22H722M730 60H718V48H726V54H722" />
      </svg>
    );
  }
  if (civ === "eg") {
    return (
      <svg {...common} data-slip-emblem={emblem}>
        <defs>
          <pattern id={`${uid}-kh`} width="8" height="6" patternUnits="userSpaceOnUse" x="9" y="61">
            <path d="M2 6V3.5a2 2 0 0 1 4 0V6" stroke="white" strokeWidth=".75" />
          </pattern>
        </defs>
        <rect x=".5" y=".5" width="745" height="375" strokeWidth="1" />
        <path d="M4.5 8V365M741.5 8V365" strokeWidth=".5" />
        {BAND}
        <path d="M8 59.5H738" stroke="white" strokeWidth=".5" />
        <rect x="9" y="61" width="728" height="6" fill={`url(#${uid}-kh)`} stroke="none" />
        <g transform="translate(373 36)" fill="white" stroke="none">
          <circle r="6.5" />
          <path d="M-9-3H-46L-42 0H-9ZM-9 1.5H-38L-34 4.5H-9ZM9-3H46L42 0H9ZM9 1.5H38L34 4.5H9Z" />
        </g>
        <path d="M1 365.25H745" strokeWidth=".5" />
        <path d="M1 370H745" strokeWidth="3" />
      </svg>
    );
  }
  if (civ === "eu") {
    return (
      <svg {...common} overflow="visible" data-slip-emblem={emblem}>
        <path strokeWidth="1.5" d="M12 1H734A11 11 0 0 0 745 12V364A11 11 0 0 0 734 375H12A11 11 0 0 0 1 364V12A11 11 0 0 0 12 1Z" />
        <path strokeWidth=".5" d="M14 5H732A9 9 0 0 0 741 14V362A9 9 0 0 0 732 371H14A9 9 0 0 0 5 362V14A9 9 0 0 0 14 5Z" />
        <path data-slip-band="" fill="currentColor" stroke="none" d={EU_BAND} />
        <g transform="translate(373 36)" stroke="white" strokeWidth=".75">
          <circle r="13" />
          <circle cx="-5" r="5" />
          <circle cx="5" r="5" />
          <circle cy="-5" r="5" />
          <circle cy="5" r="5" />
        </g>
        <path fill="white" strokeWidth="1" d="M373-4L378 1 373 6 368 1ZM373 370L378 375 373 380 368 375Z" />
      </svg>
    );
  }
  if (civ === "gr") {
    return (
      <svg {...common} data-slip-emblem={emblem}>
        <defs>
          <pattern id={`${uid}-mw`} width="9" height="6" patternUnits="userSpaceOnUse" x="10" y="61">
            <path d="M0 5.5H7V.5H2V3.5H5" stroke="white" strokeWidth=".6" />
          </pattern>
          <pattern id={`${uid}-dn`} width="7" height="3" patternUnits="userSpaceOnUse" x="10" y="10.5">
            <rect width="4" height="3" fill="white" />
          </pattern>
        </defs>
        <rect x=".75" y=".75" width="744.5" height="374.5" strokeWidth="1.5" />
        <path d="M4.5 8V371.5M741.5 8V371.5M4.5 371.5H741.5" strokeWidth=".5" />
        {BAND}
        <rect x="10" y="10.5" width="726" height="3" fill={`url(#${uid}-dn)`} stroke="none" />
        <path d="M10 59.5H736" stroke="white" strokeWidth=".5" />
        <rect x="10" y="61" width="726" height="6" fill={`url(#${uid}-mw)`} stroke="none" />
      </svg>
    );
  }
  // 中性:实心匾额带 + 单线框,没有文明纹章。
  return (
    <svg {...common}>
      <rect x=".75" y=".75" width="744.5" height="374.5" strokeWidth="1.5" />
      {BAND}
    </svg>
  );
}

/** 8 高的分隔线(正文底部与存根标题下);每个文明一种。 */
export function SlipRule({ civ }: { civ: SlipCiv }) {
  const uid = useId().replace(/:/g, "");
  const common = { width: "100%", height: 8, fill: "none", stroke: "currentColor", "aria-hidden": true } as const;
  if (civ === "cn") {
    return (
      <svg {...common}>
        <line x1="0" y1="1" x2="100%" y2="1" strokeWidth="2" />
        <line x1="0" y1="5.5" x2="100%" y2="5.5" strokeWidth=".75" />
      </svg>
    );
  }
  if (civ === "eg") {
    return (
      <svg {...common}>
        <defs>
          <pattern id={`${uid}-dots`} width="6" height="8" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="6" r=".9" fill="currentColor" stroke="none" />
          </pattern>
        </defs>
        <line x1="0" y1="1.5" x2="100%" y2="1.5" strokeWidth="1.5" />
        <rect x="0" y="0" width="100%" height="8" fill={`url(#${uid}-dots)`} stroke="none" />
      </svg>
    );
  }
  if (civ === "eu") {
    return (
      <svg {...common} overflow="visible">
        <line x1="0" y1="4" x2="100%" y2="4" strokeWidth=".75" />
        <svg x="50%" y="0" overflow="visible">
          <path d="M0 0L4 4 0 8-4 4Z" fill="white" strokeWidth=".75" />
        </svg>
      </svg>
    );
  }
  if (civ === "gr") {
    return (
      <svg {...common}>
        <defs>
          <pattern id={`${uid}-mz`} width="12" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 7.5H9.5V.5H2.5V5H6.5" strokeWidth=".75" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100%" height="8" fill={`url(#${uid}-mz)`} stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <line x1="0" y1="4" x2="100%" y2="4" strokeWidth=".75" />
    </svg>
  );
}
