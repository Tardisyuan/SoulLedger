# 给 Claude Design 的 prompt ⑤:egy 词表补充 · 设置 / 加载 / Sethety 收口(35 条)

请在 `灵魂簿 egy 词表.dc.html` 里**继续追加一节**(不新开画布)。第四节定了「设置 Smen · 加载 Ini」,但第四节清单之外还有下面这些没有跟上。代码没有擅自改：它们属于词表定稿。

## 类别

1. **Sethety 残留(19 条)**:`Sethety` 不在任何词根表里(`settings.title` 仍是 `Iri Sethety`,模板等键里还有 18 处)。请判定它在各处的真实义项(设置?配置?模板?),改用已定词根，或补一个新词根并说明词义。
2. **「加载」未用 Ini(10 条)**:中文含「加载 / 载入」,但 egy 写作 `Khemut`、`Smen`、`Em Iri` 等。
3. **「设置」未用 Smen(5 条)**:中文含「设置」但没有 Smen。
4. **`Wa-Ek` 请确认(1 条)**:第四节的词根表登记的是 `Wa-Ek`(一个词，意为「仅自己」),而 `social.visibility.PRIVATE` 那一行写的是 `Wa Ek`(两个小词，字面是「仅 + 你的」)。代码目前按行写入了 `Wa Ek`。按词根表，我们认为应为 `Wa-Ek`(与 `Djes-Ef` 同类的连字符合成词);请确认，并把修订行改成与词根表一致。

## 规则

与已定稿的词表完全一致(核心 39 + 审核域 18 + 笔误节 24 + 分义 14 个词根 + 18 个小词，一词一义;否定 Nen、完成后置 Seth、每词首字母大写、无撇号、无全大写;Sekhem 只表密码;占位符 `{{...}}` 原样保留;技术词原样引用)。

## 交付

一张修订表，四列：键 / 中文 / 修订后 egy / 改动理由。35 行一条不漏，键名逐字照抄。判断为不改的，照抄现行值、理由以「沿用：」开头。

## 清单(类别 / 键 / 中文 / 现行 egy)

```
加载未用 Ini	souls.detail.loading	加载灵魂数据中...	Khemut Aba Hemsu...
Sethety 残留	souls.detail.merit	功德	Aha Sethety
Sethety 残留	souls.detail.demerit	罪业	Ma Aha Sethety
加载未用 Ini	common.loading	加载中...	Smen...
Sethety 残留	permissions.display_name_placeholder	如: 审核员	Renu Sethety Em Kheme
Sethety 残留	permissions.matrix.confirm_replace_notice	此接口为整体替换：保存将删除下列角色现有的全部授权，再按下方结果重建。	Aha Medu Wehem Renenu: Kheme Seth We Wehem Renenu Sethety Netjer, Iri Weben Em Khet.
加载未用 Ini	permissions.matrix.partial_save_hint	整体重试会把它们按旧版本号再发一次，服务器会当成冲突拒绝。重试前请先重新加载。	Wehem Iri Neb: Hab Djer Em Hemet-Sesh Tepy — Per Aa Khesef. Wehem Maa Er Tepy.
Sethety 残留	workflow.editor.template_name_placeholder	模板名称	Ren Pet Sethety
Sethety 残留	workflow.editor.save_template	保存模板	Pedet Pet Sethety
Sethety 残留	workflow.editor.saved	模板已保存	Pet Sethety Pedet Seth
Sethety 残留	workflow.editor.title	流程编辑器	Khemen Pet Sethety
Sethety 残留	workflow.templates	流程模板	Pet Sethety Wu
Sethety 残留	workflow.select_template	选择模板进行编辑	Sesh Pet Sethety Em Khemen
Sethety 残留	workflow.new_template	新建模板	Pet Sethety Werpet
Sethety 残留	workflow.custom_templates	自定义模板	Pet Sethety Wu Ab
Sethety 残留	workflow.predefined_templates	预定义模板	Pet Sethety Wu Pedjety
Sethety 残留	workflow.delete_confirm_msg	确定要删除模板 "{{name}}" 吗？	Sesen Wehem Pet Sethety «{{name}}»?
Sethety 残留	workflow.select_from_left	请从左侧选择一个模板	Sesh Pet Sethety Em Sa
Sethety 残留	workflow.template	模板编辑器	Pet Sethety
加载未用 Ini	workflow.detail.loading	加载审批流程中...	Khemut Em Kheme Seth...
Sethety 残留	workflow.template_detail	模板详情	Medu Pet Sethety
加载未用 Ini	dashboard.error_load	加载统计数据失败	Nen Khemut Medew
加载未用 Ini	judgment.detail.loading	加载审判中...	Khemut Sheemtet Seth...
Sethety 残留	audit.clear_filters	清除筛选	Iri Sethety Wu
加载未用 Ini	notifications.loading	加载中...	Smen...
加载未用 Ini	dispatch.tenants_error	租户列表加载失败。请重试。	Nen Gem Sesh Per-Hemsu. Wehem Iri.
加载未用 Ini	crossJudgments.failed_to_load	加载失败	Nen Khemut Seth
Sethety 残留	settings.title	设置	Iri Sethety
设置未用 Smen	soul_accounts.rebirth.cross_hint	仅在初审节点待决时，由该节点指定的审批人设置	Em Sekhet Wedja Tepy Wa: Sab Sekhet Pen Wedja
Wa Ek 与词根 Wa-Ek	social.visibility.PRIVATE	私密	Wa Ek
设置未用 Smen	breadcrumb.menu.group_settings	系统设置	Sethet Aat
加载未用 Ini	soul_app.common.loading	加载中…	Em Iri…
设置未用 Smen	soul_app.settings.title	设置	Seshem
设置未用 Smen	soul_app.settings.open_system_settings	前往系统设置	Wen Seshem Ta
设置未用 Smen	soul_app.settings.toggle_failed	没能保存这项设置，已恢复原样	Nen Sesh; Ankh Er Tepy
```
