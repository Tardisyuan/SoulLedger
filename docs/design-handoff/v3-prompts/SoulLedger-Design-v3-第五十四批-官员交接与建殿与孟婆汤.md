# 第五十四批 · 官员交接、邀请、建殿、跨殿面板、孟婆汤、官员 App 统计(2026-10-26)

## 背景

后端五件事已在 main(`171ea775`,接口见末尾),本批要界面。都是用户 2026-10-25 定的:

1. **官员 App**:个人统计页 + 现场取证(拍照上传到案卷)。导出留在网页,不进 App。
2. **殿管理员(Web)**:按人批量移交在途案件;批量导入官员;邮件邀请官员。
3. **全局管理员(Web)**:建殿(选文明)、停用 / 启用,不能删。
4. **全局管理员(Web)**:跨殿运营面板。
5. **孟婆汤**:地府的灵魂转世前必经一站,官员登记「已饮汤」。

## 一、官员 App

### 1. 我的数(统计页)

只数调用者自己的,不分殿。入口放哪(「我的」页下一屏 / 待办页头)你定。一屏五个数:

| 字段 | 含义 |
|---|---|
| `concluded_this_month` | 本月我结的案(本地时间 1 日 0 点起) |
| `concluded_total` | 累计结案 |
| `open_claims` | 我认领着、还没结的(与审判队列「我的」同一组) |
| `appeals_reviewed` | 我复核并已有结论的申诉(维持 / 改判) |
| `appeals_in_review` | 我认领着、还没决定的申诉 |

没有排行、没有他人的数、没有趋势接口(只有这五个整数)。要不要画个比例 / 迷你图自己定,但不要编数据。
导出不做(留在网页)。空态(全 0)和加载失败要有。

### 2. 证据录入(拍照上传)

**请注意口径**:后端没有「新建功过记录」的接口,官员 App 能做的「证据」就是**案卷附件**(与网页审判台同一套):
`POST /judgment/{id}/attachments/`(multipart `file`),图片或 PDF,单个 ≤ 20 MB,每案 ≤ 30 个、合计 ≤ 100 MB;
HEIC 收下存成 JPG,服务端去 EXIF / GPS。**只有认领 / 有 `judgment.execute` 的官员能传,结案后不能再传也不能删**(403 `concluded`);
只有上传人能删(`can_delete`)。错误码:`bad_type` / `too_large` / `case_full` / `too_many` / `concluded` / `not_uploader`。
App 现在只读附件(审判详情「附件 {{n}}」),本批加:

- 审判详情附件段里的「拍照 / 从相册选」入口,上传进度、失败重试、离线时置灰并说明。
- 上传后列表立刻出现(`uploader_name · 时间`),自己传的带删除。
- 案子已结案时入口不画,只读。

### 文案(已有,直接复用)

`officer_app.detail.attachments` / `attachment_offline` / `attachment_failed`,`officer_app.case.evidence_attachment`,
网页 `case.attachments.*` 里 `limit` / `full` / `failed_type` / `too_large` / `too_many` / `failed_network` / `failed_generic` / `delete_*` / `delete_concluded`
可整套照搬三语。统计页与拍照入口的新键请给 `officer_app.stats.*`、`officer_app.case.attach_*`。

## 二、殿管理员(Web)

权限:`judgment.assign`(殿管理员、殿主)管交接;`user.manage` 管邀请与导入。

### 1. 按人批量移交(先预览再提交)

选「交出人」和「接手人」(都是本殿在职官员;不能同一人 `same_officer`),先**预览**再**提交**。预览只数不写:

```
{judgments, appeals, appeals_returned_to_pool, city_gods: ["名字"…], letters, problems: []}
```

- 四类:认领中的**审判**;复核中的**申诉**;**城隍**名下(交出人从每位城隍名单里移走,接手人加进去,列名字);经办的**书信**(未关闭会话)。
- 申诉:接手人是那件审判的**原判官员**时不能接,那一件**退回待复核**(复核人清空,任何能复核的人可认领),单独计数 `appeals_returned_to_pool`,
  预览里要讲清「这几件会回到待复核池」。
- `problems`:`target_cannot_judge`(接手人不能办案,而手上有审判 / 申诉)、`target_cannot_reply`(不能回信,而手上有书信)。
  有 problems 时**提交会 409 `handover_blocked`**(带 `problems`),所以预览里就该禁用提交并说明为什么。
- 提交结果 `{judgments, appeals, appeals_returned_to_pool, city_gods, letters}` 是**实际**移了几件(预览之后已结案 / 被别人改派的不再动,数字可能比预览少,要说明)。
- 全部为 0 时的空态。错误:`invalid_target`(400,接手人不是本殿在职官员)、不属本殿的交出人 404(与不存在同一答)。
- 提交后:接手人收到一条站内通知(`official_notify.officer_handover_received`,**已有**,egy 待补);交出人**不**逐件收通知;审计一条。
- 入口放哪(用户管理的行菜单「移交在途案件」/ 官员停用前的提示)你定。建议:停用或离职操作旁给一个顺手入口。

