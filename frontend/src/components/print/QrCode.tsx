import qrcode from "qrcode-generator";

const QUIET_ZONE = 4;

/**
 * 二维码矩阵。内容 `SL1:<10 位>` 全是大写字母、数字和冒号,走字母数字模式;纠错级别 M(第二十批 §一.1)。
 * 同一输入每次得到同一矩阵。
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Alphanumeric");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
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
