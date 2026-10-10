# 第十六批 · 第十五批落地反馈 + egy 待定 57 条(2026-10-10)

第十五批和补充的规格都已落地(收信箱、书信发图、权限「覆盖」三项等产品确认，未做)。两件事请你回：
一、落地时有 8 处和规格对不上，我们先按现实做了，请确认或改规格；二、新增文案 57 条 + 改词 4 条请给 egy。

---

## 一、和规格对不上的 8 处

**1. 改密码后其他设备会不会退出(你问的)。** 现在**不会**：后端只换密码，不吊销已有登录，其他设备继续保持登录。所以成功提示照现在。是否改成「改密码后其他设备退出」产品还在定；定了要改再请你补那句文案。

**2. 权限导入摘要 ·「文件来自{{hall}}」做不了。** 导出文件里没有殿的标识 —— 权限和角色两张表本身是全局的，不分殿。所以摘要第一行只写「文件名 · 当前殿名」，没有「来自别的殿」的提醒。请确认去掉这一条。

**3. 权限导入摘要 ·「将更新」恒为 0。** 合并模式只新增、不改已有的条目，所以这一行永远是 0。现在照规格保留这一行。请定：保留(以后做「覆盖」时才会有数)，还是合并模式下去掉这一行。

**4.「将跳过(已存在且相同)」的括号改了。** 合并不比较内容：已存在但内容不同的条目同样被跳过；被「仅管理员可得」等规则挡下的也算跳过。「且相同」会说错，现在写的是「将跳过(已存在，或被规则挡下)」。请确认或给更好的说法。

**5. 权限导入第 2 步没有「上一步」。** 规格没画。现在想换文件只能取消后重开。请定要不要加。

**6. 官员 App 待办 ·「移交」和「改派请求」是同一组。** 你排的六组里把它们分成第 2、第 3 两组。实际上 App 里原来叫「改派请求」的那一组，列的就是「别的殿提给本殿的调拨提案」，和官员台的移交收件列表是同一批数据；系统里没有第二个「改派」队列。所以没有新加一组，而是把这一组改名为「移交」。现在的顺序：审批节点 → 移交 → 缩短冷却申请 → 转生申请 →(待回书信，未做)。请确认五组。

**7. 受刑计划没有独立的打印页。** 受刑计划不是一个页面，是灵魂档案里的一张卡，所以它随灵魂档案一起打印。实际做了打印的是两页：判词(审判详情)、灵魂档案(含受刑计划卡)。请确认，或告诉我们受刑计划需要单独成页。
另：「第 N 页 / 共 M 页」只有 Chrome / Edge 会显示；Firefox 和 Safari 不支持这种页码，页脚只剩左边的案号。页眉页脚每页重复在各浏览器都有。

**8. 两处小的自定：**
- 评议区「展开其余 N 条」这一行，放在显示的 3 条**上方**(更早的在上)。规格没写上下。
- 灵魂详情右栏「全部 N 场 ›」**没做**：审判列表页现在不能按灵魂筛选，要先改列表页。案号那一格的前两条(未结 / 已结)和「—」都做了。
- 三处导出：移交、处置、跨殿审判这三页本身没有用户可选的筛选框，所以导出的是「这张表 / 这一段当前的内容」。入口是每张表右上的「导出」按钮。

---

## 二、egy

### 改词 4 条(中文从「改派」改成了「移交」，egy 还是旧词)

| key | 中文(新) | English(新) | egy(现在，旧词) |
|---|---|---|---|
| officer_app.todo.groups.reassignments | 移交 | Handovers | Dbh Hab Ky |
| officer_app.kinds.reassignment | 移交 | Handover | Dbh Hab Ky |
| officer_app.confirm.approve_body.reassignment | 批准后这次移交成立。 | The handover goes ahead. | Hesy: Hab Ky Pen Smen. |
| officer_app.todo.empty_body | 新的审批、移交和申请会推送给你。 | New approvals, handovers and requests will be pushed to you. | Wat Hesy, Dbh Hab Ky Hena Dbh Renpi: Sedjem Sab. |

请定这四条要不要换成官员台「移交」已有的写法。

### 待定 57 条

占位符(`{{…}}`、`{step}` 等)请原样保留。egy 暂时显示中文。
说明几组的用处：
- `permissions.config.*`：权限页「更多 ⋯」菜单与导入三步弹层。
- `soul_app.update_required.*` / `officer_app.update_required.*`：「需要更新」整屏；`soul_app.errors.*`：出错整屏(两个 App 共用)。
- `officer_app.comment.*`：评议区(Web 与 App 共用这一组)。
- `notifications.*`：通知列表的勾选与批量条。
- `print.*`：打印页脚与判词页的「打印」按钮；`page_pre / page_mid / page_post` 是「第 / 页 / 共 … 页」被页码隔开的三段。
- `common.export*`：三处新导出按钮。

### `permissions.config`(27 条)

