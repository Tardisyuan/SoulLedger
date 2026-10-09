# 上线清单(DEPLOY)

> 2026-10-09 起草,基于分支 `chore/deploy-readiness-docs`(从 `feat/v3-modern` 开出)。**只做了部署准备,没有部署任何东西**:
> 没动服务器、DNS、115 测试机。标 **未核实** 的是没在代码里或本机跑出来证实的说法。
> 本文是**清单**;各子系统的细节与实测记录在 [`DEPLOYMENT.md`](DEPLOYMENT.md)(TLS 首签、续期、定时任务、Matrix、备份恢复),不重复。
> 约定:`DC="docker compose -f docker-compose.yml -f docker-compose.production.yml"`;根 `.env` 由 `scripts/deploy.sh production` 从 `.env.production` 复制(`scripts/deploy.sh:20-34`)。
> 看环境变量是否合格:`scripts/check-deploy-env.sh .env`(退出码非 0 即有 FAIL;不会打印密钥值)。

## 0. 先知道的三件事(代码里已核实,会让上线静默出错)

1. **根 `.env` 里的 `DESK_URL`、`CORS_ALLOWED_ORIGINS`、`EMAIL_*`、`SOUL_PUSH_ENABLED`、`EXPO_ACCESS_TOKEN`、`ASSISTANT_*`、`JWT_*` 都不会传进容器。**
   `docker-compose.yml:12-37` 的 `x-django-env` 只列了 `DATABASE_URL / REDIS_URL / CELERY_* / SECRET_KEY / ALLOWED_HOSTS / ENCRYPTION_KEY / SENTRY_DSN / TRUSTED_PROXY_COUNT / MEDIA_ROOT / MATRIX_*`,
   backend、celery、celery-beat 三个服务都用它(`docker-compose.yml:97,122,133`)。没列的变量,`settings.py` 读不到就用默认:
   `DESK_URL` 落到 `http://localhost:3000`(`settings.py:765`),于是**官员密码重置邮件里的链接指向收件人自己的电脑**(`apps/authentication/officer_reset.py:144`);
   `EMAIL_HOST` 落到 `localhost:25`(`settings.py:747`),找回密码的验证码发不出去且界面不报错;
   `SOUL_PUSH_ENABLED` 永远是 `False`(`settings.py:415`),灵魂端推送全部标 `DISABLED`。
   **上线前必须补**:在 `x-django-env` 里加这些变量(默认值取 `settings.py` 的默认值,未设时行为不变),并同步到 `.env.example`
   ——`backend/tests/test_production.py::TestEnvExample` 会检查 compose 里每个 `${NAME}` 都在 `.env.example` 里列出。
   我没能做这个改动(本次的会话权限不允许编辑 `.env.example`)。可直接套用的补丁在本文末「附录 A」。
2. **生产覆盖文件的 backend 启动命令没有 `seed_mythology`**(`docker-compose.production.yml:62-66`),而基础文件有(`docker-compose.yml:88-93`;compose 合并时 `command` 被整条替换)。
   全新生产库里没有租户、界域、冥界人物。首次上线要手动跑一次(见第 6 节),之后不用。
3. **没有 `eas.json`,两个 `app.json` 也没有 `extra.eas.projectId`**(`mobile/app.json`、`mobile-officer/app.json`;`ls mobile/eas.json mobile-officer/eas.json` 均不存在)。
   没有 projectId,App 拿不到 Expo 推送 token(`mobile/src/push.ts:86-87`、`mobile-officer/src/push.ts:66-67`:返回 `no_project_id`,不报错)。见第 9 节。

## 1. 环境变量(按服务)

标记:必=缺了拒绝启动或功能整体不可用;推=缺了能跑但有后果。

### 1.1 backend / celery worker / celery-beat(同一镜像、同一份 `x-django-env`)

