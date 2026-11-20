# 第四十四批 · 埃及文补词(2026-10-19)

第四十三批(审批流程选站、跨域审判并入流程)已全部落地上线，网页 W-1~W-5、官员 App O-1~O-4 都照你的稿和文案做了。你回复里的埃及文已全部用上。

实现时多出 17 条你稿里没有的词条，zh / en 已定，只缺 egy。规则照旧：只用 `packages/core/messages/egy.json` 里已出现的词，没有新词根;`{{…}}` 占位符原样保留。

## 背景
- **两步确认**:网页结案弹层勾「生成审批流」后，「结案」变成「下一步」进选站页，选站页有「上一步」。官员 App 不用这两个键。
- `workflow.pick.cross_forced`:原审判挂着进行中的跨域审判时，结案必须生成流程，「生成审批流」勾选框锁成勾上，下面写这一句。网页结案弹层和审判队列台都用。
- `workflow.pick_group.hall`:「待我选站」那一行里发起殿的名字，由冥界名加殿号拼成，例如「杜阿特」+「第一殿」→「杜阿特第一殿」。中文不加空格，英文加一个空格。若 egy 的语序不同(殿号在前)，请直接给出顺序。
- `workflow.history.*`:流程详情底部的记录，一条一句。`adjusted_added` / `adjusted_skipped` 是加减站时只加回或只跳过一边的写法；两边都有时用你给过的 `workflow.history.adjusted`。`{{added}}` / `{{skipped}}` 是用顿号连起来的站名。
- `workflow.gate.stopped_here`:流程详情里，停在门口的那一格上的短标签。
- `crossJudgments.workflow_running`:跨域审判页上，流程还在走时「结束」按钮不显示，换成这一句。
- `scheduler.jobs.workflow_pick_reminders_for_tenant`:定时任务列表里那条每日提醒的名字。

## 词条

| 键 | zh-Hans | en |
|---|---|---|
| `workflow.pick.next` | 下一步 | Next |
| `workflow.pick.back` | 上一步 | Back |
| `workflow.pick.cross_forced` | 这一案挂着跨域审判：结案要生成审批流程，外域按顺序接在后面。 | A cross-realm judgment is open on this case: concluding generates an approval flow, with the other realms following in order. |
| `workflow.pick.load_error` | 没能取到这次的站，请重试 | Couldn't load the stations — try again |
| `workflow.pick_group.action` | 选站 | Pick |
| `workflow.pick_group.hall` | {{realm}}{{court}} | {{realm}} {{court}} |
| `dashboard.todo.go_pick` | 选站 → | Pick → |
| `workflow.history.picked_all` | {{actor}} 为{{realm}}选站，全部要走 | {{actor}} picked stations for {{realm}}; all to go |
| `workflow.history.adjusted_added` | {{actor}} 加减站：加回 {{added}}。理由：{{reason}} | {{actor}} changed stations: restored {{added}}. Reason: {{reason}} |
| `workflow.history.adjusted_skipped` | {{actor}} 加减站：跳过 {{skipped}}。理由：{{reason}} | {{actor}} changed stations: skipped {{skipped}}. Reason: {{reason}} |
| `workflow.history.default` | {{actor}} 替{{realm}}按默认流程走。理由：{{reason}} | {{actor}} went with the default flow for {{realm}}. Reason: {{reason}} |
| `workflow.gate.stopped_here` | 停在这里 | Stopped here |
| `workflow.gate.no_picker_body` | 待办已转给该域的殿管理员。管理员也没有时，可以直接按默认流程走。 | The task went to that realm's hall admins. If there are none, you can go with the default flow now. |
| `workflow.gate.remind_too_soon` | 一小时内已经提醒过，稍后再试 | Already reminded within the hour — try again later |
| `workflow.segment.error` | 没能保存，请重试 | Couldn't save — try again |
| `crossJudgments.workflow_running` | 审批流程还在走：流程走完或被驳回时，跨域审判随之结束。要提前停下，请取消跨域审判。 | The approval flow is still running: this judgment ends when the flow finishes or is rejected. To stop early, cancel the cross-realm judgment. |
| `scheduler.jobs.workflow_pick_reminders_for_tenant` | 提醒外域选站 | Remind realms to pick stations |

## 要的回复
按上表每个键给一行 egy。某个词条在现有词表里写不出来时，请说明缺哪个意思，我们先空着。
