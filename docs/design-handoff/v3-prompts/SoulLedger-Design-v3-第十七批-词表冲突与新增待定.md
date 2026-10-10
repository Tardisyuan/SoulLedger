# 第十七批 · 词表冲突、两处请更正、新增待定 28 条(2026-10-10)

第十六批的规格与大部分 egy 已落地。这一批四件事：两处请你更正自己的文件；15 条词被我们的词表守卫拦下，请换词或确认登记；新功能的 28 条待定；两处落地后的事实请知悉。

---

## 一、请更正(2 处)

**1.「轮回完成」请改回 Khetem Seth。**
你在第十六批里把 `souls.events.REINCARNATION_COMPLETED` 改成了 Wehem Mesut **Kheper** Seth，并说这是第十四批的决定。第十四批你的原话正相反：

> `souls.events.REINCARNATION_COMPLETED`:**Wehem Mesut Khetem Seth** …… 不用 Kheper Seth:那是工作流节点的「完成」。

Web 时间线现在是 Khetem Seth，我们没有改。请把 `officer_app.egy.json` 改回 Khetem Seth。

**2.「移交」用了官员台已有的 Hab-Ba，没有用 Swedj。**
你说「官员台如果已经有写法，四条都照官员台换，两边必须是同一个词」。官员台的移交页在 egy 里一直写 Hab-Ba(页面标题 `Iri Hab-Ba`，放弃草稿 `Sehen Sesh Tepy Hab-Ba Pen?`，事件 `DISPATCH_*` 也是)。所以 4 条写成：

| key | egy(已落地) |
|---|---|
| officer_app.todo.groups.reassignments | Hab-Ba |
| officer_app.kinds.reassignment | Hab-Ba |
| officer_app.confirm.approve_body.reassignment | Hesy: Hab-Ba Pen Smen. |
| officer_app.todo.empty_body | Wat Hesy, Hab-Ba Hena Dbh Renpi: Sedjem Sab. |

你担心 Hab-Ba 已经是受刑计划的「调拨」。在系统里这两者是同一种记录：受刑计划的调拨就是一条移交，只是由计划自动发起。所以同一个词是对的。Swedj 没有登记。请确认。

---

## 二、被词表守卫拦下的 15 条

我们的 egy 守卫是封闭词表：每个词必须已登记，且不能用已废止的写法。下面 7 个词不在你第十六批列的新词根里，其中 2 个在你之前定的废止名单里。这 15 条现在仍显示中文。

| 词 | 你的用意 | 问题 | 涉及 |
|---|---|---|---|
| Bu | 处(Bu Tepy = 首页) | 在**第十节废止名单**里 | 1 条 |
| Wer | 很(Aa Wer = 太大) | 在**第十二节废止名单**里 | 1 条 |
| Ir | 做(Ir Mawy = 更新) | 未登记；已有的「做」是 Iri | 5 条 |
| Ket | 条目 | 未登记 | 4 条 |
| Hap | 规则 | 未登记(你写的是「沿用已有的词」，但词表里没有) | 2 条 |
| Ip | 检查 | 未登记 | 1 条 |
| Kheri | 低于 | 未登记 | 1 条 |

每个词请回一种：**登记**(确认是新词根，Bu / Wer 则需要你明确从废止名单里拿出来并说明为什么)，或**换词**(给出改后的整句)。另外 Mawy、Sni 这两个你列了的新词根只出现在被拦下的句子里，会随这些句子一起登记。

`permissions.config.merge_note` 的中文这一轮改过了(见下表)，上次的 egy 作废，请重给。
### 这 15 条的原文

| key | 中文 | 你上次给的 egy |
|---|---|---|
| soul_app.errors.go_home | 回到首页 | Er Bu Tepy |
| permissions.config.errors.too_large | 文件过大,上限 {max}。 | Djama Aa Wer; Aa Er {max}. |
| soul_app.update_required.title | 需要更新 | Ir Mawy |
| soul_app.update_required.body | 这一版已经不能用了。更新后，你的书信和档案都还在。 | Hemet-Sesh Pen Nen Iri Djer. Ir Mawy: Sesh-Ek Hena Medjat-Ek Wenen Djer. |
| soul_app.update_required.button | 去更新 | Ir Mawy |
| permissions.config.will.update | 将更新 | Er Ir Mawy |
| permissions.config.did.update | 更新 | Ir Mawy Seth |
| permissions.config.will.skip | 将跳过(已存在,或被规则挡下) | Er Sni (Wenen Seth, Mi Khesef Em Hap) |
| permissions.config.did.skip | 跳过(已存在,或被规则挡下) | Sni Seth (Wenen Seth, Mi Khesef Em Hap) |
| permissions.config.checking | 检查中… | Ip Djer… |
| permissions.config.more | 更多 | Ky Ket |
| permissions.config.merge_note | 默认合并:文件里有而系统里没有的条目会被新增;已存在的条目不会被修改或删除。要覆盖,在下一步选择。 | (旧) |
| permissions.config.download_skipped | 下载跳过明细 | Redi Per Ket Sni |
| permissions.config.errors.empty | 文件里没有任何可导入的条目。 | Nen Ket Er Ini Em Djama. |
| officer_app.update_required.body | 当前版本 {{version}} 低于本殿要求的最低版本 {{min}}。 | Hemet-Sesh {{version}} Kheri Er Hemet-Sesh Wesekhet {{min}}. |


---

## 三、新增待定 28 条

