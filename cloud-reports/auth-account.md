# 登录选文明、保持登录、忘记密码(通知管理员)、用户偏好

分支 `feat/auth-account`,起点 `main` @ `7a19849`。

> **本分支有两个迁移**,都可逆(已实测 unapply → re-apply):
> - `authentication/0017_user_preferences` —— `User.preferences`(JSONField,default `{}`)
> - `notifications/0010_password_help_requested_type` —— `UserNotification.notification_type` 的 choices 加一项 `PASSWORD_HELP_REQUESTED`(只改 choices,不动数据)

## 1. 登录时选文明 —— 结论:每个用户恰好一个租户,文明行只作信息展示

**证据**

- `User.tenant` 是一个可空 `ForeignKey("tenants.Tenant")`(`apps/authentication/models.py`),没有 M2M、没有成员表。
  全局 ADMIN 的 tenant 为 NULL,靠 `scope_to_tenant` 的 ADMIN 旁路跨租户,不是「属于多个」。
- 令牌里的 `tenant_code` 由 `CustomTokenObtainPairSerializer.get_token` 从 `user.tenant.code` 抄过来,别无来源。
- `TenantMiddleware` 只从 JWT 的 `tenant_code` 解析租户;选择租户的请求头 `X-Tenant-ID` 已在 FL-12 删除。
- 所以登录时传一个 `tenant_code`,只能被拒或被忽略 —— 没有合法的「在另一个租户里行事」。

**决定**:登录**不加** tenant 参数。前提用测试钉住:
`test_user_reaches_tenant_through_one_foreign_key_and_nothing_else`(User → Tenant 的正向字段恰好一个 FK、没有 M2M;
哪天加了成员表它会红,提醒登录得学会选);`test_a_tenant_code_sent_at_login_cannot_move_the_user`(body 里塞
`tenant_code: EU_HEAVEN_HELL`,令牌与响应里仍是 `CN_DIYU`)。

**公开端点** `GET /api/v1/auth/civilizations/`(AllowAny、无认证类 —— 标签页里残留的过期 access token 不会把它变成 401):

```json
[{"code": "CN_DIYU", "civilization": "CHINESE"}, {"code": "EU_HEAVEN_HELL", "civilization": "EUROPEAN"}, …]
```

- 只列 `is_active`、未软删、且在 `TENANT_CIVILIZATION` 里有对应文明的租户,按 `Civilization` 声明顺序。
- 每行**只有** `code` 与 `civilization`。页面画的名字(`organization.civilizations.*`)和形状标记(`CIVILIZATION_MARK`)
  都由前端按 `civilization` 查;`display_name`(管理用标签,页面不显示)、`settings`、`api_endpoint`、
  `dispatch_enabled` 一律不出。测试 `test_rows_carry_nothing_the_login_page_does_not_draw`。
- **没有「判官名」**,见未决问题 1。

**前端**:登录页表单上方一个列表(**不是** radio —— 选了也不改变请求里的任何东西,那会是一个说谎的控件;
原有测试「no radio / radiogroup」保留并加强为「login body 的键恰好是 username/password/remember」)。
被标记的那一行 = 此设备上次登录的租户(`localStorage.soulledger_last_tenant`,登录成功时写),用左侧墨线标记,
不用 ●/○ —— ● 已经是欧洲的形状标记。接口失败时整块不出现,登录不受影响。

## 2. 保持登录 30 天 —— cookie 寿命

**现状核对**:refresh cookie **不是后端设的**,是 `frontend/lib/platform/web.ts` 用 `document.cookie` 写的:
`soulledger_refresh=…; path=/; max-age=604800; SameSite=Lax` + 仅 https 时 `Secure`,**没有 HttpOnly**
(故意的:API 跨域、凭据走 `Authorization` 头,JS 必须读得到;`middleware.ts` 读它只是判断有没有)。
任务描述里的「HttpOnly」与现状不符;按「flags 保持现状」处理:**path / SameSite=Lax / 按协议的 Secure / 无 HttpOnly 全部不变**,只改寿命。

**后端**:`remember: bool = false` 进登录请求(`CustomTokenObtainPairSerializer.remember`)。

