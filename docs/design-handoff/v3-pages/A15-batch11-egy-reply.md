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
