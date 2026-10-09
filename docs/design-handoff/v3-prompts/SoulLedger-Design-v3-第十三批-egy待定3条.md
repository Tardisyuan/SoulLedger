# 第十三批 · egy 待定 3 条(2026-10-09)

官员 App 在模拟器上实跑后，我们改了两处，多出 3 条文案，现在回退显示中文，请给 egy。

| key | 中文 | English | 用在哪里 |
|---|---|---|---|
| soul_accounts.rebirth.appeal_title | 转生申请申诉 · {{name}} | Rebirth appeal · {{name}} | 申诉件的标题(普通件沿用已有的 `soul_accounts.rebirth.detail_title`) |
| soul_accounts.cooldown.fields.remaining_after | 批后剩余冷却 | Cooldown left after approval | 官员台：缩短冷却批准后的字段名 |
| officer_app.confirm.remaining_after | 批后还剩 {{n}} 天 | {{n}} days left after approval | 官员 App:缩短冷却批准后的详情 |

## 改动背景
- **转生申请标题**:原来是「转生申请: YX39MP69VW」(灵魂编号，半角冒号)。现在两端都显示「转生申请 · 灵魂名」,编号放到副行。
- **缩短冷却详情**:批准后原来还显示申请时的「还剩 30 天」,现在显示批准后的实际剩余天数。

「还剩 N 天」已有写法 `Hru {{n}} Khery`;「批后」怎么写，以及「申诉」用哪个词，请你定。