### 2. 批量导入官员

在现有「导入用户」(`users.import.*`,三步:选文件 / 预览 / 结果)上改,**不要另起一套**:

- CSV 列:`username`(必填)、`email`、`display_name`、`role`、`password`。
- **新规则**:不写 `password` 而写了 `email` 的行 = **发邀请信**(本人自设密码,7 天有效);写了 `password` 的行照旧(首次登录须改)。两者都没有 → `password_required`。
  邀请行的角色不能是 `ADMIN`(`role_invalid`)。预览里每行要标「邀请 / 设初始密码」两种方式(行里有 `delivery: invite|password`)。
- 预览 `POST /users/import_csv/?dry_run=1` → `{total, ok_count, error_count, rows}`;提交返回 `{created, invited, errors}`(`created` 已含 `invited`)。
- 结果页:「已导入 N 人,其中 M 人收到邀请信,K 人首次登录须改密码」。
- 行错误码**已有**三语:`users.import.row_codes.*`(username_required / email_invalid / role_invalid / username_taken / email_taken / password_required / password_weak)。
  `users.import.template_notes` 与 `success` 需要改写(目前只讲初始密码)。

### 3. 邮件邀请官员 + 落地页

- 管理员侧:填邮箱、角色、(可选)用户名 / 显示名 → `POST /users/invite/`。新建 201,**同一殿内对还没接受的邮箱再邀请一次 = 重发(200)**,
  界面要区分「已发出」与「已重发」。错误(400,带 `field`):`email_invalid` / `role_invalid`(不能邀请 SOUL / ADMIN)/ `email_taken`(邮箱属于别的账号)/ `username_taken`。
  用户名缺省取邮箱 `@` 前那段,重名自动加数字。
- 用户列表里「已邀请、还没设密码」的状态要有一个标记:读用户数据的 `invite_pending`(true = 待接受邀请)。对同一邮箱再邀请一次就是重发,标记旁给「重发邀请」。
  发信失败只记日志,所以「再点一次重发」要一直可用。
- **落地页 `/accept-invite?uid=…&token=…`**(公开页,无需登录,风格与现有 `/reset-password` 同一套):
  官员自设密码(新密码 + 确认),提交 `POST /auth/officer-invite/accept/ {uid, token, new_password}`。
  - 成功:「密码已设置,请登录」+ 去登录。设好密码即视为邮箱已验证。
  - 400 `invite_link_invalid`(无效 / 过期 / 已用 / 账号已设过密码):说明让他联系管理员重新邀请,**不要说哪一种**。
  - 400 `weak_password`:带 `reasons[]`,逐条列(复用密码规则提示的现有样式)。
  - 429 `rate_limited`:带等待秒数。
  - 一次性、7 天有效(重置密码是 1 小时,别混)。

### 文案(已有)

`official_notify.officer_handover_received.title` / `.body`(「{{by}} 把 {{from}} 手上的事交给了你:审判 / 申诉 / 城隍 / 书信各几件」);
`users.import.*`(见上)。其余新增请给三语:`officerHandover.*`、`officerInvite.*`、`acceptInvite.*`。

## 三、全局管理员(Web):建殿 / 停用

只有全局管理员(`ADMIN`,无殿的角色)。

- **新建殿**:表单字段 `code`(大写字母开头,只含大写字母 / 数字 / 下划线,2–50 位,**建后不可改**)、`display_name`、`description`、
  **文明**(四选一:中国 / 欧洲 / 埃及 / 希腊,必填)、`hall_name` / `hall_name_en` / `hall_name_egy`(殿的叫法,三语)。
  错误:`code_taken`;四个种子殿的 code(已写死文明)若选了不一致的文明 → 字段错误「X 是 Y 的殿」。
- **停用 / 启用**,**没有删除**:停用后数据全部保留;**不再收新灵魂**(创建灵魂 400 校验错 `hall_inactive`)、
  **不再收新的死亡登记**(外部系统登记会失败,`error_code=HALL_INACTIVE`,重试同样被拒)。已有灵魂、案件照常。
  停用前要有确认,把这两条写清;停用的殿在列表里灰显 + 「已停用」标记,可「重新启用」。重复停用不报错。
- 入口放哪(组织 / 殿管理页)你定。

## 四、全局管理员(Web):跨殿运营面板

`GET /tenants/overview/` → 每殿一行(停用的殿也列,带 `is_active`),只有数、没有灵魂名:

```
{code, hall_names, civilization, is_active,
 todo: {approvals, dispatch_proposals, cooldowns, letters_awaiting, total},
 judgments: {at_city_god, held, claimed, unclaimed},
 rebirth_quota: [{rebirth_form, limit|null, used}…],
 open_appeals}
```