| | refresh 令牌 `exp` | 令牌里的 claim | 轮换后 |
|---|---|---|---|
| 勾选 | 30 天 | `remember: true` | 新令牌仍 30 天(从轮换时起算),claim 保留 |
| 不勾 | 7 天(`SIMPLE_JWT.REFRESH_TOKEN_LIFETIME`,未改) | 无 | 仍 7 天 |

为什么是令牌里的 claim:SimpleJWT 的 `TokenRefreshSerializer` 轮换时调 `refresh.set_exp()` 不带寿命,
30 天的令牌第一次刷新就会变回 7 天。新文件 `apps/authentication/tokens.py` 的 `RefreshToken.set_exp` 读 `remember` claim;
登录与 `/auth/refresh/` 都换成这个类(组件名仍是 `TokenRefresh`,schema 无改名)。
`remember()` 同时把 outstanding 表那一行的 `expires_at` 挪到 30 天 —— `flushexpiredtokens` 按它删,
`soul_accounts._revoke_refresh_tokens` 按它列。claim 不抄进 access token。
轮换即拉黑、登出拉黑都照旧(各有测试)。

**前端 cookie**:`web.ts` 新增 `refreshCookieLifetime(token)` —— 从令牌 payload 读(只读不信):

- `remember === true` 且有 `exp` → `max-age = exp − now`(新令牌即 2592000),无 `expires`;
- 否则 → **会话 cookie**(无 `max-age`、无 `expires`)。令牌自己的 7 天 `exp` 仍是服务端强制的上限。
- 解析不了的令牌 → 会话寿命(两者中较短的)。

**决定「不勾 = 会话 cookie」的理由**:现状 7 天比一次浏览器会话长,所以「或当前默认寿命,若更短」不成立;
而且现状下每个人都已经被「记住」7 天,勾选框将无事可开。代价见未决问题 3。

静默刷新走 `rotateRefreshToken → setRefreshToken → web.ts set`,它不知道当初怎么登录的;
claim 随轮换保留,所以 cookie 仍是 30 天 —— 测试 `after a silent refresh` 两条。

## 3. 忘记密码 —— 只通知管理员,不做自助重置

`POST /api/v1/auth/password-help/ {"username": "…"}`,AllowAny、无认证类。

**流程**
1. 每 IP 限流 `PasswordHelpThrottle`(scope `password_help`,**5/hour**,按 `apps/core/client_ip.py` 取 IP,换 XFF 不重置)。
2. 校验 `username`(非空、≤150)。
3. 每用户名计数(小写归一,**3 次 / 小时**),**在任何查询之前**计,已知与未知用户名同样计、同样 429。
4. `tasks.notify_password_help.delay(username, ip, ua)` —— **所有用户名都入队**;broker 挂了就就地执行(对所有用户名一样)。
5. 返回固定体 `{"detail": "请求已受理"}`。

**视图从不读用户表**。查人、发通知、写审计都在 worker 里、响应之后。所以存在与不存在在**响应体**和**请求路径的工作量**上都没有差别。

worker 里(`apps/authentication/tasks.py::notify_password_help`):
- 只处理 `is_active`、未软删、`role != SOUL` 的账号(灵魂账号有自己的 `/soul-accounts/` 重置流程);其余静默结束。
- 收件人 = **该账号所属租户的在职 ADMIN**;该租户没有 ADMIN、或账号本身没有租户(全局 ADMIN)时 = **全局 ADMIN(tenant 为 NULL)**。
  永不发给别的租户的 ADMIN(租户隔离,测试 `test_the_active_admins_of_the_users_own_tenant_and_nobody_else`);求助者本人不是收件人。
  MODERATOR(殿主)不收 —— 用户管理(含重置密码)只有 ADMIN 能做(`UserViewSet` 的 `IsAdminPermission` + `user.manage`)。
- 通知复用 `apps.notifications`(`notify_user` → EventBus → `UserNotification`),新类型 `PASSWORD_HELP_REQUESTED`,
  文案三语走 `official_notify.password_help_requested`(读时按 `Accept-Language` 渲染,params `{username}`)。
- 审计:`AuditLog(action=EXECUTE, resource="password_help", resource_id=<user.pk>, tenant=<账号租户>, user=NULL, ip, ua,
  changes={"notified_admin_ids": [...]})`。不存在的账号不写审计。

