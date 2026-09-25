# 灵魂 App 忘记密码（邮箱验证码）；官员求助只按 IP 限流并通知殿主

分支 `feat/soul-app-password-reset`，起点 `main` @ `2a4c8f5`。环境：云端容器，**Node 22.22.2**
（20.19.5 未安装）、npm 11（`npx -y npm@11 ci` + `npm rebuild …`，装完 `git checkout -- package-lock.json`）、
Python 3.11 `backend/.venv`、一次性 redis-server :6399。没有 `.env`，没有碰 115。

## A. 灵魂 App「忘记密码」

### 流程与画面

入口：登录页「登录」按钮下方一个「忘记密码」链接（`login-forgot`），推入签出栈里新增的
`ForgotPassword` 路由（`mobile/src/screens/forgotPassword.tsx`，页头 `AppHeader` + 返回）。
签入态与改密态的栈里没有这个路由，所以它只在签出时可达。

**第一步：邮箱**
- 说明「输入灵魂账号上绑定的联系邮箱……」、邮箱输入框、「没有绑定邮箱的灵魂收不到验证码，请向所属殿司申请重置密码。」、「发送验证码」。
- 本机只拦明显不是邮箱的输入（`isPlausibleEmail`），不发请求、不花掉一次发送额度。
- **200 与 400 走同一条路**：都显示同一句「如果这个邮箱绑定了灵魂账号，验证码已发出」并进入第二步。
  测试把两次渲染出的整棵树（去掉 react-native-screens 每次随机生成的 `screenId`）逐字比较，不只比那句话。
- 只有与邮箱无关的失败按原样说：429 → 「尝试过于频繁,请稍后再试」（后端在查库之前计数，所以它不泄露邮箱是否存在），
  断网 → 网络错误 + 重试。其余状态码显示 `errors.unknown(状态码)`。

**第二步：验证码 + 新密码**
- 顶部同一句中性提示，下方再次说明「没有绑定邮箱 → 找殿司」（App 无法知道它有没有邮箱）。
- 5 分钟倒计时框（`m:ss`，等宽字，accent 边；到 0 变红：「验证码已失效，请重新发送」）。
- 验证码（6 位数字，数字键盘，`one-time-code`）、新密码、再次输入新密码。
- 密码规则与首登改密**同一个函数**：`auth.tsx` 里新抽出的 `newPasswordProblem`（至少 8 位、两次一致），
  `ChangePasswordScreen` 也改为调用它；文案复用 `soul_app.change_password.*`。
- 「重新发送验证码」：发送后 100 秒内禁用，下方写「m:ss 后可重新发送」（见「开放问题 2」）；重发成功后倒计时重置。
- 「换一个邮箱」回到第一步。
- 错误：验证码格式 / 错误 → 验证码框下；太短 / 强度不足 → 新密码框下；不一致 → 确认框下；
  验证码过期、错误次数过多（429，码已作废）、邮箱对应多个账号或无账号（409/404 → 找殿司）、断网（带重试）→ 按钮上方。

**成功**：`navigation.popTo("Login", { passwordReset: true })`，登录页显示「密码已重设，请用新密码登录」。
**不自动登录**：测试断言没有任何 token 写入、路由只剩 `Login`、登录表单在屏。

样式：沿用 `theme.ts` 的色板、`chrome.tsx` 的 `AppHeader`、`ui.tsx` 的 `Input/Button/Notice`；方角（无 `borderRadius`），
倒计时框照 `ExpiryBox` 的 3px 左边线。明暗两套由现有主题自动给出，没有新增颜色。

### API

`packages/core/src/api`：
- `auth.ts`：新增类型 `PasswordResetRequest` / `SetNewPasswordRequest` / `PasswordResetAccepted` / `PasswordResetRefusal`，
  全部取自生成的 schema（`ResetPassword` / `SetNewPassword` / `DetailResponse` / `ErrorResponse`）。
- `soul.ts`：`soulApi.requestPasswordReset(email)` → `POST /auth/reset-password/`；
  `soulApi.setNewPassword({email, code, new_password})` → `POST /auth/set-new-password/`；
  `passwordResetErrorMessage(error)` 把第二步的失败归到文案键。
