# 第十一批 · officer_app egy 核对(Design 2026-10-09)

> 存档自 Design 项目 `bf5707ac…` `templates/soulledger-v3-pages/v3-batch11-egy-reply.md`。
> egy 全表在同目录 `A15-officer_app.egy.json`:按实现的 key 结构重写，覆盖全部 136 条，另加 `tenants.settings.security`,可整份导入。
> 旧 key 已删：`kinds.reassign`、`mfa.verify`、`mfa.error_*`、`login.choose_hall`、`cosign.title/hint/ok`。

## 1. 占位符(6 条)
| key | 新 egy | 说明 |
|---|---|---|
| queue.claim_failed | Shesep Nen Kheper | 去掉 {reason}。不写「Nen Shesep」,因为它是「Nen Shesep Djer」(待认领)的开头 |
| search.residing | ▲ {{where}} · Hemes | 改用 {where},带 ▲ |
| me.version | Hemet-Sesh {{version}} | 补上 {version},删掉 Hemsu(中文没有「系统」) |
| mfa.remember | Medjat Pen: Nen Hehy Djer Em Hru 30 | 30 天写死，与实现一致;以后改成可配置时三种语言一起改成 {days} |
| mfa.error_wrong → reasons.wrong | Medu Ahet Nen Maat | 去掉 {n} |
| mfa.error_locked → reasons.locked | Sep Menmen. Wehem Iri Er Khet. | 去掉 {time};Menmen 意为「过多」 |

## 2. 词表违规
- `confirm.reasons.network`、`mfa.reasons.network`、`login.reasons.network` 改为 **Nen Em Senb**(已上线的 `offline` 原词)。
- `confirm.reasons.other`:中文是「服务器没有接受」,原 egy 只写了「Ky」(其他),改为 **Per Hemsu Nen Shesep**。

## 3. cosign
- `unavailable` 保留。
- `title` 用 `detail.cosign`,`ok` 对应 `cosign.confirm`,`hint` 作废。
- 新增三条：`added`、`not_eligible`(逐项写出本殿 / 在职 / 有审批权)、`duplicate`。

## 4. 其余新增
- 评议沿用朋友圈评论的词根 **Wesheb**,`scope_note` 已补上「写评议」。
- 天数：「还剩」写作 `Hru {{n}} Khery`,「更少」写作 `Nedjes`。
- `days_invalid` 没写「整数」,因为输入框只接受整数。如果实现允许输入小数，请告诉 Design。
- 失败句统一用「X Nen Kheper」,与 decide_failed 一致。
- `mfa.reasons.expired`:中文已改为「登录超时」,egy 改为 **Aq Unut Khetem. Wehem Er Aq.**
- 新组合 **Medjat Maa**(验证器 App),全库没有撞车。

## 5. 对照中文复核后改的已有 egy
- `banner.mfa_required`:改为 Netjer-Ek: Aq Sep Sen Nen Shu; Nen Smen Djer. Smen Em Medjat Sab.
- `me.logout_title`:改为 Per Aq? Medjat Pen Nen Sedjem Sab Djer.
- `mfa.use_recovery`:改为 Iri Em Medu Ankh Wehem。

## 6. 请改中文
- `confirm.approve_body.reassignment`:「调拨」改为「改派」;英文 dispatch 改为 reassignment。
- `cosign.duplicate`:「联署人」改为「加签人」。

## 7. 其他
- `tenants.settings.security` = **Sa**。
- `dashboard.trends.*` 的原文当时还缺，已在「第十一批-补充」里发给 Design。

---

# 补充(Design 2026-10-09 晚)

JSON 已合并进 `A15-officer_app.egy.json`(含 dashboard / soul_app / soul_accounts 三段)。

## A. 画稿(A15)
- **14j**:标题改为「加签 · 服务端返回不允许」。置灰说明只在服务端拒绝时出现(稿里的 `detail="cosign_denied"`),文案用 `cosign.unavailable`。
- **15a 加签面板**:
  - 可以选人，「确认加签」可点。
  - 副标题改为：只列本殿在职、有审批权限的官员;加签人先批，你才能批;加签人驳回则整个节点驳回。
  - 候选人里去掉书吏。
  - 搜索框文案用 `cosign.search`。
- **15b / 15c 等加签人先批**:
  - 「已签」列表新增一行「◐ 孟判官 · 加签 · 待批」。
  - 「批准」置灰，按钮上方加 ◇ 说明句，同一句写进 accessibilityHint。
  - 「驳回」「加签」不受影响。
- **15d–15f 灵魂端申请表**:
  - 「希望缩短到几天 · 可选」放在申请理由下方、提交按钮上方。
  - 输入框宽 96,后接「天」;提示句在输入框下方。
  - 出错时红框，并显示「! 天数须是 0 到 {{max}} 的整数」。
- **15g 待决定**:灵魂端也显示「申请希望：还剩 N 天」。复用 `soul_accounts.cooldown.desired`,还是另开 `soul_app.cooldown.desired`,由我们定。

### 新增两个 key
| key | 中文 | English |
|---|---|---|
| officer_app.detail.cosigner_pending | 加签 · 待批 | Added signer · pending |
| officer_app.detail.wait_cosigner | 等{{name}}先批，你才能批。{{name}}驳回则这一节点驳回。 | {{name}} signs first; then you can approve. If {{name}} rejects, this step is rejected. |

官员台的审批详情也要同样处理(「批准」置灰并显示这句说明),用同一组 key,不另画。

## B. dashboard.trends.* egy 要点
- 趋势 = Kheper Hru(新组合);title 和 error 都改。
- 30 天、90 天去掉了「近」(Pehwy)。
- 升 / 降 = Er Hry / Er Khery;持平 = Nen Khemen。

## C. 缩短冷却
- 希望 = Mer;可选 = Setep(不能用 Nen Shu,那是「必填」)。
- 官员两端的 `confirm.desired` 和 `soul_accounts.cooldown.desired` 同形:Mer: Hru {{n}} Khery。

## Design 自己还没改完的两处
- 申请表「填了 5 天」那张稿里，理由框和天数框同时显示焦点框，应该只留一个。
- 官员 App 审判页底部的说明句(稿上)还没有「写评议」;实现以 `queue.scope_note` 为准。
