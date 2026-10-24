# 第五十二批 · 审判申诉(2026-10-24)

## 背景

此前「申诉」只存在于两处：审批流程上的一个标记(申诉模板),和转生申请被驳回后的一次申诉。
**灵魂对审判本身没有任何异议的途径。** 用户定了：

- 灵魂可以对**已结案**的审判提出申诉：结案后 **30 天内**,**每件审判最多 2 次**(撤回的也算一次)。
  写理由(必填),可以补充新证据(文字;本批不收附件)。
- 由**另一位官员**复核 —— 作出原判的官员(结案人、认领人)不能认领。
- 结论只有两种:**维持原判** / **改判**(选一个新裁决)。复核意见必填，灵魂看得到。
- 改判时：受刑计划里**还没执行**的部分改按新裁决(未开始的站撤掉，换成按新裁决路由的一站;
  原属地那一站若处置还没执行，就地改去处);**已经执行**的每一站记一笔「改判补偿」功德，计入功过簿余额。
- 后端已上线(见末尾接口);本批要界面。

## 要的

### 一、灵魂 App

1. **申诉入口**:本世「审判」里每件已结案的审判(灵魂簿 › 本世 › 审判)。能申诉时显示入口;
   不能时写明原因，三种:已有一份在复核中 / 两次已用完 / 已过 30 天(给出截止日)。入口是否常驻、还是折进「更多」,你定。
   截止日在能申诉时也要看得到(「X 月 X 日前可申诉」或剩余天数，你定)。
2. **申诉表单**:原判一行(案号 · 裁决 · 结案日)、理由(必填，最多 2000 字)、新证据(选填，最多 4000 字)、
   一句后果说明(「由另一位判官复核;每件审判最多申诉两次」)、提交 / 取消。
3. **申诉状态**:待复核 / 复核中 / 维持原判 / 改判 / 已撤回 五态，挂在那件审判下面(一件审判可有两轮，按轮次排)。
   - 待复核、复核中可**撤回**(需二次确认，说明「撤回也算一次」)。
   - 维持 / 改判显示复核意见与结论时间;改判显示「原判 → 新判」,以及补偿(每站一笔功德，权重)。
   - **不显示复核人是谁。**
4. **推送落地**:结论推送(维持 / 改判各一句)落到本世，高亮那件审判(与「审判有了结论」同一落法)。
5. 功过簿里「改判补偿」这一类怎么标(可参照第五十一批超度回向的 `⇠ 阳间` 标法，另给一个记号)。

### 二、Web(官员)

1. **申诉队列**:本殿的申诉列表，默认「待复核」;可切 复核中 / 已结案(维持 + 改判)/ 已撤回。
   每行：案号、灵魂、第几轮、原判、提出时间、距 30 天截止(仅供参考)、复核人(复核中时)。
   入口放在审判台 / 审判队列旁边还是侧栏单列，你定。
2. **复核页**:左右(或上下)对照 ——
   - 左「原判」:案号、原裁决、判词(原判 notes)、结案时间、结案人;可跳到原案卷。
   - 右「申诉」:理由、新证据、第几轮、提出时间。
   - 作出原判的官员打开时，「认领复核」置灰并说明原因(接口里有 `original_officer_ids`)。
   - 认领后才出现「作出结论」。
3. **结论弹层**:维持 / 改判 二选一;改判时选新裁决(不能与原判相同);复核意见必填(最多 2000 字)。
   改判前给出**影响预告**的文字说明(「未执行的站将改按新裁决;已执行的每站记一笔补偿功德」)——
   本批后端不提供预演接口，只写说明;若你认为必须先看到具体会撤哪几站，请提出，我们补接口。
4. **拒绝的呈现**(都是 409 / 403,带 `code`):
   - `plan_in_transit`:灵魂正在去下一站或在外地、那一站还没执行 —— 「等那一站执行后再作结论」,结论弹层保留输入。
   - `plan_busy`:受刑计划在重审 / 永久挂起 / 有待原审判官决定的请求。
   - `already_claimed`、`original_judge`、`not_reviewer`、`appeal_closed`。
5. **时间线**:灵魂事件时间线新增三种 —— 提出申诉 / 撤回申诉 / 申诉复核结论(归在「生命周期」组,紧跟审判结束)。

官员 App 本批只读还是要能复核，你定;若要，请按 Web 同一套流程给手机版。

## 文案

请给 zh-Hans / en / egy(egy 只用词表里已有的词，没有的写进待补)。

**已经在语言包里(后端要求，先放了占位译文，请审定或替换;egy 在 `egyPendingKeys.json` 待补):**

