"use client";

import { useMemo } from "react";
import { toQR } from "toqr";

/**
 * 二维码(A12 向导第二步),前端生成:`toqr`(~1.3 kB,已在锁文件里作为 @expo/cli 的依赖,
 * 现在也写进 frontend 的 package.json —— 不靠提升出来的幻影依赖)。返回 n×n 的 0/1 平铺数组。
 *
 * 白底是刻意的,深色主题也白:验证器 App 的相机要对比度,不要主题。
 */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { n, dark } = useMemo(() => {
    const cells = toQR(value);
    const n = Math.round(Math.sqrt(cells.length));
    const dark: string[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) if (cells[y * n + x]) dark.push(`M${x} ${y}h1v1h-1z`);
    }
    return { n, dark };
  }, [value]);
  // 4 modules of quiet zone on every side, as the QR spec asks.
  const quiet = 4;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="mfa-qr"
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
      shapeRendering="crispEdges"
      style={{ background: "#fff" }}
    >
      <path d={dark.join("")} fill="#000" />
    </svg>
  );
}