| 变量 | 必? | 缺了/错了会怎样 | 出处 |
|---|---|---|---|
| `SECRET_KEY` | 必 | 空:`ValueError` 拒绝启动。**至少 32 字节**:simplejwt 用它签 HS256,更短 PyJWT 每次签/验发 `InsecureKeyLengthWarning`,`pytest.ini` 里升成 error。Django 的 `check --deploy` 另要求 ≥50 字符且 ≥5 种字符(W009)。建议 64+ 随机字符 | `settings.py:14-16`;`docker-compose.yml:17`(`:?` 缺了 compose 直接报错) |
| `DEBUG` | — | **不要设**(基础文件刻意不写)。设成 true 会关掉 HSTS/SSL 重定向/安全 cookie、放开 CORS(`CORS_ALLOW_ALL_ORIGINS = DEBUG`)、允许 SQLite | `settings.py:23,227,505`;`docker-compose.yml:18-20` |
| `ALLOWED_HOSTS` | 必 | 空:`ValueError` 拒绝启动。写错:所有请求 400。**必须包含 `backend`**(Synapse 推送回调的主机名),否则书信推送静默失败(回调 400) | `settings.py:31-39`;`docker-compose.yml:168`、`DEPLOYMENT.md` 书信推送一节 |
| `DESK_URL` | 必(见 §0.1) | 官员重置密码/邮箱验证邮件的链接前缀;默认 `http://localhost:3000`。须为公网 https,无末尾斜杠 | `settings.py:765`;`officer_reset.py:144` |
| `ENCRYPTION_KEY` | 必 | `DEBUG=False` 且空:`ImproperlyConfigured` 拒绝启动。格式必须是 Fernet(44 字符 urlsafe-base64 以 `=` 结尾),否则同样拒绝。它加密 `WebhookConfig.signing_secret` 与 `DeathRegistrationRequest.source_payload`。**2FA 的 TOTP 密钥不用它**:`ENCRYPTION_KEY` 只被 `apps/death_sync/fields.py`、`encrypted_json.py` 读(grep 全 `apps/` 非测试代码),`apps/authentication/` 里没有引用;TOTP 密钥怎么存:未核实。**一旦有数据后不能换**,换了旧密文读不出。生成:`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` | `settings.py:695-736` |
| `DATABASE_URL` | 必 | 生产叠加文件把它指到 `pgbouncer:5432`,由 `DB_PASSWORD` 拼出(`docker-compose.production.yml:48`)。含 `sqlite` 且 `DEBUG=False`:拒绝启动 | `settings.py:170-175` |
| `DB_PASSWORD` | 必 | compose 的 `:?` 校验,缺了不启动 | `docker-compose.yml:13`;`production.yml:28,45,151` |
| `REDIS_URL` / `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` | 必 | 生产叠加文件由 `REDIS_PASSWORD` 拼出(`production.yml:49-51`);不用手写。缺 Redis:权限缓存退回进程内存(默认 TTL 0,每次查库)、WebSocket 与 Celery 全部不可用 | `settings.py:135,388-389` |
| `REDIS_PASSWORD` | 必 | `production.yml:16` 的 `:?` 校验 | |
| `TRUSTED_PROXY_COUNT` | — | 生产叠加文件写死 `"1"`(nginx 一跳)。别改成 0:审计日志/登录限速/API key IP 白名单都会取到 nginx 的地址 | `production.yml:53`;`settings.py:49` |
| `CORS_ALLOWED_ORIGINS` | 推 | 默认只有 localhost。**走同一个 nginx 域名(Web 与 API 同源)时不需要设。** Web 与 API 分在不同源时必须列**完整源**(`https://desk.example.com`),不能是 `*`:`CORS_ALLOW_CREDENTIALS=True` 是为 2FA「30 天不再询问」设备 cookie 开的(`mfa.py:325-331`:httpOnly、`SameSite=Lax`、`secure=not DEBUG`、path `/api/v1/auth/`)。Lax cookie 只在**同站**(同一可注册主域,如 `desk.example.com` 与 `api.example.com`)的 XHR 里随请求发送;跨站域名这个 cookie 永远发不出去,2FA 每次都要验 | `settings.py:236-239` |
| `CSRF_TRUSTED_ORIGINS` | — | 全仓库没有这个设置(`grep CSRF_TRUSTED` 无结果)。API 走 JWT bearer,DRF 不校验 CSRF;只有 Django admin(`/admin/`)的表单登录受影响:若 admin 从 nginx 的 https 域名访问,Django 看到的是 `X-Forwarded-Proto: https` 与 `Host`,同源,通常不需要。**admin 登录实测:未核实** | |
| `SECURE_SSL_REDIRECT` | — | 默认 true;staging 叠加文件设 false(`staging.yml:14`)。`/health/` 与 Synapse 回调路径豁免 | `settings.py:514,524` |
| `SENTRY_DSN` | 推 | 空:启动 warning,无错误追踪、无 beat 的 Sentry Crons。**前端不会拿到它**:`frontend/Dockerfile` 没有 `SENTRY_DSN` 的 ARG(`frontend/next.config.js:24` 只在构建时看到它) | `settings.py:774-802` |
| `EMAIL_HOST` `EMAIL_PORT` `EMAIL_HOST_USER` `EMAIL_HOST_PASSWORD` `EMAIL_USE_TLS` `EMAIL_USE_SSL` `DEFAULT_FROM_EMAIL` | 推(见 §0.1) | 目前只有找回密码验证码与官员重置/验证邮件会发信。没配:启动 warning,而且**发信失败界面不显示**(接口答同一个响应),上线后必须真发一封验证 | `settings.py:743-762` |
| `JWT_ACCESS_LIFETIME`(默认 30 分钟)、`JWT_REFRESH_LIFETIME`(默认 10080 分钟)、`JWT_OFFICER_APP_REFRESH_LIFETIME_HOURS`(默认 24) | — | 有默认值 | `settings.py:306-310` |
| `MEDIA_ROOT` | — | compose 写死 `/app/media`(`docker-compose.yml:27`),对应 `media_files` 卷 | |
| `POST_MEDIA_X_ACCEL` | — | 生产叠加文件设 `"true"`;**只有前面真有这份 nginx 才能开** | `production.yml:59` |
| `DISABLE_SERVER_SIDE_CURSORS` | — | 生产叠加文件对三个 Django 服务都设 `"true"`(pgbouncer 事务池) | `production.yml:57,79,94` |
| `SOUL_PUSH_ENABLED` / `EXPO_ACCESS_TOKEN` | 推(见 §0.1) | 不开:推送只记 `DISABLED` 行。开:backend 与 celery worker **都要有**;worker 要能出站 `exp.host:443`。`EXPO_ACCESS_TOKEN` 仅在 Expo 控制台开了「增强推送安全」时才必需 | `settings.py:415-417`;`DEPLOYMENT.md` 推送一节 |
| `MATRIX_ENABLED` | — | 默认 `False`,关着时 `/me/chat/` 与 `/chat/inbox/` 答 503 | `settings.py:424` |
| `MATRIX_PUBLIC_BASEURL` `MATRIX_SERVER_NAME` `MATRIX_JWT_SECRET` `MATRIX_REGISTRATION_SHARED_SECRET` `MATRIX_USER_SALT` | 开聊天时必 | `MATRIX_USER_SALT` 空则**拒绝启用聊天**(`settings.py:440` 注释);`MATRIX_SERVER_NAME` 与 `MATRIX_USER_SALT` 定了就不能改(mxid 全变);`MATRIX_JWT_SECRET` ≥32 字节,**两边(后端与 homeserver.yaml)一起改**。这几项已在 `x-django-env` 里(`docker-compose.yml:31-37`) | `DEPLOYMENT.md`「灵魂聊天」 |
| `ASSISTANT_ENABLED` `ASSISTANT_PROVIDER` `ASSISTANT_API_KEY` `ASSISTANT_BASE_URL` `ASSISTANT_MODEL` `ASSISTANT_EMBEDDING_URL` … | 开「问一问」时 | 默认关(`ASSISTANT_ENABLED=False`,接口 503)。**`ASSISTANT_EMBEDDING_URL` 默认 `http://192.168.2.2:11434`(局域网 Ollama),上线前必须换成部署内可达的服务**;每殿还要 `Tenant.settings["assistant_enabled"]=true`。也不在 `x-django-env` 里(§0.1) | `settings.py:452-485` |
| `SCHEDULER_*`、`CACHE_PERMISSION_*` | — | 有默认值,见 `settings.py` 对应注释 | |

