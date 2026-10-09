# 第十二批 · egy 待定 5 条(2026-10-09)

第十一批已全部落地。下面 5 条没有导入，现在回退显示中文，请给出 egy。

## 一、违反 §7(Nen Kheper 只留给白名单三键)
词表测试把这 3 条判红：失败要写成「Nen + 具体动词」,Nen Kheper 只用于找不到具体动词的那三处(泛指「失败」「若持续失败」「未到阈值」)。这 3 条都有具体动词，请改写。

| key | 中文 | English | 你给的 egy(未导入) |
|---|---|---|---|
| officer_app.queue.claim_failed | 没能认领 | Couldn't claim | Shesep Nen Kheper |
| officer_app.login.reasons.other | 没能登录，请稍后再试 | Couldn't sign in. Try again later | Aq Nen Kheper. Wehem Iri Er Khet. |
| officer_app.mfa.reasons.other | 没能验证，请稍后再试 | Couldn't verify. Try again later | Maa Nen Kheper. Wehem Iri Er Khet. |

你上一轮提到「Nen Shesep」会和「Nen Shesep Djer」(待认领)撞车,「Nen Aq」「Nen Maa」也各有撞车。如果找不到不撞车的写法，也可以考虑把这三处加进白名单，请说明理由。

## 二、新 key
| key | 中文 | English |
|---|---|---|
| officer_app.cosign.rules | 只列本殿在职、有审批权限的官员。加签人先批，你才能批;加签人驳回，整个节点驳回。 | Only active officers of this hall who may approve are listed. The added signer approves first, then you can; if they reject, the whole step is rejected. |
| audit.resource_tenant | 殿设置(审计页「资源」筛选里的一项，只看殿设置本身的改动) | Hall settings |

## 三、请顺便确认
- `audit.filter_hall`(按殿 / By hall):审计页新加的「按殿」下拉，现在沿用旧的 egy「Wesekhet」。要不要改?
- 14j 的标题「加签 · 服务端返回不允许」,我们理解成画板上的说明，不是界面文案;界面上的面板标题仍是「加签」。如果它应该是界面文案，请告诉我们。
