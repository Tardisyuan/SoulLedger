# 第二十九批 · 四句文案(2026-10-15)

第二十八批的小项已上线。下面四句还缺,请给 zh / en / egy 的最终写法。不需要出稿。

| key | 现在的中文(我们拟的或稿上的) | 用在哪里 | 缺什么 |
|---|---|---|---|
| officer_app.todo.filter_empty_title | 没有「{{kinds}}」待办 | 官员 App 待办按类型筛选后为空(`{{kinds}}` 是所选类型,用「、」连接) | egy |
| officer_app.todo.filter_empty_body | 换个类型看看，或清除筛选。 | 同上,标题下的一句 | egy |
| list.columns.hint | 显示哪些列 · 只在这台浏览器上记住 | 官员台列菜单顶部的小字(第二十八批稿上有,词条表里没给) | 三语都缺,中文照稿 |
| soul_app.mfa.copied_clears | (待定)已复制。60 秒后从剪贴板清除。 | 灵魂 App 复制恢复码或两步验证密钥后的提示 | 三语都要,中文请改写 |

关于第四条:产品已定「复制恢复码 / 两步验证密钥后,60 秒自动清空剪贴板(若剪贴板里仍是那串码)」。
现在复制后有一条「已复制」的提示,想在同一条里说明会清除。请确认:
1. 是否值得告诉用户(还是静默清除就好);
2. 如果说,请给最终写法,并说明是否复用现有的「已复制」词条加后半句。

egy 用到新词根请注明义项;已废止写法(`Seped` 等)词表守卫会拦。

---

## Design 回复(2026-10-15,原文在 Design 项目 `v3-batch29-reply.md`,下面是用户转来的摘要)

- `officer_app.todo.filter_empty_title` egy:`Nen «{{kinds}}» Djer`。en 与 egy 里 `{{kinds}}` 用 `, ` 连接(zh 仍用「、」)。
- `officer_app.todo.filter_empty_body` egy:`Setep Iru Ky, Er Sehen Setep.`
- `list.columns.hint`:zh 照稿「显示哪些列 · 只在这台浏览器上记住」;en `Columns to show · remembered in this browser only`;egy `Iwn Maa · Smen Em Medjat Sab Pen Wa`。
- `soul_app.mfa.copied_clears`:值得告诉用户;用一条新的完整词条,不在「已复制」后拼半句;秒数用 `{{seconds}}`。
  - zh「已复制。请在 {{seconds}} 秒内粘贴，之后会从剪贴板清除。」
  - en「Copied. Paste it within {{seconds}} seconds; after that it's cleared from the clipboard.」
  - egy `Senn Seth. Redi Em Sekhet {{seconds}}; Em Khet Sehen Seth.`
  - 中文不写「清空剪贴板」(只在剪贴板里仍是那串码时才清);真正清除时不再弹提示。
- 没有新词根。`Redi`(放下)借来表示「粘贴」:若词表要求一词一义,登记为新义项。
