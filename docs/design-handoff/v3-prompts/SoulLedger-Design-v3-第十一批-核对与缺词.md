# SoulLedger Design v3 · 第十一批:第十批落地后的核对与缺词(2026-10-09)

第十批已全部落地。附件 `officer_app-全表-2026-10-09.md` 是 `officer_app.*` 的完整对照表(key / 中文 / English / egy,共 136 条，其中 44 条还没有 egy)。
表头写明了以下三类**没有导入**的值，请逐条给出改法:

1. **占位符对不上**(6 条):`queue.claim_failed`、`search.residing`、`me.version`、`mfa.remember`、`mfa.error_wrong`、`mfa.error_locked`。
2. **违反词表规则**:`confirm.reasons.network` 和 `mfa.reasons.network` 的「Nen Aq Er Per Hemsu」。按第十四节,Hemsu 只能用在中文含「系统 / 服务器 / 队列 / 连接」的 key 里，这两条的中文是「网络错误」。
3. **key 名对不上**:你写的 `cosign.title / hint / ok` 在实现里没有对应 key,所以没导入。实现里的 key 是 `cosign.unavailable`(原 `no_endpoint`)、`cosign.added / not_eligible / duplicate`。

另外有些 key 你说过没见过中文原文，是按 key 名写的 egy,这次请对照表里的中文逐条核一遍。

## 一、和第十批不同的地方(都是实现时做的决定，请确认)

- **「写评议」回来了**:评议接口已经做了,App 审判页出了「写评议」入口。所以 `queue.scope_note` 的中文与英文**保留**「写评议」:「手机上可以认领、查看、写评议。宣判和盖印请在官员台完成。」。egy 暂时还是你给的那句(不含写评议),请补一句含写评议的。
- **加签已开通**:后端做了「加签」。14j 的置灰说明只在服务端回答「不允许」时出现。
  - 规则：只有当前节点的审批人能加，被加的人必须是本殿、在职、有审批权限，不能是自己。
  - 加签人须先批，审批人才能批;加签人驳回则整个节点驳回。
- **趋势面板受设计规范约束的偏差**:
  - 外框圆角 8 去掉了(规范只允许 0 / 9999px / 50%);
  - 殿设置「安全」标题用 15px,不是 17(字号阶只有 15 和 20);
  - 内边距用了任意值 20px。
  - 请确认，或告诉我们该改规范还是改稿。
- **状态格名**:用的是官员台已有的 `souls.states` 文案,ALIVE 显示「存活」,不是稿上的「在世」(灵魂端 App 用的是「在世」)。要不要把官员台统一成「在世」?
- **App 加签说明句**:React Native 没有 `aria-describedby`,说明句直接放在按钮正上方，前面加 ◇。
- **缩短冷却**:灵魂申请时新增「希望缩短到几天」(可不填)。官员两端用它预填「批准后还剩几天」,并显示「申请希望：还剩 N 天」。需要的话请补灵魂端申请表里这一项的样式。

## 二、新增、还没有 egy 的 key

| key | 中文(实现) |
|---|---|
| dashboard.trends.subtitle / dimension_label / empty_title / empty_body / partial / change_up / change_down / change_flat / change_from_zero / figure_label | 趋势面板各句(空态和「区间未满」的说明你那边只给了开头，我们补写了全文，请一并审) |
| tenants.settings.security | 安全 |
| officer_app.cosign.added / not_eligible / duplicate | 加签结果的三种提示 |
| officer_app.confirm.verdict_label | 批准时选择结论 |
| officer_app.comment.title / empty / write / send / failed | 评议区各句 |

具体中文见附件对照表，以及 `packages/core/messages/zh-Hans.json`。