- **为什么放在 `soulApi` 而不是 `authApi`**：`authApi` 走官员客户端 `api`，它的 401 分支会结束一个本宿主从不持有的官员会话；
  App 的传输是 `soulHttp`（`soul.ts` 顶部注释：一个宿主只跑一种会话），App 测试的 `stubApi` 也只替换 `soulHttp`。
  类型放在 `auth.ts`（端点属于 auth），调用放在 App 的传输上。
- 后端代码没有改（端点接受哪些账号不变）。

### 文案

`packages/core/messages/{zh-Hans,en,egy}.json` 新增 `soul_app.forgot_password.*` 24 条（三份同键）。
`cd frontend && npx jest egyLexiconRules`：21/21 通过。`support/egyVocabulary.json` 按测试头注释的命令重生成：
**只有 25 个已登记词的次数变化，没有新词形**（diff 25+/25−，键集合不变）。

egy 无法直接表达、用现有词形拼出的：
- **「验证码」**：词表里没有这个概念。写作 **Ren Djeret**（Ren 码 + Djeret 邮件）。
  避开了 `Sesh Maa`（与账簿 `Sesh Maat` 太近）和 `Ren Maa`（已表「新身份」）。请词表负责人确认。
- **「如果……」**（中性提示的条件句）：没有条件词。写作 `Er Djeret Pen Em Aq Ba: Ren Djeret Hab Seth`，沿用 `Er …:` 句式。
- 倒计时是数字 `m:ss`，不需要词。

### 测试（`mobile/src/__tests__/forgotPassword.test.tsx`，20 条；真导航器、真 soul 客户端，只替换网络和时钟）

- 第一步：登录页进入；**200 与 400 渲染同一棵树**（含请求体断言与「旁边没有别的提示」的缺席断言）；非法邮箱不发请求；429；断网 + 重试。
- 第二步：验证码 / 太短 / 不一致在本机拦下且不发请求（4 条）；错码、过期码、强度不足、429 错误过多、断网、409（6 条）；
  倒计时 5:00 → 99 秒后仍禁用 → 100 秒启用 → 重发后重新计时；5 分钟后显示过期；重发遇 429。
- 成功：请求体、回到登录页并显示提示、没有 token、没有登录。
- core `soul.test.ts` +13：两个调用（不带 token、不存任何东西）、10 种失败的归类、未知状态码不被吞、
  以及**读取 `backend/apps/authentication/views.py`、断言 `set_new_password` 仍在发那两句话**的守卫。

### 变异证明

| 变异 | 结果 |
|---|---|
| `resetRequestFailure`：400 不再算中性（当错误显示） | 「200 与 400 渲染同一棵树」红 |
| 400 显示同一句中性话，但作为错误留在第一步 | 同上红 —— 只比文字会放过它，比整棵树不会 |
| `RESEND_AFTER_SECONDS = 0` | 倒计时 / 重发那条红 |
| core：`RESET_CODE_WRONG_ERROR` 改成与后端不同的句子 | 「两句话仍是 set_new_password 发的」红 |

每次还原后重跑全绿。

## B. 官员「忘记密码」求助（`POST /api/v1/auth/password-help/`）

1. **只按 IP 限流**：删掉 `MAX_PASSWORD_HELP_PER_USERNAME`（3/小时/用户名）及其计数；`PasswordHelpThrottle`（5/小时/IP）不变，
   仍在序列化与任何查库之前执行，所有用户名同样被拒。视图里原来那块换成一段说明为何删除的注释。
2. **通知殿主**：角色名核实为 `UserRole.MODERATOR = "MODERATOR", "Realm Lead (殿主)"`（`apps/authentication/models.py:57`）。
   `tasks.notify_password_help` 的本租户收件人从 ADMIN 改为 `PASSWORD_HELP_TENANT_ROLES = ("ADMIN", "MODERATOR")`；
   本租户两者都没有时才退到全局 ADMIN（**只退 ADMIN**：MODERATOR 是租户角色）。请求者本人仍不在收件人里。
   审计描述改为「已通知 N 位管理员或殿主」；`changes.notified_admin_ids` 键名保持不变（现在也含殿主）。