### 1.2 celery worker / celery-beat 的差别

- 环境同上(同一个 `*django-env` 锚点,`production.yml:73-101` 只覆盖数据库/Redis 三个地址)。worker 需要 `SOUL_PUSH_ENABLED`、`EXPO_ACCESS_TOKEN`、`EMAIL_*`、`MATRIX_*`、`ASSISTANT_*`——任务里发推送/邮件/调 Matrix。
- 二者都 `depends_on: backend: service_healthy`(`docker-compose.yml:126-128,134-136`):backend 里 `migrate` 没跑完它们不起。
- **beat 只起一个**,见第 7 节。

### 1.3 frontend(Next.js 16,standalone 镜像)

| 变量 | 必? | 说明 |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | 必 | **构建参数,不是运行时变量**(`frontend/Dockerfile:26-27`、`docker-compose.yml:189`)。构建时写进 bundle;改了要重 build 镜像。必须是浏览器可达的公网地址,如 `https://example.com/api/v1`。默认 `http://localhost:8000/api/v1`,不设就是把线上前端指向访客自己的电脑。`proxy.ts` 的 CSP `connect-src` 与 `wss://${host}` 都由它派生(`frontend/proxy.ts:59`) |
| `PORT` `HOSTNAME` `NODE_ENV` | — | Dockerfile 已写死(`frontend/Dockerfile:46-52`) |
| `SENTRY_*` | — | 镜像里不会生效(见 1.1 `SENTRY_DSN`) |

### 1.4 Synapse / Matrix

见 `DEPLOYMENT.md`「灵魂聊天」。清单:根 `.env` 填 `MATRIX_PUBLIC_BASEURL`(含末尾 `/`,如 `https://example.com/`)、`MATRIX_SERVER_NAME`、`MATRIX_JWT_SECRET`(≥32)、`MATRIX_REGISTRATION_SHARED_SECRET`、`MATRIX_USER_SALT`、`SYNAPSE_DB_PASSWORD`;
`MATRIX_ENABLED` 先留 `False`,跑完 `scripts/synapse-init.sh`、`up -d --wait synapse`、`up -d nginx` 后改 `True`,再 `up -d backend celery celery-beat` 并 `exec backend python manage.py setup_matrix`。
`config/synapse/soulledger_policy.py` 必须挂进去(`docker-compose.yml:152`),少了它灵魂能绕过全部聊天规则。

