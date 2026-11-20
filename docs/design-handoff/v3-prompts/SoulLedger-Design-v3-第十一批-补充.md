# 第十一批 · 补充(2026-10-09)

## 一、你等的确认：三项都同意，请画
1. **14j 改稿**:标题去掉「(未开通)」;置灰说明改成服务端返回「不允许」时才出现的状态。
2. **节点状态「等加签人先批」**:请补稿。规则：加签人先批，审批人才能批;加签人驳回则整个节点驳回。
3. **灵魂端申请表「希望缩短到几天」**:请补稿。可以不填，文案见下面第三节。

其余几条按你说的办，我们这边会改：
- 趋势面板内边距改成间距阶里最接近的值;
- 官员台继续用「存活」;
- React Native 的说明句同时写进按钮的 `accessibilityHint`;
- 三处 `reasons.network` 改用 Nen Em Senb;
- 中文「调拨」改「改派」(英文 dispatch 改 reassignment),「联署人」改「加签人」。

## 二、`dashboard.trends.*` 原文(请补 egy)

| key | 中文 | English |
|---|---|---|
| title | 趋势 | Trends |
| subtitle | 每日 00:00 快照 · 较区间起点 | Snapshot every day at 00:00 · vs the start of the range |
| range_label | 范围 | Range |
| range_30d / range_90d / range_12m | 30 天 / 90 天 / 12 个月 | 30 days / 90 days / 12 months |
| dimension_label | 维度 | Dimension |
| by_state / by_civilization | 按状态 / 按文明 | By state / By civilization |
| empty_title | 还没有快照 | No snapshots yet |
| empty_body | 每天 00:00 记一张。区间没满时，只画已有的天数。 | One is taken every day at 00:00. While the range isn't full, only the days that exist are drawn. |
| partial | 只有 {{n}} 天的快照。左边空着的部分不是零，是那几天还没有记录。 | Only {{n}} days of snapshots. The empty part on the left isn't zero: those days have no record yet. |
| change_up / change_down | 升 {{pct}}% / 降 {{pct}}% | up {{pct}}% / down {{pct}}% |
| change_flat | 持平 | flat |
| change_from_zero | 自 0 起 | from 0 |
| figure_label | {{name}},{{value}},{{change}} | {{name}}, {{value}}, {{change}} |
| error | 趋势没取到 | Trends couldn't be loaded |

部分 key(title、range_*、by_*、error)以前就有 egy,改了中文的请一起核对。

## 三、缩短冷却「希望缩短到几天」新增的 5 条(请补 egy)

| key | 中文 | English |
|---|---|---|
| soul_app.cooldown.desired_label | 希望缩短到几天(可选) | Days you hope remain (optional) |
| soul_app.cooldown.desired_hint | 现在还剩 {{n}} 天。填 0 表示希望立即结束;不填则由官员决定。 | {{n}} days left now. Enter 0 to hope for an immediate end; leave blank to let the officer decide. |
| soul_app.cooldown.desired_invalid | 天数须是 0 到 {{max}} 的整数 | Enter a whole number from 0 to {{max}} |
| soul_accounts.cooldown.desired | 申请希望：还剩 {{n}} 天 | Requested: {{n}} days left |
| officer_app.confirm.desired | 申请希望：还剩 {{n}} 天 | Requested: {{n}} days left |

字段含义：灵魂希望批准后**还剩**几天，0 表示希望冷却立即结束。官员两端用它预填「批准后还剩几天」,官员可以改。