3. 响应体不变：任何用户名都是同一个 `PASSWORD_HELP_ACCEPTED`；视图仍不读用户表。

测试（`backend/tests/test_auth_account.py`）：
- 删掉「每用户名 3 次」与「用户名限流不分大小写」两条；新增 `test_there_is_no_per_username_limit`
  （同一用户名从 12 个 IP 请求全部 200、全部进 worker、响应体与未知用户名逐字相同）；
- `test_per_ip_limit_refuses_known_and_unknown_alike`（第 6 次 429，已知 / 未知用户名状态码与响应体相同，且没有进 worker）；原 `test_per_ip_throttle` 保留；
- 殿主收到通知：本租户 ADMIN + MODERATOR，排除他租户殿主、停用殿主；殿主收到的通知与 ADMIN 的逐字段相同；
  只有殿主的租户只通知殿主、不退到全局；殿主自己求助不通知自己；审计 id 列表含殿主。
- 原「响应体对每种用户名都相同」参数化测试保留。

变异证明：

| 变异 | 红的测试 |
|---|---|
| 放回每用户名 3 次计数 | `test_there_is_no_per_username_limit` |
| 关掉 IP 限流 | `test_per_ip_limit_refuses_known_and_unknown_alike`、`test_per_ip_throttle` |
| `PASSWORD_HELP_TENANT_ROLES = ("ADMIN",)` | 6 条（殿主收件、同通知、只有殿主的租户、审计 id、断 broker、ADMIN 求助） |

还原后 `-k PasswordHelp` 22 passed。

**Schema**：视图 docstring 进入 OpenAPI 的 description，所以按 `test_committed_schema_matches_the_backend.py` 的流程重生成了
`packages/core/openapi/schema.yml` 与 `generated/schema.ts`：各 5 行，只有这段描述文字，没有结构变化。

## 门禁（均在最终树上跑，读退出码）

（后端全量 pytest 仍在运行，数字待补。）

## 开放问题

1. **第二步的错误只能靠后端的中文句子区分。** `set_new_password` 的「验证码已过期」「验证码错误」和密码强度不足都是 400 `{error}`，
   没有 `code`。App 精确匹配前两句（`RESET_CODE_EXPIRED_ERROR` / `RESET_CODE_WRONG_ERROR`），其余 `{error}` 当强度不足。
   core 有测试读 `views.py` 守着这两句，改措辞会红。更稳的做法是后端给这几个响应加 `code`
   （如 `reset_code_expired` / `reset_code_wrong` / `weak_password`）——这是后端改动，本次按要求没做。
2. **重发间隔取 100 秒。** 依据是 `PasswordResetThrottle` 的 3 次 / 5 分钟 / IP（300 ÷ 3）。但后端还有每邮箱 3 次 / 5 分钟的计数，
   而且**每次发送都会把那 5 分钟窗口重新计起**（`cache.set(..., timeout=300)`），所以 5 分钟内第 4 次仍会 429 —— App 会如实显示
   「尝试过于频繁」。要不要把第三次之后的等待改成 5 分钟，或者让后端返回 `retry_after`？
3. **殿主收到了通知，但能不能真的重置？** 通知正文是「核实身份后，请到用户管理为其重置」，而用户管理（`UserViewSet`）只对 ADMIN 开放，
   `user.manage` 也被刻意不给 MODERATOR。殿主现在能看到求助却无处操作。要么调整殿主的文案（如「请联系管理员」），
   要么给殿主一个受租户限制的重置入口 —— 需要产品决定。
4. **与「只接受 SOUL 账号」那项进行中的改动的衔接。** 如果非灵魂账号在 `set-new-password` 得到的是新的 400 `{error}` 句子，
   App 会把它归成「强度不足」；在第一步，400 已被当作中性处理。那项改动合并时请把新的拒绝句子（或 `code`）告诉 App 侧。
5. **没有在模拟器 / 真机上看过。** 云端没有 Android 模拟器；以上全部是 jest 结论。明暗两套是现有主题 token，未截图核对。
6. egy：「验证码」写作 Ren Djeret，请词表负责人确认（见上）。
