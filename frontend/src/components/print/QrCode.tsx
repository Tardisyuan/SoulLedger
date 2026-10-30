import { toQR } from "toqr";

const QUIET_ZONE = 4;
/** toqr's `ECLevel.M` (its `.d.ts` declares the enum `const`, which an isolated-modules build cannot import). */
const EC_M = 0;

/**
 * 二维码矩阵,纠错级别 M(第二十批 §一.1)。同一输入每次得到同一矩阵。
 *
 * 2026-10-30 起用 `toqr`(约 13 KB,MFA 向导本来就在用)代替 `qrcode-generator`(约 52 KB):站里只留一个二维码库。
 * toqr 只有字节模式,不走字母数字模式 —— `SL1:<10 位>` 共 14 个字符,正好是 1-M 字节模式的容量,仍是 21×21
 * 的第 1 版;扫码器按符号里的模式解码,读出来的字符串一样。编号若变长,符号会升到第 2 版(25×25),不会读错。
 */
export function qrMatrix(text: string): boolean[][] {
  const cells = toQR(text, EC_M);
  const n = Math.round(Math.sqrt(cells.length));
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => cells[r * n + c] === 1));
}

/**
 * 纯黑白矢量:一条 path,每个深色模块一格。打印时按 `size`(CSS 长度,交付单用 42mm)缩放,不糊。
 * 四周留 4 个模块的静区,扫码器靠它找边。
 */
export function QrCode({ text, size, label }: { text: string; size: string; label?: string }) {
  const matrix = qrMatrix(text);
  const total = matrix.length + QUIET_ZONE * 2;
  const d = matrix
    .flatMap((row, r) =>
      row.map((dark, c) => (dark ? `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z` : "")),
    )
    .join("");
  return (
    <svg
      data-qr=""
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width={total} height={total} fill="white" />
      <path d={d} fill="black" />
    </svg>
  );
}