| 键 | zh-Hans 占位 |
|---|---|
| `souls.events.JUDGMENT_APPEAL_FILED` | 提出申诉 |
| `souls.events.JUDGMENT_APPEAL_WITHDRAWN` | 撤回申诉 |
| `souls.events.JUDGMENT_APPEAL_DECIDED` | 申诉复核结论 |
| `souls.categories.COMPENSATION` | 改判补偿 |
| `soul_push.appeal_upheld.title` / `.body` | 申诉复核:维持原判 / 你的申诉已复核，维持原判。打开灵魂簿查看复核意见。 |
| `soul_push.appeal_amended.title` / `.body` | 申诉复核:已改判 / 你的申诉已复核，原判已改。打开灵魂簿查看。 |

**本批新增(请给三种语言):**

| 键 | 用途 |
|---|---|
| `appeals.status.PENDING` / `IN_REVIEW` / `UPHELD` / `AMENDED` / `WITHDRAWN` | 五态 |
| `appeals.round` | 「第 {{round}} 次申诉」 |
| `appeals.deadline` | 「{{date}} 前可申诉」 |
| `appeals.refusal.appeal_open` / `appeal_rounds_used` / `appeal_window_closed` | 不能申诉的三种原因 |
| `appeals.refusal.not_concluded` / `not_appealable` / `past_life_read_only` | 接口拒绝(App 兜底) |
| `appeals.file` / `appeals.file_title` / `appeals.file_body` | 入口按钮 / 表单标题 / 后果说明 |
| `appeals.reason_label` / `appeals.reason_required` / `appeals.evidence_label` | 理由、未填提示、新证据 |
| `appeals.submit` / `appeals.submitted_toast` | 提交 / 成功提示 |
| `appeals.withdraw` / `appeals.withdraw_title` / `appeals.withdraw_body` / `appeals.withdrawn_toast` | 撤回(说明「撤回也算一次」) |
| `appeals.original_verdict` / `appeals.new_verdict` / `appeals.verdict_change` | 原判 / 新判 / 「{{from}} → {{to}}」 |
| `appeals.decision_note` | 复核意见 |
| `appeals.compensation` / `appeals.compensation_row` | 补偿 / 「第 {{order}} 站 · 功德 {{weight}}」 |
| `appeals.queue_title` / `appeals.queue_empty` | Web 队列标题 / 空态 |
| `appeals.claim` / `appeals.claimed_toast` / `appeals.claim_disabled_original` | 认领复核 / 成功 / 原判官员置灰说明 |
| `appeals.decide` / `appeals.decide_title` / `appeals.uphold` / `appeals.amend` / `appeals.pick_verdict` | 结论弹层 |
| `appeals.amend_impact` | 改判影响说明 |
| `appeals.decided_toast` | 结论已发出 |
| `appeals.error.plan_in_transit` / `plan_busy` / `already_claimed` / `original_judge` / `not_reviewer` / `appeal_closed` / `verdict_unchanged` | 官员端拒绝 |

## 接口(已上线)

灵魂(只认灵魂令牌，只看本人本世):
- `GET /api/v1/me/judgment-appeals/` → `{judgments: [{judgment_id, case_number, verdict, concluded_at, deadline, rounds_used, can_appeal, refusal_code}], results: [申诉]}`
- `POST /api/v1/me/judgment-appeals/` `{judgment, reason, evidence?}` → 201
- `POST /api/v1/me/judgment-appeals/{id}/withdraw/`

官员(本殿;看 `judgment.read`,认领 / 结论 `judgment.execute`):
- `GET /api/v1/judgment/appeals/?status=PENDING`、`GET /api/v1/judgment/appeals/{id}/`
  (含 `judgment_notes`、`original_officer_ids`、`reviewer_name`、`compensations`)
- `POST /api/v1/judgment/appeals/{id}/claim/`
- `POST /api/v1/judgment/appeals/{id}/decide/` `{outcome: UPHELD|AMENDED, verdict?, note}`

## 补充(2026-10-24,用户决定后)

- **改判时的外地站**:改判的灵魂若有联审带进来、还没开始的外地站，复审判官在改判弹层里必须选「保留」或「撤掉」(后端字段 `keep_foreign_stops`,没选时答 400 `foreign_stops_choice_required`)。请画这个选择(列出是哪几站)。文案键:`appeals.decide.foreign_title`、`appeals.decide.foreign_keep`、`appeals.decide.foreign_remove`、`appeals.decide.foreign_required`。
- **第二次申诉的期限**从第一次申诉出结论那天起算 30 天(灵魂端截止日照接口返回的 `deadline` 显示即可)。
- **补偿**按文明分别折算(地府、欧洲每 10 年 1 点，希腊每 100 年 1 点，埃及每年 1 点，永久 100);界面只显示点数，不必解释折算。