**邮件基础设施核对**:`config/settings.py:609-631` 有 `EMAIL_*`(DEBUG 下 console backend,否则 SMTP,`EMAIL_HOST` 未设时只警告)。
而且**已经有一条自助重置**:`POST /auth/reset-password/` 给邮箱发 6 位验证码、`POST /auth/set-new-password/` 凭码改密。
本分支没有碰它,也没有发任何邮件/短信 —— 见未决问题 2。

**前端**:登录表单下「忘记密码」→ 同一栏换成小表单(带上已输入的用户名)→ 200 一律显示「已通知本殿管理员」;
429 显示「请求过于频繁」;其他失败「未能发送」。页面只按状态码分支,不读 200 的 body(测试:三种不同 body → 同一段确认)。

## 4. 用户偏好 —— 模型、端点、迁移

- **存储**:`User.preferences = JSONField(default=dict, blank=True)`,迁移 `authentication/0017_user_preferences`(AddField,可逆)。
- **端点**:`GET / PATCH /api/v1/auth/profile/preferences/`。命名跟随本仓库官员侧的「自己」端点 `/auth/profile/`;
  没用 `/me/` —— 本仓库的 `/api/v1/me/` 是**灵魂侧**(`SoulAPIView` 分界)。
- **形状**:`{"default_view": "operator" | "admin" | null}`。只有这一个键。
  语言与主题**没有明显的服务端归宿**(语言是 `middleware.ts` 读的 cookie + localStorage,主题是 localStorage;
  `apps/notifications/messages.py` 也写明「官员没有存下来的语言偏好」),所以不搬,只做默认视图。
- **只能读写自己的**:永远是 `request.user`;路径与 body 里都没有可指向他人的 id;**未知键一律 400**(`user` / `user_id` / `id` / `username` 各测一次,且确认对方的值未变)。
- **前端**:`src/lib/defaultView.ts` 改为服务端。`/welcome` 选择即 PATCH(乐观更新,失败回滚到原值);
  未登录时两个按钮 disabled、不发请求。登录成功后 `await defaultViewRoute()` 读服务端值再跳转。
  **一次性迁移**:服务端为空而本机 `localStorage.soulledger_default_view` 有值 → PATCH 上去并删掉本地键;PATCH 失败则保留,下次再迁;
  服务端已有值 → 以服务端为准并删掉本地陈旧值。再也没有代码写这个键。

## 5. 变异验证

| 守卫 | 变异 | 结果 |
|---|---|---|
| 不可枚举 | M1a 视图里查用户,不存在时回不同的 body | 5 条红(同体 ×4、零读用户表 ×1) |
| 不可枚举(时序) | M1b body 不变,只在视图里多查一次用户表 | 1 条红(`…never_read_the_user_table`) |
| 不可枚举(限流) | M1c 把用户名计数挪到「用户存在」分支里 | 3 条红 |
| 偏好归属 | M2a 视图改写「第一个别人」 | 2 条红 |
| 偏好归属 | M2b body 可用 `user` 指定目标 + 关掉未知键拒绝 | 4 条红 |
| cookie 寿命 | web.ts 退回固定 `max-age=604800` | 4 条红 |

每次变异后原文件复原,复原后同一批测试全绿。

## 6. 门禁(全部在最终的树上跑)