### 1.5 手机端构建(Expo,构建时内联)

| 变量 | App | 缺了怎么样 |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | 灵魂端 `mobile/`(官员端 `mobile-officer/` 复用同一个 platform 模块:`mobile-officer/src/shared.ts` 从 `../../mobile/src/*` 再导出,**官员端是否同样读这个变量:未核实**) | 回退 `http://10.0.2.2:8000/api/v1`(Android)/ `http://localhost:8000/api/v1`(iOS),商店包会连自己的手机(`mobile/src/platform.ts:89-93`) |
| `EXPO_PUBLIC_DESK_URL` | 官员端 | 官员端「打开官员台」之类的链接前缀,回退 `http://localhost:3000`(`mobile-officer/src/rules.ts:191-193`) |
| EAS `projectId` | 两个 App | 见第 9 节 |

`EXPO_PUBLIC_*` 在打包时替换进 JS,构建机上设,不是服务器上设。

## 2. HTTPS 与域名

- 准备:一个主域(例 `example.com`)A/AAAA 记录指向主机;80、443 公网可达。Web、API、`/ws/`、`/_matrix` 都在同一个 nginx 域名下(`nginx.conf` 一个 `server`,`server_name _`),因此 Web 与 API **同源**,不需要 CORS。
- 若坚持把 API 放子域(`api.example.com`):`nginx.conf` 要拆 server_name,`CORS_ALLOWED_ORIGINS` 列 Web 源,且必须同一可注册主域才保住 2FA 设备 cookie(`SameSite=Lax`)。**这条路径本仓库没测过(未核实)。**
- 首签与启用 443:按 `DEPLOYMENT.md`「TLS 证书」5 步(先 `--staging`,再正式;编辑 `nginx.conf` 解开 `listen 443 ssl;`、`http2 on;` 与两行 `ssl_certificate*`,换 `YOUR_DOMAIN`;`tests/test_production.py` 要求 443 与证书两行同开同关)。
- **HSTS 一旦发出就是一年**:Django 发 `max-age=31536000; includeSubDomains; preload`(`settings.py:507-509`),nginx 也发(`nginx.conf` 安全头)。`includeSubDomains` 意味着该主域**所有子域**都必须有 https,再决定是否真去提交 preload 名单。
- `SECURE_PROXY_SSL_HEADER` 信任 `X-Forwarded-Proto`(`settings.py:528`);后端端口不对外发布(基础文件无 `ports`),只有 nginx 发布 80/443(`production.yml:209-211`)。别直接把 8000 暴露出去。

## 3. 证书续期与失败告警

- `certbot` 服务每 12 小时 `certbot renew`,成功 touch `/etc/letsencrypt/.renew-ok`,失败打印 `certbot renew FAILED exit=N`;续出新证书时 touch `.deployed`,nginx 容器每 5 分钟看到标记就 reload(`production.yml:181-205,226-238`)。
- 它的 healthcheck:没有证书、或最近一次成功的 renew 超过 25 小时(`find … -mmin -1500`)→ unhealthy。**但 Docker 的 unhealthy 本身不会通知任何人**(没有任何 compose 服务在看它;是否有外部监控:**未核实**)。上线前接一个外部告警,任选:
  1. 监控脚本每小时跑 `docker inspect --format '{{.State.Health.Status}}' $(docker compose -f docker-compose.yml -f docker-compose.production.yml ps -q certbot)`,非 `healthy` 就发消息;
  2. 外部探测证书剩余天数(与 certbot 无关,最可靠):`echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -enddate`,剩余 < 14 天告警;
  3. 同理盯 `backup` 服务的 healthcheck(见第 8 节)。
- 手动演练:`$DC run --rm --no-deps --entrypoint certbot certbot renew --dry-run --webroot -w /var/www/certbot`。

## 4. 部署顺序与数据库迁移

首次上线(空库):
1. `scripts/check-deploy-env.sh .env` 全部 PASS。
2. `cp .env.example .env.production` 填值 → `scripts/deploy.sh production`(= 复制成 `.env` 后 `$DC up -d`)。**注意**首次先别开 443 段(没证书 nginx 起不来,见第 2 节),按首签流程来。
3. `backend` 容器启动命令依次跑:`collectstatic` → `migrate` → `setup_scheduled_tasks` → `daphne`(`production.yml:62-66`)。`migrate` 是启动命令的一部分,**每次容器重启都会跑一遍**(幂等,但意味着迁移期间 backend 不健康、celery/beat 因 `service_healthy` 等着)。
4. `$DC ps` 等 `backend` healthy(健康检查走 `/health/`,`docker-compose.yml:98-112`;`start_period` 40 秒,迁移多时可能不够——**大库首次迁移耗时:未核实**,`26` 条迁移往返测试每条 2–67 秒,见 `CLAUDE.md`)。
5. 跑第 6 节的一次性命令。

