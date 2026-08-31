"use client";

/**
 * 根布局自己抛错时,用户看到的东西。
 *
 * WHY。仓库里有 32 个 `error.tsx` + 32 个 `loading.tsx`,覆盖很好 —— 但
 * `app/error.tsx` 是**渲染在根布局里面的**。`app/layout.tsx` 自身抛错时,
 * 那一层还没建立起来,Next 会退回到它内置的错误页;开发模式下是一屏堆栈,
 * 生产模式下是一段没有本地化、没有品牌、没有任何指引的默认文案。
 *
 * **那正是「四个绿灯,首页 500」那次用户看到的东西**(见 `src/config/locale.ts`
 * 的文件头:`tsc` 通过、`eslint` 干净、`build` 成功、1689 个单测全过,而首页
 * 运行时 500,因为 `"use client"` 的边界是运行时语义,类型检查看不见它)。
 *
 * `global-error.tsx` **必须自带 `<html>` 与 `<body>`** —— 它替换的就是根布局,
 * 所以那两个标签这里没有别人来提供。
 *
 * 也**不能用 `useI18n()`**:I18n 的 provider 挂在根布局里,而根布局正是那个
 * 出错的东西。文案写死成中英双语,而不是调用一个此刻可能不存在的 hook ——
 * 一个在错误边界里自己抛错的错误边界,是最难诊断的那一种。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-Hans">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif",
          background: "#0b0d12",
          color: "#e6e8ee",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "36rem" }}>
          <div style={{ fontSize: "3rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            500
          </div>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
            页面框架加载失败 · The page shell failed to load
          </h1>
          <p style={{ opacity: 0.7, margin: "0 0 1.5rem", lineHeight: 1.6 }}>
            这一层出错时,应用的语言设置和主题都还没有建立起来,所以这段文字没有
            翻译。
            <br />
            This layer fails before the app&apos;s locale and theme exist, so this
            message is not translated.
          </p>
          {/* `digest` 是 Next 给生产环境错误的稳定标识 —— 用户能把它念给你听,
              而堆栈不能。 */}
          {error.digest ? (
            <p style={{ opacity: 0.5, fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}>
              digest: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #2a2f3a",
              background: "#151922",
              color: "#e6e8ee",
              cursor: "pointer",
              marginRight: "0.75rem",
            }}
          >
            重试 · Retry
          </button>
          <a
            href="/"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #2a2f3a",
              color: "#e6e8ee",
              textDecoration: "none",
            }}
          >
            回到首页 · Home
          </a>
        </div>
      </body>
    </html>
  );
}
