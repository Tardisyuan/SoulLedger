import type { CaseAttachmentErrorCode } from "@soulledger/core/api/judgment";

/**
 * 案卷附件在浏览器这一侧的预检(Design 第二十八批 W4)。**只为早一点给出提示,不是闸门**:服务端按文件头的魔数
 * 判类型、按字节判大小(`apps/judgment/attachments.py`),这里认扩展名 / MIME 只会放过或拦下得更早,
 * 拦不下一个伪装的文件。HEIC 不收(服务端没有转 JPG 的依赖),提示同「只能传图片或 PDF」。
 */
const MB = 1024 * 1024;
const ALLOWED = /\.(jpe?g|png|pdf)$/i;

export function looksAllowed(file: { name: string; type: string }): boolean {
  return ALLOWED.test(file.name) || ["image/jpeg", "image/png", "application/pdf"].includes(file.type);
}

/** 一位小数的 MB(1 MB 以下写 KB):`4.2 MB`。 */
export function formatBytes(bytes: number): string {
  return bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MB).toFixed(1)} MB`;
}

export function megabytes(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

/** 类型方块里的三个字母。 */
export function kindTile(contentType: string): string {
  if (contentType === "application/pdf") return "PDF";
  return contentType === "image/png" ? "PNG" : "JPG";
}

export const isPdf = (contentType: string) => contentType === "application/pdf";

/** 服务端的拒绝 `code` → 语言包键。没有 `code` 的失败(断网、5xx)不在这里。 */
export const ERROR_KEY: Record<string, string> = {
  bad_type: "case.attachments.failed_type",
  too_large: "case.attachments.too_large",
  case_full: "case.attachments.full",
  too_many: "case.attachments.too_many",
};

/** 这些拒绝重试也不会好 —— 行上只留「移除」。 */
export const isFinalRefusal = (code: string | undefined): code is CaseAttachmentErrorCode =>
  code !== undefined && code in ERROR_KEY;