升级(已有数据):
1. 先备份:见第 8 节(**别跳过**:迁移没有自动回滚)。
2. `git pull` 到目标 tag/提交 → `$DC build backend frontend`(backend/celery/celery-beat 共用 `soulledger-backend` 镜像,`docker-compose.yml:72`)。
3. `$DC up -d`。Compose 会按依赖顺序:db/redis → pgbouncer → backend(迁移)→ celery、celery-beat。
4. 迁移是否破坏性:发布前读目标版本里新增的 `backend/apps/*/migrations/`;含 `RemoveField`/`DeleteModel`/`RunPython` 的,回滚前提是已备份。CLAUDE.md 记过 `apps/perm/migrations/0017` 在真 PostgreSQL 上因 `except: pass` 触发事务中止——**每次发布前用真 PG 跑一遍 `makemigrations --check` 与迁移**(CI/pre-push 默认只在 SQLite 上跑,见 `CLAUDE.md`「SQLITE HIDES A WHOLE CLASS OF DEFECT」)。
5. 部署后:`$DC exec backend python manage.py sync_permissions`(先 `--dry-run`)——启动命令**不**自动跑它。

## 5. `manage.py check --deploy` 结果(2026-10-09 实跑)

条件:`DEBUG=false`,`SECRET_KEY` 随机 64 字节,`ALLOWED_HOSTS=example.com`,`DATABASE_URL=postgres://…`,`ENCRYPTION_KEY` 为有效 Fernet 键,`SENTRY_DSN` 空。命令在 `backend/` 下用 `backend/.venv` 解释器跑,退出码 0。

| 警告 | 触发条件 | 处理 |
|---|---|---|
| **(无)** `System check identified no issues (0 silenced).` | 上述生产形态 | HSTS、SSL 重定向、`SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE`、`SECURE_CONTENT_TYPE_NOSNIFF`、`DEBUG`、`ALLOWED_HOSTS` 已由 `settings.py:505-528` 在非 DEBUG 下设好,无需改动 |
| `security.W009` SECRET_KEY 少于 50 字符、少于 5 种字符、或以 `django-insecure-` 开头 | 实跑:60 个同一字符的 key 触发 | 换成 64+ 字符随机值。`check-deploy-env.sh` 只拦 <32 字节(PyJWT 的底线);W009 更严,用 `python -c "import secrets;print(secrets.token_urlsafe(64))"` 生成即可 |
| `security.W008` `SECURE_SSL_REDIRECT` 不是 True | 实跑:`SECURE_SSL_REDIRECT=false` 时触发。只有 staging 这么设(`docker-compose.staging.yml:14`,因为没有 TLS 终结) | 生产不要设这个变量(默认 true)。staging 的这条警告是预期的,不用改 |

另外 `check --deploy` 之外、启动时会打印两条 `UserWarning`(不是 Django check,但同样应在上线前清零):
- `SENTRY_DSN is not set in production`(`settings.py:775-781`)→ 填 `SENTRY_DSN`;
- `EMAIL_HOST is not set (DEBUG=False)`(`settings.py:755-762`)→ 填 `EMAIL_*`(并先解决 §0.1,否则容器里永远读不到)。

**这次对 `settings.py` 没有任何改动**:非 DEBUG 下该开的安全开关已经全部由环境驱动地开着,没有需要补的。

## 6. 部署后的一次性命令

全部在 `$DC exec backend python manage.py …`(`$DC` 见文首)。

首次上线,按顺序:

| 命令 | 何时 | 安全吗 |
|---|---|---|
| `seed_mythology` | **首次一次**(生产叠加文件的启动命令不跑它,§0.2)。建租户、界域、冥界人物、冥律语料 | **安全,可重跑**:按 `realm_code` / `(civilization,name)` 匹配,默认只创建不覆盖,软删行不复活(`actors/management/commands/seed_mythology.py` 文件头;`backend/tests/test_seed_entrypoint.py`)。**别加 `--update`**,它会让种子值覆盖运维改动 |
| `setup_scheduled_tasks` | 启动命令已自动跑(`production.yml:65`) | 安全、幂等;保留运维改过的启停/cron。`--reset` 会丢弃运维改动,**不要在生产随手加** |
| `sync_permissions`(先 `--dry-run`) | 每次部署后 | 安全:只补缺失的权限码名,不碰已有行(`perm/management/commands/sync_permissions.py`) |
| `snapshot_balances` | 带 `ledger` 0002 的那次部署,跑一次 | 安全,覆盖当月一行,不补更早月份(`DEPLOYMENT.md` 部署后一节) |
| 创建第一个管理员 | 首次 | `createsuperuser` 创建的用户 `role` 是否自动为 `ADMIN`:**未核实**(`UserManager` 来自 Django,`apps/authentication/models.py:14-19`;`role` 默认值我没核)。上线前在 staging 上走一遍,别指望 `/auth/register/`:它永远建 `VIEWER`(`serializers.py:436`) |
| `setup_matrix`(开聊天后) | 见 §1.4 | 幂等 |
| `create_api_key <名称> --tenant CN_DIYU`(死亡同步外部系统) | 按需 | 正常运维命令,密钥只显示一次(**输出格式:未核实**) |

