# 给 Claude Design 的 prompt ⑦:egy 词表补充 · 「失败」写法与零星收口(30 条)

请在 `灵魂簿 egy 词表.dc.html` 里**继续追加一节**(不新开画布)。第六节定了「失败一律 Nen + 动词,不叠 Kheper」,但全库(包括定稿表内)还有 29 处 `Nen Kheper`。代码没有擅自改,也没设门禁,因为定稿表自己也有 12 处。

## 类别

1. **`Nen Kheper` 叠用(29 条)**:请逐条定成「Nen + 具体动词」(登录失败、结案失败、驳回失败……各用自己的动词),或判定某些确属「未成」义而保留 —— 保留的请在理由里写明,我们据此做门禁白名单。其中 `dispatch.return_home_blocked_open_judgment` 中文是「审判未结案」,不是「失败」,`Wedja Nen Kheper` 用词可疑。
2. **单条**:
   - `social.delete_post_confirm` / `delete_comment_confirm`:删除写成了 `Wehem Sesh` / `Wehem Djed`,不是审核域定的 `Fekh`;「无法撤销」写成了 `Nen Kheperu Em Khet`。(若这两条已在上面 29 条里,写同一个结果。)
   - `souls.date_problem_marker.error`(中文「日期错误」)是 `Ma Sethet Hru …`:Sethet 合法,但 `Ma` 作否定已废止;同族的 `date_problems.title` 已改成 `Khet Hru`,请一并定。
3. **词根表补登**:`Hab-Ba`(调拨)全库已用 17 次,定稿理由列说「调拨统一 Hab-Ba」,但它不在任何词根表里。请补进词根表并说明词义。

## 规则

与已定稿的词表完全一致(六张词根表 + 18 个小词,一词一义;否定 Nen、完成后置 Seth、每词首字母大写、无撇号、无全大写;Sekhem 只表密码;Sethet 只表技术错误;Seshem 只表推进;加载一律 Ini;占位符 `{{...}}` 原样保留)。

## 交付

一张修订表,四列:键 / 中文 / 修订后 egy / 改动理由,30 行一条不漏,键名逐字照抄;不改的照抄现行值、理由以「沿用:」开头。另附补登的词根行。

## 清单(类别 / 键 / 中文 / 现行 egy)

```
Nen Kheper 叠用	auth.error_login_failed	登录失败	Nen Kheper Aq
Nen Kheper 叠用	souls.detail.verdict_failed	恶行失败	Nen Kheper
Nen Kheper 叠用	souls.detail.error_update	更新失败	Nen Kheper Em Khemen
Nen Kheper 叠用	souls.detail.failed	失败	Nen Kheper
Nen Kheper 叠用	souls.detail.date_problems.ack_error	操作失败	Nen Kheper Aha
Nen Kheper 叠用	workflow.verdicts.failed	失败	Nen Kheper
Nen Kheper 叠用	judgment.verdicts.failed	失败	Nen Kheper
Nen Kheper 叠用	judgment.queue.error_body	请重试；若持续失败，请检查审判读取权限。	Wehem Iri. Nen Kheper Djer: Maa Was Maa Wedja.
Nen Kheper 叠用	judgment.detail.conclude_error	审判完结失败	Nen Kheper Khetem Wedja
Nen Kheper 叠用	judgment.conclude_error	结案失败	Nen Kheper Khetem
Nen Kheper 叠用	profile.password_change_failed	密码修改失败	Nen Kheper Khemen Sekhem
Nen Kheper 叠用	dispatch.return_home_blocked_open_judgment	灵魂仍有未结案的审判,结案或撤案后才能结束暂居	Wedja Nen Kheper; Nen Seneb Kehat
Nen Kheper 叠用	dispatch.reject_error	驳回失败	Nen Kheper Khesef
Nen Kheper 叠用	death_sync.status.FAILED	处理失败	Nen Kheper
Nen Kheper 叠用	soul_accounts.credentials.retry_failed	重试失败	Nen Kheper Wehem Hab
Nen Kheper 叠用	soul_accounts.credentials.deliver_failed	标记失败	Nen Kheper Sesh Djeret
Nen Kheper 叠用	soul_accounts.account.failed	操作失败，请重试	Nen Kheper; Wehem Iri
Nen Kheper 叠用	disposition.execute_error	执行处置失败	Nen Kheper Iri Wetep
Nen Kheper 叠用	social.delete_post_confirm	确定要删除这条帖子吗？此操作无法撤销。	Sesen Wehem Sesh Seth? Nen Kheperu Em Khet.
Nen Kheper 叠用	social.delete_comment_confirm	确定要删除这条评论吗？此操作无法撤销。	Sesen Wehem Djed Seth? Nen Kheperu Em Khet.
Nen Kheper 叠用	scheduler.rebuild_failed	重建失败	Nen Kheper Wehem Iri Ahet
Nen Kheper 叠用	scheduler.filters.failing	连续失败	Nen Kheper Wehem
Nen Kheper 叠用	scheduler.jobs.scheduler_reap_stale_runs	收尾卡死的执行记录	Khetem Sesh Iri Nen Kheper
Nen Kheper 叠用	scheduler.status.FAILURE	失败	Nen Kheper
Nen Kheper 叠用	scheduler.flags.failures	连续失败 {{count}} 次	Nen Kheper Wehem {{count}}
Nen Kheper 叠用	scheduler.run.failed	运行请求失败	Nen Kheper Dbh Iri
Nen Kheper 叠用	scheduler.toggle.failed	启停失败	Nen Kheper Wen
Nen Kheper 叠用	social_moderation.failed	操作失败	Nen Kheper
Nen Kheper 叠用	soul_inbox.failed	操作失败,请重试	Nen Kheper. Wehem Iri
单条待定	souls.date_problem_marker.error	日期错误 — 详见灵魂详情	Ma Sethet Hru — Nau Aba Hemsu
```