占位符请原样保留(单括号、双括号都照中文那一列)。用处：
- `officer_app.todo.groups.letters` / `kinds.letter` / `letter.*`：官员 App 的「待回书信」(已按你的文字规格做出来)。
- `soul_app.chat.image.*`：灵魂 App 书信发图(已按你的文字规格做出来)。
- `permissions.config.mode.*` / `overwrite.*` / `will.remove` / `did.remove`：权限导入的「覆盖」模式。
- `souls.detail.case_all`、`judgment.soul_filter*`：灵魂详情右栏「全部 N 场 ›」与审判列表上的灵魂筛选标记。
- `profile.password_*`：改密码成功提示(其他设备已退出)与密码太弱的各条原因。

| key | 中文 | English |
|---|---|---|
| officer_app.todo.groups.letters | 待回书信 | Letters to answer |
| officer_app.kinds.letter | 书信 | Letter |
| officer_app.letter.irreversible | 发出后不能撤回 | Cannot be undone once sent |
| officer_app.letter.unavailable | 书信暂未开通 | Letters are not available yet |
| officer_app.letter.failed | 没能发出。内容还在，请重试。 | Could not send. Your text is still here; try again. |
| souls.detail.case_all | 全部 {{n}} 场 › | All {{n}} › |
| judgment.soul_filter | 灵魂 | Soul |
| judgment.soul_filter_clear | 清除灵魂筛选 | Clear the soul filter |
| permissions.config.will.remove | 将删除 | Will delete |
| permissions.config.did.remove | 已删除 | Deleted |
| permissions.config.mode.label | 导入方式 | Import mode |
| permissions.config.mode.merge | 合并(默认) | Merge (default) |
| permissions.config.mode.overwrite | 覆盖 | Overwrite |
| permissions.config.overwrite.warning | 覆盖会删除文件里没有的 {n} 条权限。不能撤回。 | Overwrite deletes {n} permission entries that are not in the file. This cannot be undone. |
| permissions.config.overwrite.warning_own | 覆盖会删除文件里没有的 {n} 条权限,包括你自己的。不能撤回。 | Overwrite deletes {n} permission entries that are not in the file, including your own. This cannot be undone. |
| permissions.config.overwrite.all_halls | 权限配置不分殿:覆盖影响所有殿,不只是 {hall}。 | Permission configuration is not per hall: overwrite affects every hall, not only {hall}. |
| permissions.config.overwrite.blocked_own | 文件里没有的权限包括你自己的,不能覆盖。请把它们补进文件,或改用合并。 | The entries missing from the file include your own, so overwrite is blocked. Add them to the file, or merge instead. |
| permissions.config.overwrite.action | 覆盖导入 | Overwrite and import |
| profile.password_changed_others_out | 密码已修改,其他设备上的登录已退出 | Password changed. Other devices have been signed out. |
| profile.password_reason_common | 这个密码太常见,请换一个 | That password is too common. Choose another. |
| profile.password_reason_numeric | 密码不能全是数字 | The password cannot be all digits. |
| profile.password_reason_similar | 密码与用户名或个人信息太像,请换一个 | The password is too similar to your username or other details. |
| profile.password_reason_invalid | 新密码不符合要求,请换一个更长、更不常见的密码 | That password is not acceptable. Choose a longer, less common one. |
| profile.password_old_wrong | 旧密码不正确 | The old password is not correct. |
| soul_app.chat.image.failed | 没能发出 | Could not send |
| soul_app.chat.image.errors.too_many_pending | 未发出的图片太多，稍等一下再选 | Too many images waiting to send; wait a moment |
| soul_app.chat.image.errors.images_unavailable | 对方回信之前只能写文字 | Until they reply, only text can be sent |
| soul_app.chat.image.button | 图 | Photo |

---

## 四、落地后的事实，请知悉(有意见再说)

**1. 改密码后其他设备会退出(产品已定)。** 当前设备保持登录。成功提示用了新键 `profile.password_changed_others_out`(在上表里)。你之前说「定了再补一句」，就是这一条。

**2. 权限「覆盖」影响所有殿，不只是当前殿。** 权限配置在系统里不分殿，是全局的。所以危险提示里多了一句规格里没有的话(`permissions.config.overwrite.all_halls`)。确认方式仍按你定的「输入当前殿名」——用一个殿的名字确认一个影响所有殿的操作，不太对称，请看要不要换成别的确认词。
另：「删除名单里有自己的权限就禁止覆盖」已实现，但现实中不会触发 —— 能导入的只有管理员，而管理员的权限不在这些表里。提示里「包括你自己的」这半句只在确实包含时才显示，所以平时看不到。

**3. 待回书信、书信发图已按文字规格做出来**，你画稿时可以对着现状改。几处自定：
- 书信发图的入口是一个写着「图」字的键(现有图标集里没有图片图标)。请给图标或确认用字。
- 官员台(Web)看大图复用了审核后台的查看器，有「关闭」按钮和「第几张」计数；灵魂 App 是点一下关闭、没有按钮。请定是否统一。
- 推送和通知预览里图片消息仍是通用的「某某给你写了一封信」，没有单独的「[图片]」字样。

**4. 页码改成了一个整句键** `print.page_label`(中文「第 {{n}} 页 / 共 {{m}} 页」，egy「Pesh {{n}} / {{m}}」，显示结果与你定的一样)。原因是语言包不允许空串，而你给的第三段是空的。

---

## Design 回复

(待填)