**生产上不要跑**(或要想清楚再跑):

| 命令 | 为什么 |
|---|---|
| `migrate_actors_to_users` | 给每个 Actor 建 User,**默认密码写死 `soul123456`**(`authentication/management/commands/migrate_actors_to_users.py:38,151`)。生产跑了就是一批已知密码的账号 |
| `seed_field_permissions` | 文件头写的是「seed **example** FieldPermission rules」,按 `ADMIN/JUDGE/GUARDIAN/VIEWER` 建角色。这是示例数据,会不会和运维在权限矩阵里的配置打架:**未核实**。生产不跑,除非先读完它 |
| `seed_workflow_templates` | 用 `update_or_create`(`seed_workflow_templates.py:21`),**重跑会把管理员改过的模板覆盖回内置定义**;而且「用第一个租户」。首次空库可以跑,有数据后不要 |
| `seed_tenants` | `get_or_create`,幂等;但与 `seed_mythology` 里建租户重复(`actors/mythology/seeding.py:175`)。二选一即可,用 `seed_mythology` |
| `init_organizations` | 组织架构初始数据。是否幂等:**未核实** |
| `fix_actor_civilization`、`consolidate_eu_pantheon`(含 Norse purge)、`backfill_*` | 数据修复/回填命令,针对已有历史数据的一次性修复;全新库不需要。**别在生产盲跑** |

## 7. celery-beat 只能起一个

- `docker-compose.yml:130-136` 里 `celery-beat` 只有一份。**不要** `up --scale celery-beat=2`,也不要在第二台机器上对同一个库再起 beat——两个 beat 读同一张调度表会把每个任务派发两次;单飞锁只挡得住时间重叠的那次。
- 调度表在数据库里(`DatabaseScheduler`,`settings.py:394`),清单在 `backend/apps/scheduler/registry.py`。
- 上线后验证:`/scheduler` 页面各行已启用;`GET /health/detailed/`(需 ADMIN 登录)的 `scheduler` 字段不是 `"overdue"`——状态码仍是 200,**探针要读字段**。
- beat 没起的后果(`DEPLOYMENT.md`):审批节点超时不自动处理、推送回执不核对、余额/普查快照不写、孤儿图片不清理。
- worker 重启不影响 beat;beat 重启会按数据库继续。

## 8. 备份

- `backup` 服务(`production.yml:139-169`):启动先备份一次(失败容器退出),之后容器内 cron **每天 02:00**(容器时区,镜像默认 UTC)跑 `scripts/backup-db.sh`,文件在主机 `./backups/`:`soulledger_*.sql.gz`(库)、`soulledger_media_*.tar.gz`(头像媒体)、聊天初始化后再加 `soulledger_synapse_*.dump` 与 `soulledger_synapse_data_*.tar.gz`(签名密钥,丢了等于换了一台 homeserver)。
- healthcheck:任一应有的最新备份超过 26 小时 → unhealthy。**同证书:没有人会被通知,要接外部告警**(§3)。
- **备份只在同一台机器的 `./backups/`。** 机器坏了备份一起坏。把 `./backups/` 同步到另一处(对象存储/另一台机器)是上线前要补的,仓库里没有这一步(**未核实**:是否有别的机制)。
- **加密密钥也要备份**:`ENCRYPTION_KEY`、`MATRIX_*` 全部、`MATRIX_USER_SALT`。丢了 `ENCRYPTION_KEY`,库里加密列永久不可读;这些值**不在** `./backups/` 里。
- 恢复只能进空库,步骤与实测记录见 `DEPLOYMENT.md`「数据库备份与恢复」。**上线前至少在 staging 演练一次完整恢复。**
- 部署前手动补一份(命令形状从 `production.yml:158` 推出,**我没有运行过**):`$DC exec backup /scripts/backup-db.sh /backups`。

## 9. 回滚

代码里没有现成的回滚脚本。可行路径(推断自上面的机制,**整体未演练,未核实**):