| key | 中文 | English |
|---|---|---|
| permissions.config.export | 导出配置 | Export configuration |
| permissions.config.exporting | 导出中… | Exporting… |
| permissions.config.export_error | 导出失败,请稍后重试。 | Export failed. Try again later. |
| permissions.config.import | 导入配置… | Import configuration… |
| permissions.config.import_title | 导入配置 · {step}/3 | Import configuration · {step}/3 |
| permissions.config.choose_file | 选择文件 | Choose file |
| permissions.config.file_hint | 选择由「导出配置」得到的 JSON 文件,最大 {max}。 | Choose a JSON file produced by "Export configuration". Up to {max}. |
| permissions.config.merge_note | 只做合并:文件里有而系统里没有的条目会被新增;已存在的条目不会被修改或删除。 | Merge only: entries in the file that the system lacks are added; existing entries are neither changed nor deleted. |
| permissions.config.errors.not_json | 这不是有效的 JSON 文件。 | This is not a valid JSON file. |
| permissions.config.errors.too_large | 文件过大,上限 {max}。 | The file is too large. The limit is {max}. |
| permissions.config.errors.bad_structure | 文件结构不对:需要是导出配置得到的 JSON 对象,且至少含 permissions、roles、role_permissions、field_permissions、data_scopes 之一。 | Wrong structure: expected a JSON object from "Export configuration" containing at least one of permissions, roles, role_permissions, field_permissions, data_scopes. |
| permissions.config.errors.empty | 文件里没有任何可导入的条目。 | The file contains nothing to import. |
| permissions.config.confirm | 确认导入 | Confirm import |
| permissions.config.importing | 导入中… | Importing… |
| permissions.config.import_error | 导入失败:{reason} | Import failed: {reason} |
| permissions.config.reason_unknown | 服务器没有给出原因。 | The server gave no reason. |
| permissions.config.more | 更多 | More |
| permissions.config.next | 下一步 | Next |
| permissions.config.checking | 检查中… | Checking… |
| permissions.config.done | 完成 | Done |
| permissions.config.will.add | 将新增 | Will add |
| permissions.config.will.update | 将更新 | Will update |
| permissions.config.will.skip | 将跳过(已存在,或被规则挡下) | Will skip (already present, or blocked by a rule) |
| permissions.config.did.add | 新增 | Added |
| permissions.config.did.update | 更新 | Updated |
| permissions.config.did.skip | 跳过(已存在,或被规则挡下) | Skipped (already present, or blocked by a rule) |
| permissions.config.download_skipped | 下载跳过明细 | Download skipped details |

### `soul_app.update_required`(4 条)

| key | 中文 | English |
|---|---|---|
| soul_app.update_required.title | 需要更新 | Update required |
| soul_app.update_required.body | 这一版已经不能用了。更新后，你的书信和档案都还在。 | This version can no longer be used. After you update, your letters and records will still be there. |
| soul_app.update_required.button | 去更新 | Update |
| soul_app.update_required.version | 版本 {{version}} | Version {{version}} |

### `officer_app.comment`(2 条)

| key | 中文 | English |
|---|---|---|
| officer_app.comment.show_rest | 展开其余 {{n}} 条 | Show {{n}} more |
| officer_app.comment.after_close | 结案后 | After closing |

### `officer_app.update_required`(1 条)

| key | 中文 | English |
|---|---|---|
| officer_app.update_required.body | 当前版本 {{version}} 低于本殿要求的最低版本 {{min}}。 | Version {{version}} is below the minimum this hall requires, {{min}}. |

### `soul_app.errors`(2 条)

| key | 中文 | English |
|---|---|---|
| soul_app.errors.reported | 已自动报告。 | Reported automatically. |
| soul_app.errors.go_home | 回到首页 | Back to home |

### `notifications.select_all`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.select_all | 全选 | Select all |

### `notifications.select_row`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.select_row | 选择通知:{{title}} | Select notification: {{title}} |

### `notifications.batch_region`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_region | 通知批量操作 | Batch actions for notifications |

### `notifications.batch_selected`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_selected | 已选 {{n}} 条 | {{n}} selected |

### `notifications.batch_limit`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_limit | 一次至多 {{n}} 条 | at most {{n}} at a time |

### `notifications.batch_clear`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_clear | 取消选择 | Clear selection |

### `notifications.batch_deleted`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_deleted | 已删除 {{count}} 条 | Deleted {{count}} |

### `notifications.batch_delete_error`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_delete_error | 删除失败 | Failed to delete |

### `notifications.batch_delete_title`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_delete_title | 删除所选的 {{n}} 条通知? | Delete {{n}} notifications? |

### `notifications.batch_delete_message`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.batch_delete_message | 删除后将从你的收件箱消失,不影响别人的通知。 | They disappear from your inbox. This does not affect anyone else's notifications. |

### `common.export`(1 条)

| key | 中文 | English |
|---|---|---|
| common.export | 导出 | Export |

### `common.export_failed`(1 条)

| key | 中文 | English |
|---|---|---|
| common.export_failed | 导出失败 | Export failed |

### `print.button`(1 条)

| key | 中文 | English |
|---|---|---|
| print.button | 打印 | Print |

### `print.case_no`(1 条)

| key | 中文 | English |
|---|---|---|
| print.case_no | 案号 | Case no. |

### `print.soul_no`(1 条)

| key | 中文 | English |
|---|---|---|
| print.soul_no | 灵魂编号 | Soul no. |

### `print.page_pre`(1 条)

| key | 中文 | English |
|---|---|---|
| print.page_pre | 第  | Page  |

### `print.page_mid`(1 条)

| key | 中文 | English |
|---|---|---|
| print.page_mid |  页 / 共  |  of  |

### `print.page_post`(1 条)

| key | 中文 | English |
|---|---|---|
| print.page_post |  页 | . |

### `dashboard.data_as_of`(1 条)

| key | 中文 | English |
|---|---|---|
| dashboard.data_as_of | 数据截至 {{time}} | Data as of {{time}} |

### `souls.detail`(2 条)

| key | 中文 | English |
|---|---|---|
| souls.detail.case_open | 未结 | Open |
| souls.detail.case_closed | 已结 | Concluded |

---

## Design 回复

(待填)
