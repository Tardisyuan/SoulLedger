# 给 Claude Design 的 prompt ⑥:egy 词表补充 · Sethet / Seshem / Pert 收口(74 条)

请在 `灵魂簿 egy 词表.dc.html` 里**继续追加一节**(不新开画布)。第五节落地时,在定稿表以外又扫到下面这批和已定词义冲突的文案。代码没有擅自改:它们属于词表定稿。

## 类别

1. **Sethet 非「技术错误」义(50 条)**:第五节说 Sethet 是「技术错误」义,但定稿表外还有约 50 处把它当通用填充(最近活动 `Khedu Sethet`、审计日志 `Medew Sethet`、通过 `… Sethet` 等)。请逐条判义:确是「错误」的保留,其余改用已定词根或补新词根。
2. **Seshem 多义(15 条)**:兼了创建、展开、图表、越级、系统层等义;第五节只说它「非设置义」。请定它唯一的义项,其余分出去。
3. **Pert 残留(4 条)**:定稿在 logout 那行写了「Pert 废止」,但调度义以外还有几处(如 `audit.access_denied`、`realms.codes.EG_DUAT_ENTRY` 的 `Duat Pert`)。请判定哪些该改。
4. **同类用词不齐(5 条)**:
   - 审计动作:`IMPORT`(导入)我们暂按「取来」写成 `Ini Seth`,请确认;`EXPORT`(导出)与 `DELETE`(删除)都写作 `Wehem Seth`,彼此撞了,删除按审核域应为 `Fekh`,导出请定一个词。
   - 「查看失败」两处:`workflow.view_error` 为 `Nen Maa`,`soul_accounts.reveal.failed` 为 `Nen Kheper Maa`,请统一。

## 规则

与已定稿的词表完全一致(核心 39 + 审核域 18 + 笔误节 24 + 分义 14 + 收口补词 5 个词根 + 18 个小词,一词一义;否定 Nen、完成后置 Seth、每词首字母大写、无撇号、无全大写;Sekhem 只表密码;加载一律 Ini;占位符 `{{...}}` 原样保留;技术词原样引用)。需要新词根时先补进词根表并说明词义。

## 交付

一张修订表,四列:键 / 中文 / 修订后 egy / 改动理由。74 行一条不漏,键名逐字照抄。判断为不改的,照抄现行值、理由以「沿用:」开头。同一个键若在两个类别里出现,两行写同一个结果。

## 清单(类别 / 键 / 中文 / 现行 egy)