- **只回滚代码、迁移没变**:`git checkout <上一个 tag>` → `$DC build backend frontend` → `$DC up -d`。镜像是本地构建、标签固定为 `soulledger-backend`(`docker-compose.yml:72`),不是从镜像仓库拉的,所以「回滚」= 重新构建旧提交。如果想要可秒回的回滚,发布时给镜像打带版本的标签并保留旧镜像(目前没有这样做)。
- **迁移已经跑过**:backend 启动命令只会 `migrate` 向前。要退回:先停 `backend celery celery-beat pgbouncer`,用第 8 节的备份按 `DEPLOYMENT.md` 恢复进空库(会丢失备份之后的数据),再启动旧版本。逐条 `migrate <app> <旧编号>` 的反向迁移:**未核实**哪些迁移可逆(CLAUDE.md 提到 `4033dcc1` 迁移往返测试存在,说明有一部分被往返验证过,但不是全部)。
- **前端**:`NEXT_PUBLIC_API_URL` 烘焙在镜像里,回滚前端 = 重建旧提交的镜像。
- **证书/nginx 配置出错**:`nginx.conf` 是只读挂载的单文件;改坏了还原文件后 `$DC restart nginx`(或 `exec nginx nginx -s reload`)。`/.well-known/acme-challenge/` 与 80 端口别动。
- **App**:商店版本无法立即撤回。发布前先走 TestFlight / 内部测试轨道。

## 10. 需要你本人完成的 App 商店步骤

我无法代办(账号、签名、付款、证书):

1. **开发者账号**:Apple Developer Program(年费)、Google Play Console(一次性费用)、Expo 账号(EAS)。
2. **Bundle ID / 包名**(已在 `app.json` 里固定):灵魂端 `com.soulledger.soul`;官员端 `com.soulledger.officer`(iOS `ios.bundleIdentifier`,Android `android.package`)。在 Apple/Google 后台先注册这两个标识。
3. **EAS 项目与 projectId**:在 `mobile/` 与 `mobile-officer/` 各自 `npx eas-cli init`(生成 projectId 并写进 `app.json` 的 `extra.eas.projectId`)和 `eas build:configure`(生成 `eas.json`)。**这两个文件目前都不存在**。没有 projectId 就没有推送 token(第 0.3 节)。
4. **构建环境变量**:在 `eas.json` 的 profile `env` 或 EAS 控制台里设 `EXPO_PUBLIC_API_URL=https://example.com/api/v1`(两个 App)、`EXPO_PUBLIC_DESK_URL=https://example.com`(官员端)。商店包没设就连 localhost。
5. **iOS 推送证书**:在 Expo(EAS)上配置 APNs 密钥(`eas credentials`)。后端不持有它(`DEPLOYMENT.md`「灵魂端推送」)。
6. **Android 推送**:FCM 凭据(FCM v1 服务账号密钥)上传到 Expo/EAS;`google-services.json` 是否需要放进项目:**未核实**(`app.json` 的 `android` 段目前没有 `googleServicesFile`)。
7. **签名**:iOS 分发证书与 provisioning(`eas build` 可托管)、Android 上架密钥(Play App Signing)。
8. **原生构建**:本 App 是 dev-client,用了 `expo-notifications`、`expo-secure-store`、`expo-image-picker` 等原生模块,**不能用 Expo Go**;商店包用 `eas build --platform ios|android --profile production`。
9. **上架材料**:隐私政策 URL、截图、应用描述、年龄分级;`expo-image-picker` 的相册权限文案在 `mobile/app.json`。灵魂端**社交/聊天内容**(UGC)——Apple 审核会要求举报/屏蔽入口;是否已满足:**未核实**。
10. **通知**:`soulledger-soul` 与 `soulledger-officer` 各自独立的 Expo 项目;推送令牌 `SOUL_PUSH_ENABLED=True` 并重启 backend/worker 后,最近 24 小时内记为 `DISABLED` 的行会被 `soul_push.sweep` 补发(要 beat 在跑)。

## 11. 上线后冒烟测试清单

按序执行,每条都有明确通过标准(`example.com` 换成你的域名)。

基础设施
- [ ] `curl -sI http://example.com/ | head -1` → `301`,`Location: https://…`
- [ ] `curl -sI https://example.com/ | grep -i strict-transport` → 有 HSTS
- [ ] `curl -s https://example.com/health/` → `{"status": "ok"}`
- [ ] `$DC ps`:全部 `healthy`(backend、db、redis、certbot、backup、synapse 若启用)
- [ ] `$DC logs backend | grep -i warning` 里**没有** `SENTRY_DSN is not set`、`EMAIL_HOST is not set`
- [ ] `openssl s_client … | openssl x509 -noout -enddate` 证书剩余 > 60 天

登录与安全
- [ ] 用管理员登录 Web,首页加载,浏览器控制台无 CSP/CORS 报错
- [ ] 开启 2FA 并勾「30 天不再询问」,退出再登录:**不再要求验证码**(验证 SameSite=Lax 设备 cookie;`mfa.py:325-331`)
- [ ] 官员「忘记密码」:收到邮件,**邮件里的链接以 `https://<正式域名>/` 开头**(验证 DESK_URL,§0.1)
- [ ] 找回密码验证码能真收到(发信失败界面不显示,必须真收一封)
- [ ] 登录审计日志里记录的是真实客户端 IP,不是 nginx 的内网 IP(验证 `TRUSTED_PROXY_COUNT=1`)
- [ ] `/admin/`(Django admin)经 nginx 对公网开放,没有 IP 白名单或额外认证(`nginx.conf:187-195` 只是反代,与 `/api/` 不同也没有限流)。要么不用它,要么在 nginx 加 `allow/deny`——这是需要你决定的一项

