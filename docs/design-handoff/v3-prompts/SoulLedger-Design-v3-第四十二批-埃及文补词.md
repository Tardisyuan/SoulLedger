# 第四十二批 · 埃及文补词(2026-10-17)

第四十一批已全部落地上线(殿设置三项与开关、「等 N 人」分一人 / 两人 / 多人三个键、滞留、转生登记簿用词，都照你的回复)。`Ren Iri`(职务)我们这边没有更好的写法，就用它。

这一轮之后又多了 25 条没有埃及文的词条，都是给官员的通知，外加一个新建用户时的租户下拉。zh / en 已定，只缺 egy。规则照旧：只用 `packages/core/messages/egy.json` 里已出现的词，没有新词根；`{{…}}` 占位符原样保留。

## 背景
- 这些通知以前只有中文，现在按界面语言显示，所以要补齐。
- 转生申请、缩短冷却两类原来是「状态:××」一句话，现在拆成每种结果一句(状态词不在语言包里，没法只替换一个占位符)。同一类的标题相同。
- `cross_judgment_cancelled` 是新的：取消跨域审判时通知席上各方，带理由。和 `cross_judgment_concluded`(你在第四十一批给的 `Wedja Ta Ky Khetem Seth`)成对。
- `soul_account_provisioning_failed` 正文里的 `backfill_soul_accounts` 是命令名，原样保留，不译。
- `users.tenant_pick`:网页新建用户时，先选账号所属的租户(殿)，选了才出现机构和职务。

## 词条

| 键 | zh-Hans | en |
|---|---|---|
| `official_notify.assistant_cap_closed.body` | 本月估算花费 {{spent}} 已到上限 {{cap}},助手总开关已自动关闭。次月 1 日早上 8 点(北京时间)会自动重开;也可以到「助手管理」页调高上限后手动打开。 | Estimated spend this month, {{spent}}, has reached the cap of {{cap}}, and the assistant master switch is off. It switches back on by itself on the 1st at 8:00 Beijing time, or raise the cap on the Assistant admin page and switch it on by hand. |
| `official_notify.assistant_cap_closed.title` | 助手已自动关闭:本月花费到达上限 | Assistant switched off: monthly cap reached |
| `official_notify.assistant_cap_warning.body` | 本月估算花费 {{spent}},上限 {{cap}}。到上限时助手会自动关闭;每月 1 日早上 8 点(北京时间)换月。 | Estimated spend this month is {{spent}} against a cap of {{cap}}. The assistant switches off at the cap; the month rolls over on the 1st at 8:00 Beijing time. |
| `official_notify.assistant_cap_warning.title` | 助手本月花费已到上限的 80% | Assistant spend at 80% of this month's cap |
| `official_notify.assistant_reopened.body` | 上个月助手因花费到达上限被自动关闭,本月已自动重开(每月 1 日早上 8 点北京时间换月)。 | The assistant was switched off last month when spend reached the cap. It is back on for the new month (the month rolls over on the 1st at 8:00 Beijing time). |
| `official_notify.assistant_reopened.title` | 助手已自动重开:新的一个月 | Assistant switched back on: new month |
| `official_notify.cooldown_decided_approved.body` | 您的缩短冷却申请:已批准。 | Your request to shorten the cooldown was approved. |
| `official_notify.cooldown_decided_approved.title` | 缩短冷却申请有了结果 | Cooldown shortening decided |
| `official_notify.cooldown_decided_rejected.body` | 您的缩短冷却申请:已驳回。 | Your request to shorten the cooldown was rejected. |
| `official_notify.cooldown_decided_rejected.title` | 缩短冷却申请有了结果 | Cooldown shortening decided |
| `official_notify.cross_judgment_cancelled.body` | 跨域审判「{{title}}」已取消。理由：{{reason}} | The cross-realm judgment {{title}} was cancelled. Reason: {{reason}} |
| `official_notify.cross_judgment_cancelled.title` | 跨域审判已取消 | Cross-realm judgment cancelled |
| `official_notify.rebirth_status_appeal_rejected.body` | 您的转生申请状态:申诉被驳回。 | The appeal on your rebirth application was rejected. |
| `official_notify.rebirth_status_appeal_rejected.title` | 转生申请状态更新 | Rebirth application update |
| `official_notify.rebirth_status_appealing.body` | 您的转生申请状态:申诉中。 | Your rebirth application is under appeal. |
| `official_notify.rebirth_status_appealing.title` | 转生申请状态更新 | Rebirth application update |
| `official_notify.rebirth_status_approved.body` | 您的转生申请状态:已批准。 | Your rebirth application was approved. |
| `official_notify.rebirth_status_approved.title` | 转生申请状态更新 | Rebirth application update |
| `official_notify.rebirth_status_rejected.body` | 您的转生申请状态:已驳回。 | Your rebirth application was rejected. |
| `official_notify.rebirth_status_rejected.title` | 转生申请状态更新 | Rebirth application update |
| `official_notify.rebirth_status_under_review.body` | 您的转生申请状态:审批中。 | Your rebirth application is under review. |
| `official_notify.rebirth_status_under_review.title` | 转生申请状态更新 | Rebirth application update |
| `official_notify.soul_account_provisioning_failed.body` | 灵魂「{{soul}}」已登记死亡,但灵魂账号没有开成。请运行 backfill_soul_accounts 补开。 | Soul {{soul}} is registered as dead, but its soul account was not opened. Run backfill_soul_accounts to open it. |
| `official_notify.soul_account_provisioning_failed.title` | 灵魂账号开通失败 | Soul account could not be opened |
| `users.tenant_pick` | 选择租户 | Choose a tenant |
