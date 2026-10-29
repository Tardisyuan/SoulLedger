# 第五十一批 · 转世配额、阳寿与枉死城、超度回向(2026-10-24)

三项后端都已上线，这一批要的是 Web 界面(官员端 App 本批只读，除非你认为需要入口)。文案请给 zh-Hans / en / egy,egy 只用词表里已有的词，没有的写进待补。

## 一、转世月配额

用户定了：殿管理员在后台按「道」设每月转世上限，留空 = 不限;某道当月满了，等转世的灵魂留在「待转世」里候位，下个月或管理员调高后再办。

- 后端：`PATCH /tenants/{code}/settings/` 收 `rebirth_monthly_quota: {道: 上限 | null}`(null = 去掉上限);`GET /reincarnation/quota/` 返回本月每道 `{rebirth_form, limit, used}`;办转世时满了答 409 `rebirth_quota_full`(带 `limit`、`used`)。
- 要的:
  1. 殿设置里「转世配额」一节：六道各一行(上限输入框，留空表示不限)。
  2. 转世登记页 / 办转世的地方显示本月各道「已用 / 上限」;满了的道怎么表现。
  3. 办转世被配额拒绝时的提示(一句话，带数字)。
- 文案键:`tenants.settings.rebirth_quota_title`、`_body`、`_unlimited`;`rebirths.quota.used_of`(带 `{{used}}`、`{{limit}}`)、`rebirths.quota.full`(拒绝提示)。

## 二、阳寿(生死簿)与枉死城 —— 只用于地府

用户定了：官员可在灵魂资料里登记「阳寿」(应死日期)。登记死亡时早于应死日的，判为横死：审判标「枉死」,灵魂先入枉死城，到应死日之前这桩审判不能认领。没登记阳寿的照常审判。

- 后端：灵魂字段 `fated_death_date`(写法与出生 / 死亡日期相同);审判多了 `untimely`(是否枉死)、`held_until`(候到哪天);提前认领答 409 `held_until_fated_date`(带 `held_until`)。
- 要的:
  1. 灵魂编辑弹层里「阳寿(应死日期)」字段放在哪里，说明文字(只地府显示)。
  2. 审判队列 / 审判台上「枉死 · 候至 某日」的标记;到期前认领按钮怎么表现。
  3. 灵魂详情身份带上是否显示阳寿。
- 文案键:`souls.fated_death_date`、`souls.fated_death_help`;`judgment.untimely`、`judgment.held_until`(带 `{{date}}`)、`judgment.claim.held`(认领被拒提示)。

## 三、超度回向

用户定了：阳间亲属做法事，由官员在灵魂名下代登一笔「超度回向」:来源(谁、何种法事)、日期、功德值;只对审判中、受刑中的灵魂有效，计入功德。

- 后端：功过记录新增类别 `DEDICATION`(只能是功德);对不在审判中 / 受刑中的灵魂答 400。现有「添加记录」弹层的类别下拉里已经有它(zh「超度回向」,en「Dedication of merit」,egy 待补)。
- 要的:
  1. 是否需要一个独立入口(灵魂详情「登记超度」),还是放在「添加记录」里就够;独立入口的话弹层字段与说明。
  2. 账簿 / 时间线上超度记录与普通功德的区分(字形或标签)。
  3. 灵魂不在审判中 / 受刑中时，入口隐藏还是置灰加说明。
- 文案键:`souls.categories.DEDICATION` 的 egy;如有独立入口:`souls.dedication.add`、`_title`、`_body`、`_source_label`、`_not_eligible`。