```
Seshem 多义	nav.expand_menu	展开菜单	Seshem Menu
Seshem 多义	souls.events.SOUL_CREATED	灵魂登记	Aba Seshem Seth
Seshem 多义	souls.events.JUDGMENT_INITIATED	审判开始	Sheemtet Seshem Seth
Seshem 多义	souls.events.DISPOSITION_CREATED	处置生成	Wetep Seshem
Seshem 多义	souls.events.REINCARNATION_TRIGGERED	轮回触发	Aru Her Tepy Seshem
Seshem 多义	souls.events.WORKFLOW_CREATED	工作流创建	Em Her Tepy Seth Seshem
Seshem 多义	souls.events.DISPATCH_CREATED	调度创建	Pert Abuf Seshem
Sethet 非「技术错误」义	souls.detail.verdict_passed	善行通过	Sethet
Sethet 非「技术错误」义	souls.detail.previous_reincarnations	次前世的轮回记录	Aru Sethet Wu
Sethet 非「技术错误」义	souls.detail.cycle	轮回次数	Aru Sethet
Sethet 非「技术错误」义	souls.detail.reading.culpa_label	罪责（Culpa）	Culpa (Ma Sethet)
Sethet 非「技术错误」义	souls.detail.date_problems.title	日期问题	Ma Sethet Hru Wu
Sethet 非「技术错误」义	souls.detail.date_problems.codes.implausible_lifespan	寿命不合理	Ankh Ma Sethet
Sethet 非「技术错误」义	souls.detail.timeline.empty	没有符合筛选条件的记录	Nen Rekhyu Medu Sethet Em Shesep
Sethet 非「技术错误」义	souls.date_problem_filter	仅看有问题的	Aba Ma Sethet Wu
Seshem 多义	common.create	创建	Seshem
Sethet 非「技术错误」义	workflow.detail.case_type	案件类型	Pet Sethet
Sethet 非「技术错误」义	workflow.detail.priority	优先级	Setep Sethet
Sethet 非「技术错误」义	workflow.detail.order	顺序	Medu Sethet
Sethet 非「技术错误」义	workflow.detail.submit_decision	提交决定	Khemen Sethet
Sethet 非「技术错误」义	workflow.detail.history	历史	Medew Sethet
Sethet 非「技术错误」义	workflow.detail.escalate_reason_label	越级理由（必填，会写入审计）	Medu (Em Tepy, Sesh Em Medew Sethet)
Seshem 多义	workflow.detail.escalate_success	已越级推进，理由已记入审计	Seshem Hery; Medu Sesh Seth
Seshem 多义	workflow.detail.escalate_error	越级推进失败	Nen Seshem Hery Seth
Seshem 多义	workflow.detail.escalate_needs_reason	越级推进必须写明理由	Seshem Hery Em Tepy Medu Sesh
Sethet 非「技术错误」义	workflow.verdicts.passed	通过	Sethet
Seshem 多义	workflow.status.ESCALATED	已升级	Seshem Hery
Sethet 非「技术错误」义	dashboard.recent_activity	最近活动	Khedu Sethet
Sethet 非「技术错误」义	dashboard.no_activity	暂无最近活动	Nen Khedu Sethet
Sethet 非「技术错误」义	ledger.inheritance_note	功德过关即减，未熟之业不减分毫	Nefer Khet Em Sebekhet, Bin Nen Khet Sethet
Sethet 非「技术错误」义	ledger.recent_activity	最近活动	Khedu Sethet
Sethet 非「技术错误」义	ledger.civ.EUROPEAN	审判与补赎	Sheemtet We Sethet
Sethet 非「技术错误」义	judgment.verdicts.passed	通过	Sethet
Sethet 非「技术错误」义	judgment.queue.skew_discarded	设备时钟已变动，无法判断上次会话留下的裁决是否还在窗口内，未提交，该条已放回队列	Hru En Khet Khemen, Unemu En Aru Tepy Nen Setep; Nen Wetjes, Sethet Em Wedja Wu
Sethet 非「技术错误」义	judgment.detail.evidence	证据	Medu Sethet
Sethet 非「技术错误」义	judgment.no_evidence	暂无证据材料	Nen Medu Sethet Em Khemen Seth
Sethet 非「技术错误」义	judgment.grounds.title	依据条文	Medu Sethet Djed
Sethet 非「技术错误」义	audit.title	审计日志	Medew Sethet
Sethet 非「技术错误」义	audit.timestamp	时间	Seped Sethet
Sethet 非「技术错误」义	audit.filter_resource	资源类型	Pet Sethet Wu
Sethet 非「技术错误」义	audit.all_resources	所有资源	Wetu Sethet Wu
Sethet 非「技术错误」义	audit.no_logs	暂无审计日志	Nen Rekhyu Medew Sethet
Sethet 非「技术错误」义	audit.access_denied	访问被拒绝	Nen Pert Sethet Wu
Sethet 非「技术错误」义	audit.affected	影响对象	Sethet Wu
Pert 残留	realms.codes.EG_DUAT_ENTRY	杜阿特入口	Duat Pert
Pert 残留	dispatch.pending	待处理提案	Pert Abuf Em Set Medu
Sethet 非「技术错误」义	dispatch.history	历史记录	Medew Sethet
Pert 残留	dispatch.no_pending	暂无待处理提案	Nen Rekhyu Pert Abuf Em Set Medu
Pert 残留	dispatch.submit_proposal	提交提案	Wetjes Sesen Pert Abuf
Sethet 非「技术错误」义	dispatch.return_home_warning	灵魂立即回到原属租户,暂居租户不再管辖它。理由会写入审计日志。	Seth Iyi Er Per Tepy Em At. Medu Seth Sesh Em Medew Sethet.
Sethet 非「技术错误」义	dispatch.states.EXECUTED	已执行	Iri Sethet
Sethet 非「技术错误」义	dispatch.approve_warning	批准后目标租户将获得该灵魂的处置权。此操作会写入审计日志。	Per Hemes Setep Seth Ini Wetep Her Aba Pen. Sesh Em Medew Sethet.
Sethet 非「技术错误」义	crossJudgments.conclusion_types.PASS	通过	Sethet
Sethet 非「技术错误」义	settings.theme	主题	Hetep Sethet
Sethet 非「技术错误」义	settings.light	浅色	Pepy Sethet
Sethet 非「技术错误」义	settings.dark	深色	Khefere Sethet
Sethet 非「技术错误」义	settings.accent_color	强调色	Unemu Sethet
Sethet 非「技术错误」义	settings.apply	应用	Iri Sethet
Seshem 多义	icon_picker.categories.charts	图表	Seshem
Sethet 非「技术错误」义	welcome.recent_activity	最近活动	Khedu Sethet
Sethet 非「技术错误」义	welcome.view_all_activity	查看全部活动	Smen Wetu Khedu Sethet
Sethet 非「技术错误」义	table.no_results	没有符合条件的记录	Nen Rekhyu Medu Sethet
Sethet 非「技术错误」义	breadcrumb.menu.workflow	审批流程	Em Her Sethet
Sethet 非「技术错误」义	breadcrumb.menu.audit	审计日志	Medew Sethet
Sethet 非「技术错误」义	breadcrumb.menu.group_soul_ops	灵魂业务	Sethet Aba Hemsu
Sethet 非「技术错误」义	breadcrumb.menu.group_social	社交	Sesh Sethet
Seshem 多义	soul_app.settings.push_unavailable	推送暂未启用：这个版本还没有接入推送服务。下面的开关仍会记在你的账上。	Sedjem Nen Wenen Em Sesh Pen. Seshem Er Ren Ek.
Seshem 多义	soul_app.settings.push_denied	系统层面的通知已关闭。下面的开关会记住你的选择，但在系统里放行前不会送达。	Sedjem Khetem Em Seshem Ta. Seshem Rekh; Nen Iyt Er Wen.
Sethet 非「技术错误」义	soul_inbox.subtitle	灵魂写给本殿司的信。正文存在聊天服务器上,不进本库,也不进审计。	Sesh Ba Er Wesekhet Pen. Medu Em Per Medu; Nen Em Medjat, Nen Em Medew Sethet.
同类用词不齐	audit.actions.IMPORT	导入	Ini Seth
同类用词不齐	audit.actions.EXPORT	导出	Wehem Seth
同类用词不齐	audit.actions.DELETE	删除	Wehem Seth
同类用词不齐	soul_accounts.reveal.failed	查看失败，请重试	Nen Kheper Maa; Wehem Iri
同类用词不齐	workflow.view_error	查看失败	Nen Maa
```