环境:Python 3.11 venv(`requirements.lock` + `requirements-dev.txt`),`DATABASE_URL=sqlite:///:memory:`,
一次性 redis-server :6399(`/0 /1 /2`)。**Node 是 v22.22.2** —— 这台容器没有 20.19.5(也没有 nvm);npm 11 `ci` + rebuild,之后 `git checkout -- package-lock.json`。

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 后端全量 | `cd backend && <prefix> .venv/bin/python -m pytest --tb=short -q` | (运行中) | 待补 |
| ruff | `cd backend && .venv/bin/ruff check .` | 0 | All checks passed! |
| 迁移 | `cd backend && <prefix> .venv/bin/python manage.py makemigrations --check --dry-run` | 0 | No changes detected |
| schema | `tests/test_schema_has_no_warnings.py` + `test_committed_schema_matches_the_backend.py` + `test_e2e_fixtures_match_the_serializers.py` | 0 | 10 passed(0 warning / 0 error);`schema.yml` 与 `generated/schema.ts` 已按仓库的两条命令重生成 |
| core typecheck | `npm run --workspace packages/core typecheck` | 0 | |
| core lint | `npm run --workspace packages/core lint` | 0 | |
| core test | `npm run --workspace packages/core test` | 0 | 12 files / 118 passed(含 `generatedSchemaIsCurrent`) |
| 前端 tsc | `cd frontend && npx tsc --noEmit` | 0 | |
| 前端 lint | `cd frontend && npm run lint` | 0 | |
| 前端测试 | `cd frontend && npm run test:coverage` | 0 | 180 suites / 2936 passed;All files 79.45 / 71.13 / 69.63 / 80.45 |
| 前端构建 | `cd frontend && npm run build` | 0 | 有 1 条 CSS 优化警告(`--color-*`),**main 上同样存在**,非本分支引入 |
| egy | `cd frontend && npx jest egyLexiconRules` | 0 | 21 passed |
| E2E chromium | `cd frontend && npx playwright test --project=chromium` | 0 | 140 passed —— 见下 |

**E2E 说明**:仓库钉的 Playwright 1.63 要 `chromium_headless_shell-1243`,容器里只有预装的 1194。
按容器说明用一份**不提交**的临时配置(继承 `playwright.config.ts`,只加 `launchOptions.executablePath: /opt/pw-browsers/chromium`)
跑了 chromium project:140 passed。firefox / mobile-chrome 没跑。
E2E fixture 为新端点注册了 handler(civilizations / preferences GET+PATCH / password-help),登录 body 断言加上 `remember: false`。

## 7. 新增 i18n 键(三份语言包都有)

`auth.civilization / civilization_note / remember_me / forgot_password / forgot_desc / forgot_submit / forgot_sent / forgot_failed / rate_limited / back_to_login`,
`official_notify.password_help_requested.{title,body}`。

egy 全部用已登记词形(`Aq`、`Sekhem`、`Netjer Em Tepy`、`Aset Ahamet`、`Ren Aba`、`Hab`、`Wehem Sekhem`、`Nen Rekh`、`Hru`…),
**没有新词**;`egyVocabulary.json` 只是按测试文件里写明的命令(`EGY_VOCAB_WRITE=1`)重算了次数。
没有无法表达、需要造词的串。几处 egy 读起来偏简(如 `remember_me` = `Aq Em Hru {{days}}`,`civilization_note` = `Aset Ahamet Em Aq. Ahet Pen: Aq Tepy.`),请懂 egy 词表的人过目。

## 8. 未决问题

1. **判官名**:设计要求文明行显示判官名,但租户上没有「主审判官」字段;`Actor` 里每个文明有多位 JUDGE(中国十殿),
   挑哪一位是一条新的数据主张。本分支不出这个字段。要的话建议给 `Tenant` 加一列(或用 `hall_names` 代替,那是殿名不是判官名)。
2. **既有的邮件验证码自助重置**(`/auth/reset-password/`、`/auth/set-new-password/`)与「官员账号由管理员开通、不做自助重置」矛盾。
   本分支没动它。要不要对官员账号下线?
3. **行为变化**:上线后,不勾「保持登录」的人,refresh cookie 在下一次写入(登录或静默刷新)时变成会话 cookie,关浏览器即需重新登录。
   此前所有人都是 7 天。浏览器的「恢复会话」可能让会话 cookie 活得更久,那不受我们控制;服务端 7 天上限不变。
4. **每用户名 3 次/小时** 意味着任何人都能把某人的求助额度用完(对方可直接找管理员);要不要改成只按 IP 限、或放宽?
5. 求助只发 ADMIN,不发 MODERATOR(殿主)。若殿主应当知道,告诉我。
6. 通知依赖 Celery worker;没有 worker 在跑时,任务会排在队列里直到有 worker。broker 不可达时就地执行。
7. 「上次登录的文明」只按设备记(localStorage),换设备不标记。
8. mobile(`mobile/`)没有改:灵魂端 App 不走这个登录页。