- `todo`:殿级待办 = 审批中的流程 + 调到本殿等批的提案 + 待决的缩短冷却 + 灵魂最后一封还没回的书信。是**殿的数,不是某位官员的「待我处理」**。
- `judgments`:未结案审判**四格,互不相交**:在城隍处 / 押在枉死城(`held_until` 未到)/ 有人认领 / 无人认领。画成一条分段条或四个小数,别当趋势。
- `rebirth_quota`:本月每条去路的 `used / limit`,`limit` 为 `null` = 不限(与转世配额页同一函数,文案复用第五十一批)。
- `open_appeals`:待复核 + 复核中。
- **每殿可点进**:点进去就是该殿的对应页(待办、审判队列、配额、申诉);请给「进入某殿」的做法(全局管理员怎么切殿,现有切殿控件怎么复用)。
- 殿的名字用 `hall_names`(三语),不要拼 `code`。排序默认按 `code`;要不要「积压多的排前」自己定。
- 空态(还没有殿 / 加载失败)。

## 五、孟婆汤

- **只有地府(中国文明)的灵魂要饮**。别的文明不显示这一站;对它们调用会 409 `not_diyu`。
- 流程:灵魂进入「候转世」(`REINCARNATING`)后,官员在**转世页 / 候转世名单里该灵魂的行与灵魂详情**登记「已饮孟婆汤」。
  `POST /reincarnation/drink-soup/ {soul_id}` → `{soul_id, soup_taken_at}`;权限 `reincarnation.manage`;别殿的灵魂 404。
- 每世一次:转世完成时清空,下一世再饮。灵魂档案里的 `soup_taken_at` 为空 = 未饮,界面据此画「未饮 / 已饮 {{时间}}」。
- 拒绝(409,`{code, detail}`):`not_diyu`、`not_reincarnating`(不在候转世)、`soup_already_taken`(本世已饮过,按钮应已置灰,这条只防并发)。
- **未饮就转世被拒**:转世的 `complete` / `reborn` 答 409 **`soup_not_taken`**,灵魂**留在候转世**(与配额满同一条等候线),饮过之后再转。
  请画这条提示:说清「地府的灵魂要先饮孟婆汤」,并**就地给「登记已饮汤」的按钮**,不要让官员自己去找。批量转世时要说明是哪几位被拒。
- 灵魂时间线新增事件 `MENGPO_SOUP_TAKEN`(归在转世相关一组,紧靠转世完成之前)。
- 官员 App 里是否要登记饮汤:本批**不要求**;若你觉得值得,给一个建议画面,我们再定要不要补。
- 灵魂端不显示「是否已饮」(本批不改),时间线上若会出现这条事件,与其他事件用同一套 `souls.events.*` 文案。

### 文案(已有)

`souls.events.MENGPO_SOUP_TAKEN` = 饮孟婆汤(zh-Hans 已有;egy 待补,在 `egyPendingKeys.json`)。
新增请给三语:`mengpoSoup.*`(标题 / 按钮 / 已饮状态 / 提示)、`reincarnation.error.soup_not_taken`、`mengpoSoup.error.not_diyu` / `not_reincarnating` / `soup_already_taken`。

## 三语与 egy

zh-Hans / en / egy,egy 只用词表里已有的词,没有的写进待补。本批新键各前缀:`officerStats.*`(App 为 `officer_app.stats.*`)、
`officerHandover.*`、`officerInvite.*`、`acceptInvite.*`、`halls.*`(建殿 / 停用 / 总览)、`mengpoSoup.*`。

## 接口(已上线)

- `GET /officer-app/stats/` → `{concluded_this_month, concluded_total, open_claims, appeals_reviewed, appeals_in_review}`
- `POST /judgment/{id}/attachments/`(multipart `file`)/ `GET …/attachments/` / `DELETE …/attachments/{aid}/` / `GET …/attachments/{aid}/link/`
- `POST /judgment/handover/preview/ {from, to}`、`POST /judgment/handover/ {from, to}`(`judgment.assign`;`from` / `to` 为用户 id)
- `POST /users/invite/ {email, role, username?, display_name?, tenant?}`(`user.manage`;`tenant` 只给无殿的全局管理员用)
- `POST /users/import_csv/`(`?dry_run=1` 为预览)
- `POST /auth/officer-invite/accept/ {uid, token, new_password}`(公开)
- `POST /tenants/ {code, display_name, description?, civilization, hall_name?, hall_name_en?, hall_name_egy?}`、
  `POST /tenants/{code}/deactivate/`、`POST /tenants/{code}/activate/`、`GET /tenants/overview/`(仅全局管理员)
- `POST /reincarnation/drink-soup/ {soul_id}`;转世 409 `soup_not_taken`

另有一条不进界面:外部系统查死亡登记进度 `GET /death-sync/register/{id}/progress/`(阶段 registered / at_city_god / judging / sentenced / reincarnated / settled),
说明在 `docs/INTEGRATION.md`,本批不画。
