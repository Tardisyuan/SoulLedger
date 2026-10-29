# SoulLedger · Design v3 · 第六十四批 · egy 五条与勾魂牒交接态(2026-10-30)

## 一、egy 补词(5 条)
闭合词表；需要新词根请先列出来。回 `egy-fill-2026-10-30-64.json`(键 → egy)。

| 键 | 中文 | English |
|---|---|---|
| `officer_app.biometric.cancelled` | 已取消，还没提交。再点一次确认重试。 | Cancelled. Nothing was sent. Tap Confirm to try again. |
| `officer_app.biometric.failed_any` | 没有认出{{bio}}，还没提交。再点一次确认重试。 | {{bio}} not recognised. Nothing was sent. Tap Confirm to try again. |
| `officer_app.biometric.off_cancelled` | 已取消，这项仍然开着。 | Cancelled. This is still on. |
| `officer_app.me.push_unanswered` | 通知还没打开。系统询问时选「允许」，再点一次。 | Notifications are not on yet. Choose Allow when the system asks, then tap again. |
| `soul_app.life.capture.HANDED_OVER` | 鬼差已把你交给城隍。 | The escorts have handed you to the City God. |

占位符 `{{bio}}` 三种语言必须一致(它是「指纹」「面容」之类的词，由代码填)。

## 二、灵魂端「勾魂牒」卡多了一个状态:已交城隍
用户 10-30 定：地府灵魂不论经哪条路登记死亡，勾魂牒都随死亡一并签发并记为已交接。灵魂账号是死后才开的，所以灵魂端实际看到的几乎都是这一态(第六十二批画的「发牒 / 拘到」两态只在少数情况下出现)。

我们按第六十二批的卡直接扩了一态，请看行不行：
- 步骤行:`■ 发牒 → ■ 拘到 → ■ 交城隍`(三步都已过，没有「正在」那一格)。
- 状态句：上表最后一条。
- 日期行仍是「发牒 · {日期}」。

要问的：
1. 三步全满时，步骤行还要不要留?或者改成一句话加日期就够了?
2. 这张卡要一直留在本世页上，还是到了某一站(例如过了鬼门关)就收起?现在是一直留着。
3. 状态句的措辞可以改。