实时与任务
- [ ] 登录后右上角没有常驻「连接断开」横条(`/ws/` 经 nginx 升级成功)
- [ ] `/scheduler` 页:各任务已启用;手动运行一个任务,执行记录 SUCCESS
- [ ] `GET /health/detailed/`(ADMIN):`scheduler` 不是 `"overdue"`(等 beat 跑过至少一个周期后)
- [ ] 创建一个审批节点并让它超时的测试暂略;至少确认 `workflow.process_timeouts_for_tenant` 有最近一次 SUCCESS

数据
- [ ] 灵魂、界域、冥界人物列表非空(验证首次 `seed_mythology` 跑过)
- [ ] 上传头像 → 能显示(`/media/`);发一条带图朋友圈 → 图片能显示(`/protected-media/` 由 nginx 发;空响应说明 `POST_MEDIA_X_ACCEL` 与 nginx 不一致)

聊天与推送(如已启用)
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://example.com/_matrix/client/versions` → 200;`/_synapse/admin/v1/register` → 403;`/_matrix/federation/v1/version` → 403
- [ ] 灵魂端 App 发一封书信,对方 App 收到推送
- [ ] `soul_push_pushdelivery.status` 有 `SENT`/`DELIVERED`,没有成片 `FAILED`

手机 App(商店包或内部测试包)
- [ ] 灵魂端登录成功(连的是线上,不是 localhost);设置页推送开关能拿到 token
- [ ] 官员端登录、2FA、打开「官员台」链接指向正式域名

备份
- [ ] `ls -la ./backups/` 出现当天的 `soulledger_*.sql.gz`;`$DC ps backup` 为 healthy
- [ ] 在 staging 做过一次完整恢复演练(§8)

## 附录 A:让 compose 把缺的变量传进容器的补丁

`docker-compose.yml` 的 `x-django-env` 里,`TRUSTED_PROXY_COUNT` 一行之后加入;默认值与 `settings.py` 的默认一致,所以根 `.env` 没设这些变量时行为和现在完全相同。
同时在 `.env.example` 里为每个名字加一行(否则 `test_production.py::TestEnvExample` 会红)。

```yaml
  DESK_URL: ${DESK_URL:-http://localhost:3000}
  CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3333}
  # 空的 EMAIL_HOST 保留「EMAIL_HOST is not set」启动告警
  EMAIL_HOST: ${EMAIL_HOST:-}
  EMAIL_PORT: ${EMAIL_PORT:-25}
  EMAIL_HOST_USER: ${EMAIL_HOST_USER:-}
  EMAIL_HOST_PASSWORD: ${EMAIL_HOST_PASSWORD:-}
  EMAIL_USE_TLS: ${EMAIL_USE_TLS:-False}
  EMAIL_USE_SSL: ${EMAIL_USE_SSL:-False}
  DEFAULT_FROM_EMAIL: ${DEFAULT_FROM_EMAIL:-noreply@soulledger.local}
  SOUL_PUSH_ENABLED: ${SOUL_PUSH_ENABLED:-False}
  EXPO_ACCESS_TOKEN: ${EXPO_ACCESS_TOKEN:-}
```

注意:`${X:-}` 展开成空串时,`os.getenv("X", default)` 返回的是空串而不是 default,所以上面凡是 `settings.py` 里会做 `int()` 或当 URL 用的变量(`EMAIL_PORT`、`DESK_URL`、`CORS_ALLOWED_ORIGINS`)都写了与代码一致的非空默认值;`EMAIL_HOST` 故意留空。
`ASSISTANT_*`(启用「问一问」时)同理要补,未在补丁里,因为默认关闭。

## 附录 B:本文用到的校验脚本

`scripts/check-deploy-env.sh [ENV_FILE]`:一项一行 `PASS`/`FAIL`/`WARN`,有 `FAIL` 退出码 1,不打印密钥值。检查项:`SECRET_KEY` 存在且 ≥32 字节、`DEBUG` 不为 true、`ALLOWED_HOSTS` 存在且无 `*`、`DESK_URL` 存在且 https 且非 localhost、`ENCRYPTION_KEY` 存在且为 Fernet 格式、数据库/Redis 凭据存在、`NEXT_PUBLIC_API_URL` 为 https、`CORS_ALLOWED_ORIGINS` 无通配/localhost、开聊天时 `MATRIX_*` 齐全且 `MATRIX_JWT_SECRET` ≥32 字节;`SENTRY_DSN`、`EMAIL_HOST` 为空只给 `WARN`。测试:`backend/tests/test_check_deploy_env_script.py`。
