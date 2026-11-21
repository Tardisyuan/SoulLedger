# 生产部署

生产栈是 `docker-compose.yml` + `docker-compose.production.yml`(`scripts/deploy.sh production`
就是 `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`)。
根 `.env` 需要的变量见 `.env.example`。下文把这对 `-f` 简写为 `$DC`:

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.production.yml"
```

**根 `.env` 的变量不会自动进容器。** backend / celery / celery-beat 只收到 `docker-compose.yml` 里 `x-django-env`
列出的那些(2026-10-12 核对:`DATABASE_URL`、`REDIS_URL`、`CELERY_*`、`SECRET_KEY`、`ALLOWED_HOSTS`、`ENCRYPTION_KEY`、
`SENTRY_DSN`、`TRUSTED_PROXY_COUNT`、`DESK_URL`、`CORS_ALLOWED_ORIGINS`、`EMAIL_*`(不含 `EMAIL_TIMEOUT`)、
`DEFAULT_FROM_EMAIL`、`SOUL_PUSH_ENABLED`、`EXPO_ACCESS_TOKEN`、`MEDIA_ROOT`、`MATRIX_*`)。下文提到的
`PERM_IMPORT_OVERWRITE_ENABLED`、`SCHEDULER_RUN_KEEP_MIN` 等其余 `SCHEDULER_*`、`EMAIL_TIMEOUT` 等不在其中:
要改它们的默认值,得先把变量加进 `x-django-env`(清单见下文「上线清单」§1.1)。2026-10-31 起 settings.py 读的**全部**
`*_RETENTION_DAYS` 都在(默认值与 settings.py 相同,`tests/test_deploy_hardening.py` 逐项核对)。

## 上线清单

> 2026-10-09 起草,基于分支 `chore/deploy-readiness-docs`(从 `feat/v3-modern` 开出)。**只做了部署准备,没有部署任何东西**:
> 没动服务器、DNS、115 测试机。标 **未核实** 的是没在代码里或本机跑出来证实的说法。
> 这一节是**清单**(原 `docs/DEPLOY.md`,2026-11-21 并入本文);各子系统的细节与实测记录在本文后面各节(TLS 首签、续期、定时任务、Matrix、备份恢复、异地副本与告警、恢复演练、RPO/RTO、部署回滚、指标与日志、数据保留、密钥轮换),不重复。
> **2026-10-30 复核**:§0.1、§1.1 的 `ENCRYPTION_KEY`、§3、§7、§8、§9 已按当天的代码改过;其余仍是 10-09 的记录。
> 约定:`DC="docker compose -f docker-compose.yml -f docker-compose.production.yml"`;根 `.env` 由 `scripts/deploy.sh production` 从 `.env.production` 复制(`scripts/deploy.sh:20-34`)。
> 看环境变量是否合格:`scripts/check-deploy-env.sh .env`(退出码非 0 即有 FAIL;不会打印密钥值)。

### 0. 先知道的三件事(代码里已核实,会让上线静默出错)

1. **根 `.env` 里的 `ASSISTANT_*`、`JWT_*` 不会传进容器。** `docker-compose.yml` 的 `x-django-env` 是 backend、celery、celery-beat
   三个服务共用的环境;没列的变量 `settings.py` 读不到就用默认。附录 A 那批(`DESK_URL`、`CORS_ALLOWED_ORIGINS`、`EMAIL_*`、
   `SOUL_PUSH_ENABLED`、`EXPO_ACCESS_TOKEN`)**已补进去**,2026-10-30 又补了 `OPS_ALERT_WEBHOOK_URL`、`LOG_FORMAT`、`METRICS_*`、
   `*_KEY_FALLBACKS` 与两项保留天数(`.env.example` 同步,`backend/tests/test_production.py::TestEnvExample` 守着)。
   还没补的:`ASSISTANT_*`(默认关闭,开「问一问」前要补)与 `JWT_*`(有默认值)。
2. **生产覆盖文件的 backend 启动命令没有 `seed_mythology`**(`docker-compose.production.yml:62-66`),而基础文件有(`docker-compose.yml:88-93`;compose 合并时 `command` 被整条替换)。
   全新生产库里没有租户、界域、冥界人物。首次上线要手动跑一次(见第 6 节),之后不用。
3. **没有 `eas.json`,两个 `app.json` 也没有 `extra.eas.projectId`**(`mobile/app.json`、`mobile-officer/app.json`;`ls mobile/eas.json mobile-officer/eas.json` 均不存在)。
   没有 projectId,App 拿不到 Expo 推送 token(两个 App 共用的 `packages/mobile-ui/src/pushCore.ts`(2026-10-30 起)读 projectId:返回 `no_project_id`,不报错)。见第 9 节。

### 1. 环境变量(按服务)

标记:必=缺了拒绝启动或功能整体不可用;推=缺了能跑但有后果。

#### 1.1 backend / celery worker / celery-beat(同一镜像、同一份 `x-django-env`)

| 变量 | 必? | 缺了/错了会怎样 | 出处 |
|---|---|---|---|
| `SECRET_KEY` | 必 | 空:`ValueError` 拒绝启动。**至少 32 字节**:simplejwt 用它签 HS256,更短 PyJWT 每次签/验发 `InsecureKeyLengthWarning`,`pytest.ini` 里升成 error。Django 的 `check --deploy` 另要求 ≥50 字符且 ≥5 种字符(W009)。建议 64+ 随机字符 | `settings.py:14-16`;`docker-compose.yml:17`(`:?` 缺了 compose 直接报错) |
| `DEBUG` | — | **不要设**(基础文件刻意不写)。设成 true 会关掉 HSTS/SSL 重定向/安全 cookie、放开 CORS(`CORS_ALLOW_ALL_ORIGINS = DEBUG`)、允许 SQLite | `settings.py:23,227,505`;`docker-compose.yml:18-20` |
| `ALLOWED_HOSTS` | 必 | 空:`ValueError` 拒绝启动。写错:所有请求 400。**必须包含 `backend`**(Synapse 推送回调的主机名),否则书信推送静默失败(回调 400) | `settings.py:31-39`;`docker-compose.yml:168`、下文 书信推送一节 |
| `DESK_URL` | 必(见 §0.1) | 官员重置密码/邮箱验证邮件的链接前缀;默认 `http://localhost:3000`。须为公网 https,无末尾斜杠 | `settings.py:765`;`officer_reset.py:144` |
| `ENCRYPTION_KEY` | 必 | `DEBUG=False` 且空:`ImproperlyConfigured` 拒绝启动。格式必须是 Fernet(44 字符 urlsafe-base64 以 `=` 结尾),否则同样拒绝。它加密 `WebhookConfig.signing_secret` 与 `DeathRegistrationRequest.source_payload`。2026-10-30 时加密的列还有官员 / 灵魂两步验证的 `secret`、灵魂账号初始凭据、助手平台 API key(下文「密钥轮换」)。**可以不停机轮换**:`ENCRYPTION_KEY_FALLBACKS` + `manage.py rotate_encryption_key`,步骤见 下文;直接换掉而不留旧 key,旧密文读不出。生成:`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` | `settings.py:695-736` |
| `DATABASE_URL` | 必 | 生产叠加文件把它指到 `pgbouncer:5432`,由 `DB_PASSWORD` 拼出(`docker-compose.production.yml:48`)。含 `sqlite` 且 `DEBUG=False`:拒绝启动 | `settings.py:170-175` |
| `DB_PASSWORD` | 必 | compose 的 `:?` 校验,缺了不启动 | `docker-compose.yml:13`;`production.yml:28,45,151` |
| `REDIS_URL` / `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` | 必 | 生产叠加文件由 `REDIS_PASSWORD` 拼出(`production.yml:49-51`);不用手写。缺 Redis:权限缓存退回进程内存(默认 TTL 0,每次查库;同一请求内的重复检查只问一次,2026-10-30)、WebSocket 与 Celery 全部不可用 | `settings.py:135,388-389` |
| `REDIS_PASSWORD` | 必 | `production.yml:16` 的 `:?` 校验 | |
| `REDIS_CACHE_URL` / `CHANNEL_LAYER_REDIS_URL` / `CACHE_PERMISSION_REDIS_URL` | — | 2026-11-16 起 Redis 按用途分库:`REDIS_URL` 的 db 0 = **状态**缓存 `default`(登录锁定、验证码、一次性标记、幂等键、锁、版本号;不清、不淘汰,Redis 挂了答 503 `unavailable`);db 1 / 2 = Celery;**db 3 = 纯缓存 `data`**(功过摘要、价格表、Matrix 令牌)与权限缓存;**db 4 = WebSocket channel layer**。不设时按 `REDIS_URL` 的主机换 db 号推出来(带密码的 URL 一并带过去),不用手写。纯缓存挂了照常服务(查库) | `settings.py` Redis 一节;`apps/core/cache.py` |
| `CACHE_KEY_PREFIX` | — | 默认库名。两个缓存别名的键都带它,两个部署共用一台 Redis 时互不读写 | `settings.py` CACHES |
| `REDIS_SOCKET_TIMEOUT` | — | 默认 0.5 秒(连接与读);此前没设,redis-py 默认 5 秒 —— Redis 黑洞时每个请求先等 5 秒。channel layer 仍是 15 秒(必须长于它的阻塞读) | `settings.py` |
| `SHARD_DATABASE_URL_<CIV>` | — | 分库(CHINESE / EUROPEAN / EGYPTIAN / GREEK,只认 PostgreSQL)。**四个都设 = 分库形态**(各文明的行读写在自己的分库,控制库不留它们);**都不设 = 单库**;只设一部分启动即拒绝。2026-11-21 起没有「逐文明切换」:旧的 `SHARD_READ_CIVS` / `SHARD_WRITE_CIVS` / `SHARD_PURGED_CIVS` 不再读取,可以从环境里删掉。新建的分库先 `migrate_shards` 再 `assign_shard_id_ranges --all`。控制库有 `SHARD_PURGED` 记录(第五阶段清除过)时,不配分库的进程同步即拒绝 | `settings.py` `SHARDED`;`apps/core/sharding.py::check_shard_settings` |
| `DB_STATEMENT_TIMEOUT_MS` | — | 默认 60000:每个 PostgreSQL 别名(控制库与各分库)连接时带 `-c statement_timeout=…`;0 = 不设。**经 PgBouncer 连时必须设 0**(PgBouncer 不转发 `options`,会拒绝连接),生产叠加文件已设 0,见 §4「数据库超时与连接数」 | `settings.py::_apply_statement_timeout` |
| `TRUSTED_PROXY_COUNT` | — | 生产叠加文件写死 `"1"`(nginx 一跳)。别改成 0:审计日志/登录限速/API key IP 白名单都会取到 nginx 的地址 | `production.yml:53`;`settings.py:49` |
| `CORS_ALLOWED_ORIGINS` | 推 | 默认只有 localhost。**走同一个 nginx 域名(Web 与 API 同源)时不需要设。** Web 与 API 分在不同源时必须列**完整源**(`https://desk.example.com`),不能是 `*`:`CORS_ALLOW_CREDENTIALS=True` 是为 2FA「30 天不再询问」设备 cookie 开的(`mfa.py:325-331`:httpOnly、`SameSite=Lax`、`secure=not DEBUG`、path `/api/v1/auth/`)。Lax cookie 只在**同站**(同一可注册主域,如 `desk.example.com` 与 `api.example.com`)的 XHR 里随请求发送;跨站域名这个 cookie 永远发不出去,2FA 每次都要验 | `settings.py:236-239` |
| `CSRF_TRUSTED_ORIGINS` | — | 全仓库没有这个设置(`grep CSRF_TRUSTED` 无结果)。API 走 JWT bearer,DRF 不校验 CSRF;只有 Django admin(`/admin/`)的表单登录受影响:若 admin 从 nginx 的 https 域名访问,Django 看到的是 `X-Forwarded-Proto: https` 与 `Host`,同源,通常不需要。**admin 登录实测:未核实** | |
| `SECURE_SSL_REDIRECT` | — | 默认 true;staging 叠加文件设 false(`staging.yml:14`)。`/health/` 与 Synapse 回调路径豁免 | `settings.py:514,524` |
| `SENTRY_DSN` | 推 | 空:启动 warning,无错误追踪、无 beat 的 Sentry Crons。**前端不会拿到它**:`frontend/Dockerfile` 没有 `SENTRY_DSN` 的 ARG(`frontend/next.config.js` 只在构建时看到它)。浏览器端同理:Dockerfile 也没有 `NEXT_PUBLIC_SENTRY_DSN` 的 ARG,而 2026-10-30 起构建时这个变量为空就**整个不打包 Sentry SDK**(`frontend/instrumentation-client.ts` 文件头),所以按现在的镜像,网页端不上报错误 | `settings.py:774-802` |
| `EMAIL_HOST` `EMAIL_PORT` `EMAIL_HOST_USER` `EMAIL_HOST_PASSWORD` `EMAIL_USE_TLS` `EMAIL_USE_SSL` `DEFAULT_FROM_EMAIL` | 推(见 §0.1) | 目前只有找回密码验证码与官员重置/验证邮件会发信。没配:启动 warning,而且**发信失败界面不显示**(接口答同一个响应),上线后必须真发一封验证。找回密码与灵魂端的几封由 celery worker 发,worker 也要有这组变量 | `settings.py:743-762` |
| `JWT_ACCESS_LIFETIME`(默认 30 分钟)、`JWT_REFRESH_LIFETIME`(默认 10080 分钟)、`JWT_OFFICER_APP_REFRESH_LIFETIME_HOURS`(默认 24) | — | 有默认值 | `settings.py:306-310` |
| `MEDIA_ROOT` | — | compose 写死 `/app/media`(`docker-compose.yml:27`),对应 `media_files` 卷 | |
| `POST_MEDIA_X_ACCEL` | — | 生产叠加文件设 `"true"`;**只有前面真有这份 nginx 才能开** | `production.yml:59` |
| `DISABLE_SERVER_SIDE_CURSORS` | — | 生产叠加文件对三个 Django 服务都设 `"true"`(pgbouncer 事务池) | `production.yml:57,79,94` |
| `SOUL_PUSH_ENABLED` / `EXPO_ACCESS_TOKEN` | 推(见 §0.1) | 不开:推送只记 `DISABLED` 行。开:backend 与 celery worker **都要有**;worker 要能出站 `exp.host:443`。`EXPO_ACCESS_TOKEN` 仅在 Expo 控制台开了「增强推送安全」时才必需 | `settings.py:415-417`;下文 推送一节 |
| `MATRIX_ENABLED` | — | 默认 `False`,关着时 `/me/chat/` 与 `/chat/inbox/` 答 503 | `settings.py:424` |
| `MATRIX_PUBLIC_BASEURL` `MATRIX_SERVER_NAME` `MATRIX_JWT_SECRET` `MATRIX_GRANT_SECRET` `MATRIX_HOOK_SECRET` `MATRIX_REGISTRATION_SHARED_SECRET` `MATRIX_USER_SALT` | 开聊天时必 | `MATRIX_USER_SALT` 空则**拒绝启用聊天**(`settings.py:440` 注释);`MATRIX_SERVER_NAME` 与 `MATRIX_USER_SALT` 定了就不能改(mxid 全变);`MATRIX_JWT_SECRET` / `MATRIX_GRANT_SECRET` / `MATRIX_HOOK_SECRET` 各 ≥32 字节、互不相同,**两边(后端与 homeserver.yaml 的 `jwt_config.secret` / 模块 `grant_secret` / `hook_secret`)一起改**;后两项没设时退回 `MATRIX_JWT_SECRET` 并警告(过渡,上线前必须设)。这几项已在 `x-django-env` 里(`docker-compose.yml:31-37`) | 下文「灵魂聊天」 |
| `ASSISTANT_ENABLED` `ASSISTANT_PROVIDER` `ASSISTANT_API_KEY` `ASSISTANT_BASE_URL` `ASSISTANT_MODEL` `ASSISTANT_EMBEDDING_URL` … | 开「问一问」时 | 默认关(`ASSISTANT_ENABLED=False`,接口 503)。**`ASSISTANT_EMBEDDING_URL` 默认 `http://gates-host.lan:11434`(局域网 Ollama),上线前必须换成部署内可达的服务**;每殿还要 `Tenant.settings["assistant_enabled"]=true`。也不在 `x-django-env` 里(§0.1) | `settings.py:452-485` |
| `SCHEDULER_*`、`CACHE_PERMISSION_*` | — | 有默认值,见 `settings.py` 对应注释 | |

#### 1.2 celery worker / celery-beat 的差别

- 环境同上(同一个 `*django-env` 锚点,`production.yml:73-101` 只覆盖数据库/Redis 三个地址)。worker 需要 `SOUL_PUSH_ENABLED`、`EXPO_ACCESS_TOKEN`、`EMAIL_*`、`MATRIX_*`、`ASSISTANT_*`——任务里发推送/邮件/调 Matrix。
- **worker 不在,找回密码验证码、灵魂联系邮箱验证码与初始密码邮件都不发**(2026-10-30 起由 worker 发,请求只入队;见 下文「邮件」)。
- **worker 进程数写死为 2**(`--concurrency=2 --max-memory-per-child=200000`,`docker-compose.yml`):默认是「每个 CPU 一个子进程」,每个子进程是一整个 Django,8 核主机就是 9 个进程挤在 512m 里。算术(2026-10-31 在 unRAID 的门禁容器里实测空闲 worker,同一份依赖):主进程 RSS 167 MB、每个子进程 RSS 136 MB;按 PSS(共享页只算一份)三个进程合计约 267 MB,容器 cgroup 289 MiB。子进程涨过 200000 KiB(约 195 MB)RSS 时做完当前任务就被换掉,所以最坏约 100 + 2 × 160 ≈ 420 MB PSS < 512m,而不是整个容器被 OOM 杀掉。**空闲值是实测,忙时没量过**,上线后 `docker stats` 看一次;要加并发先加内存上限,每个子进程按 150 MB 算。
- 二者都 `depends_on: backend: service_healthy`(`docker-compose.yml:126-128,134-136`):backend 里 `migrate` 没跑完它们不起。
- **beat 只起一个**,见第 7 节。

#### 1.3 frontend(Next.js 16,standalone 镜像)

| 变量 | 必? | 说明 |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | 必 | **构建参数,不是运行时变量**(`frontend/Dockerfile:26-27`、`docker-compose.yml:189`)。构建时写进 bundle;改了要重 build 镜像。必须是浏览器可达的公网地址,如 `https://example.com/api/v1`。默认 `http://localhost:8000/api/v1`,不设就是把线上前端指向访客自己的电脑。`proxy.ts` 的 CSP `connect-src` 与 `wss://${host}` 都由它派生(`frontend/proxy.ts:59`) |
| `PORT` `HOSTNAME` `NODE_ENV` | — | Dockerfile 已写死(`frontend/Dockerfile:46-52`) |
| `SENTRY_*` | — | 镜像里不会生效(见 1.1 `SENTRY_DSN`) |

#### 1.4 Synapse / Matrix

见 下文「灵魂聊天」。清单:根 `.env` 填 `MATRIX_PUBLIC_BASEURL`(含末尾 `/`,如 `https://example.com/`)、`MATRIX_SERVER_NAME`、`MATRIX_JWT_SECRET`(≥32)、`MATRIX_GRANT_SECRET`(≥32)、`MATRIX_HOOK_SECRET`(≥32,三把互不相同)、`MATRIX_REGISTRATION_SHARED_SECRET`、`MATRIX_USER_SALT`、`SYNAPSE_DB_PASSWORD`;
`MATRIX_ENABLED` 先留 `False`,跑完 `scripts/synapse-init.sh`、`up -d --wait synapse`、`up -d nginx` 后改 `True`,再 `up -d backend celery celery-beat` 并 `exec backend python manage.py setup_matrix`。
`config/synapse/soulledger_policy.py` 必须挂进去(`docker-compose.yml:152`),少了它灵魂能绕过全部聊天规则。

#### 1.5 手机端构建(Expo,构建时内联)

| 变量 | App | 缺了怎么样 |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | 灵魂端 `mobile/`(官员端 `mobile-officer/` 复用同一个 platform 模块:`mobile-officer/src/shared.ts` 从 `@soulledger/mobile-ui/src/*` 再导出(2026-11-21 起两端共用模块在 `packages/mobile-ui`),**官员端是否同样读这个变量:未核实**) | 回退 `http://10.0.2.2:8000/api/v1`(Android)/ `http://localhost:8000/api/v1`(iOS),商店包会连自己的手机(`packages/mobile-ui/src/platform.ts:89-93`) |
| `EXPO_PUBLIC_DESK_URL` | 官员端 | 官员端「打开官员台」之类的链接前缀,回退 `http://localhost:3000`(`mobile-officer/src/rules.ts` 的 `deskBaseUrl()`) |
| EAS `projectId` | 两个 App | 见第 9 节 |

`EXPO_PUBLIC_*` 在打包时替换进 JS,构建机上设,不是服务器上设。

### 2. HTTPS 与域名

- 准备:一个主域(例 `example.com`)A/AAAA 记录指向主机;80、443 公网可达。Web、API、`/ws/`、`/_matrix` 都在同一个 nginx 域名下(`nginx.conf` 一个 `server`,`server_name _`),因此 Web 与 API **同源**,不需要 CORS。
- 若坚持把 API 放子域(`api.example.com`):`nginx.conf` 要拆 server_name,`CORS_ALLOWED_ORIGINS` 列 Web 源,且必须同一可注册主域才保住 2FA 设备 cookie(`SameSite=Lax`)。**这条路径本仓库没测过(未核实)。**
- 首签与启用 443:按 下文「TLS 证书」5 步(先 `--staging`,再正式)。2026-10-31 起**不用改 `nginx.conf`**:根 `.env` 设 `TLS_DOMAIN`,证书在 `/etc/letsencrypt/live/$TLS_DOMAIN/{fullchain,privkey}.pem` 就自动 443 + 80 跳转(ACME 挑战除外),不在就只听 80、nginx 照样起来(`scripts/nginx-entrypoint.sh`,每 5 分钟复查)。`SECURE_SSL_REDIRECT` 开着(默认)而没有 `TLS_DOMAIN` 或证书,`check-deploy-env.sh` 拒绝;首签那一次用 `ALLOW_NO_TLS_CERT=1`。
- **HSTS 一旦发出就是一年**:Django 发 `max-age=31536000; includeSubDomains; preload`(`settings.py:507-509`),nginx 也发(`nginx.conf` 安全头)。`includeSubDomains` 意味着该主域**所有子域**都必须有 https,再决定是否真去提交 preload 名单。
- `SECURE_PROXY_SSL_HEADER` 信任 `X-Forwarded-Proto`(`settings.py:528`);后端端口不对外发布(基础文件无 `ports`),只有 nginx 发布 80/443(`production.yml:209-211`)。别直接把 8000 暴露出去。

### 3. 证书续期与失败告警

- `certbot` 服务每 12 小时 `certbot renew`,成功 touch `/etc/letsencrypt/.renew-ok`,失败打印 `certbot renew FAILED exit=N`;续出新证书时 touch `.deployed`,nginx 容器每 5 分钟看到标记就 reload(`production.yml:181-205,226-238`)。
- 它的 healthcheck:没有证书、或最近一次成功的 renew 超过 25 小时(`find … -mmin -1500`)→ unhealthy。**但 Docker 的 unhealthy 本身不会通知任何人**(compose 不看它)。2026-10-30 起备份与定时任务的失败会 POST 到 `OPS_ALERT_WEBHOOK_URL`(下文「备份异地副本与告警」),**certbot 没有接**。上线前接一个外部告警,任选:
  1. 监控脚本每小时跑 `docker inspect --format '{{.State.Health.Status}}' $(docker compose -f docker-compose.yml -f docker-compose.production.yml ps -q certbot)`,非 `healthy` 就发消息;
  2. 外部探测证书剩余天数(与 certbot 无关,最可靠):`echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -enddate`,剩余 < 14 天告警;
  3. 同理盯 `backup` 服务的 healthcheck(见第 8 节)。
- 手动演练:`$DC run --rm --no-deps --entrypoint certbot certbot renew --dry-run --webroot -w /var/www/certbot`。

### 4. 部署顺序与数据库迁移

首次上线(空库):
1. `scripts/check-deploy-env.sh .env` 全部 PASS。
2. `cp .env.example .env.production` 填值 → `scripts/deploy.sh production`(= 复制成 `.env` 后 `$DC up -d`)。首次还没有证书:nginx 自动只听 80(见第 2 节),按首签流程来;这一次的 `check-deploy-env.sh` 用 `ALLOW_NO_TLS_CERT=1`。
3. `backend` 容器启动命令依次跑:`collectstatic` → `migrate` → `setup_scheduled_tasks` → `daphne`(`production.yml:62-66`)。`migrate` 是启动命令的一部分,**每次容器重启都会跑一遍**(幂等,但意味着迁移期间 backend 不健康、celery/beat 因 `service_healthy` 等着)。
4. `$DC ps` 等 `backend` healthy(健康检查走 `/health/`,`docker-compose.yml:98-112`;`start_period` 40 秒,迁移多时可能不够——**大库首次迁移耗时:未核实**,`26` 条迁移往返测试每条 2–67 秒,见 `CLAUDE.md`)。
5. 跑第 6 节的一次性命令。

升级(已有数据):
1. 先备份:见第 8 节(**别跳过**:迁移没有自动回滚)。
2. `git pull` 到目标 tag/提交 → `$DC build backend frontend`(backend/celery/celery-beat 共用 `soulledger-backend` 镜像,`docker-compose.yml:72`)。
3. `$DC up -d`。Compose 会按依赖顺序:db/redis → pgbouncer → backend(迁移)→ celery、celery-beat。
4. 迁移是否破坏性:发布前读目标版本里新增的 `backend/apps/*/migrations/`;含 `RemoveField`/`DeleteModel`/`RunPython` 的,回滚前提是已备份。CLAUDE.md 记过 `apps/perm/migrations/0017` 在真 PostgreSQL 上因 `except: pass` 触发事务中止——**每次发布前用真 PG 跑一遍 `makemigrations --check` 与迁移**(CI/pre-push 默认只在 SQLite 上跑,见 `CLAUDE.md`「SQLITE HIDES A WHOLE CLASS OF DEFECT」)。
5. 部署后:`$DC exec backend python manage.py sync_permissions`(先 `--dry-run`)——启动命令**不**自动跑它。
6. **2026-11-16 那一版(Redis 分库 + 键前缀)上线时一次性丢掉 Redis 里的旧键**:旧键在 db 0 没有前缀,新代码读不到 ——
   登录锁定与递增延迟清零、进行中的找回密码验证码 / 联系邮箱验证码作废(用户重发即可)、幂等键与书信 txn_id 失效
   (那一刻正在重试的请求可能重做一次)、beat 锁丢一个周期、权限缓存与功过摘要冷启动。旧键靠各自 TTL 消失(最长 7 天的
   txn_id);不想等就在维护窗口里对 db 0 删掉不带前缀的键。channel layer 换到 db 4:已连着的 WebSocket 会重连一次。

#### 数据库超时与连接数(5 个别名)

- **`statement_timeout`**:直连 PostgreSQL 时由 `DB_STATEMENT_TIMEOUT_MS`(默认 60 秒)给每个别名带上。经 PgBouncer(生产叠加文件)
  不能用连接参数,设在角色上:`ALTER ROLE soulledger SET statement_timeout = '60s';`(各分库若用不同角色,每个角色一条),
  分库上再加 `ALTER ROLE … SET idle_in_transaction_session_timeout = '60s'`。迁移里有超过 60 秒的单条语句(大表建索引)时,
  迁移前临时 `SET statement_timeout = 0` 或在那一条迁移里 `RunSQL("SET LOCAL statement_timeout = 0")`。
- **连接预算**:每个线程 / worker 对每个摸到的别名各持一条长连接(`conn_max_age=600`)。分库形态下灵魂端与全局任务会摸到
  全部 5 个别名,所以按 **5 × 并发线程数** 算:daphne 线程池 + celery `--concurrency=2` + beat。生产叠加文件的 PgBouncer
  只配了一个库(`DATABASE_URL`)、`MAX_CLIENT_CONN 200`、`DEFAULT_POOL_SIZE 20`:加分库时 (a) 给 PgBouncer 配上 4 个分库的条目
  (edoburu 镜像用 `DATABASES_*` 或挂一份 `pgbouncer.ini`),`SHARD_DATABASE_URL_<CIV>` 指向 PgBouncer 而不是直连;(b) `MAX_CLIENT_CONN`
  至少乘 5;(c) 5 个库在同一台 PostgreSQL 上时 `max_connections` 是共用的:`DEFAULT_POOL_SIZE × 5` 加上直连的迁移 / 备份要小于它。
  本仓库没有改生产的 PgBouncer 配置 —— 上分库那天按这三条改。

### 5. `manage.py check --deploy` 结果(2026-10-09 实跑)

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

### 6. 部署后的一次性命令

全部在 `$DC exec backend python manage.py …`(`$DC` 见文首)。

首次上线,按顺序:

| 命令 | 何时 | 安全吗 |
|---|---|---|
| `seed_mythology` | **首次一次**(生产叠加文件的启动命令不跑它,§0.2)。建租户、界域、冥界人物、冥律语料 | **安全,可重跑**:按 `realm_code` / `(civilization,name)` 匹配,默认只创建不覆盖,软删行不复活(`actors/management/commands/seed_mythology.py` 文件头;`backend/tests/test_seed_entrypoint.py`)。**别加 `--update`**,它会让种子值覆盖运维改动 |
| `setup_scheduled_tasks` | 启动命令已自动跑(`production.yml:65`) | 安全、幂等;保留运维改过的启停/cron。`--reset` 会丢弃运维改动,**不要在生产随手加** |
| `sync_permissions`(先 `--dry-run`) | 每次部署后 | 安全:只补缺失的权限码名,不碰已有行(`perm/management/commands/sync_permissions.py`) |
| `snapshot_balances` | 带 `ledger` 0002 的那次部署,跑一次 | 安全,覆盖当月一行,不补更早月份(下文 部署后一节) |
| 创建第一个管理员 | 首次 | `createsuperuser` 创建的用户 `role` **不是** `ADMIN`,是默认的 `VIEWER`、不绑殿(`role` 默认值 `apps/authentication/models.py` 的 `UserRole.VIEWER`;代码里没有任何地方读 `is_superuser`)。建完要把它的 `role` 改成 `ADMIN`(不绑殿即全局管理员)。公开注册 `/auth/register/` 已于 2026-10-27 删除。`seed_dev_users` 只在 `DEBUG=True` 下可用,**不是**生产建号的办法 |
| `setup_matrix`(开聊天后) | 见 §1.4 | 幂等 |
| `create_api_key <名称> --tenant CN_DIYU`(死亡同步外部系统) | 按需 | 正常运维命令,密钥只显示一次(**输出格式:未核实**) |

**生产上不要跑**(或要想清楚再跑):

| 命令 | 为什么 |
|---|---|
| `seed_field_permissions` | 文件头写的是「seed **example** FieldPermission rules」,按 `ADMIN/JUDGE/GUARDIAN/VIEWER` 建角色。这是示例数据,会不会和运维在权限矩阵里的配置打架:**未核实**。生产不跑,除非先读完它 |
| `seed_workflow_templates` | 2026-10-19 起按殿建正式模板(带退回规则),默认只建缺的;已有且不同的行要 `--update` 才发布成新版本(旧版留在历史里),有未发布草稿的行不动 |
| `seed_tenants` | `get_or_create`,幂等;但与 `seed_mythology` 里建租户重复(`actors/mythology/seeding.py:175`)。二选一即可,用 `seed_mythology` |
| `init_organizations` | 组织架构初始数据。是否幂等:**未核实** |
| `backfill_soul_accounts` | 回填命令,针对已有历史数据;全新库不需要。**别在生产盲跑**(其余一次性修复命令 `fix_actor_civilization`、`consolidate_eu_pantheon`、`migrate_actors_to_users`、`backfill_sentence_plans`、`backfill_soul_entry_path`,以及分库过渡期的 `backfill_disposition_halls`、`purge_cut_over_tenant_rows`、`shadow_read_diff` 已于 2026-11-21 删除,见 git 历史) |

### 7. celery-beat 只能起一个

- `docker-compose.yml:130-136` 里 `celery-beat` 只有一份。**不要** `up --scale celery-beat=2`,也不要在第二台机器上对同一个库再起 beat——两个 beat 读同一张调度表会把每个任务派发两次;单飞锁只挡得住时间重叠的那次。
- 调度表在数据库里(`DatabaseScheduler`,`settings.py:394`),清单在 `backend/apps/scheduler/registry.py`。
- 上线后验证:`/scheduler` 页面各行已启用;`GET /health/detailed/`(需 ADMIN 登录)的 `scheduler` 字段不是 `"overdue"`——状态码仍是 200,**探针要读字段**。
- beat 没起的后果(下文):审批节点超时不自动处理、推送回执不核对、余额/普查快照不写、孤儿图片不清理。
- worker 重启不影响 beat;beat 重启会按数据库继续。
- 2026-10-30 起 worker 与 beat 都有 healthcheck(beat 持有单 beat 锁才健康),`/metrics/` 有 `soulledger_scheduler_overdue_jobs`,定时任务失败与逾期另 POST `OPS_ALERT_WEBHOOK_URL`。联调清单见 下文「定时任务」。

### 8. 备份

- `backup` 服务(`docker-compose.production.yml`,镜像 `postgres:16-alpine`;2026-10-30 前用 pgvector 镜像时没有 `crond`,每日 cron 从没起来):启动先备份一次(失败容器退出),之后容器内 cron **每天 02:00**(容器时区,镜像默认 UTC)跑 `scripts/backup-db.sh`,文件在主机 `./backups/`:`soulledger_*.sql.gz`(库)、`soulledger_media_*.tar.gz`(头像媒体)、聊天初始化后再加 `soulledger_synapse_*.dump` 与 `soulledger_synapse_data_*.tar.gz`(签名密钥,丢了等于换了一台 homeserver)。
- **分库(2026-11-16 起)**:设了 `SHARD_DATABASE_URL_<CIV>` 时,每个分库另出一份 `soulledger_civ_<civ>_<时间戳>.sql.gz`(与控制库同一个时间戳),
  `soulledger_manifest_<时间戳>.txt` 列出这一轮写了哪些(别名 + 文件名,不含 URL)。backup 服务要拿到这几个变量(compose 里给它加上)。
  `BACKUP_DRY_RUN=1` 只列出要备份的库。**这些是先后跑的 pg_dump,不是跨库一致的快照**:要一个时间点上一致的整套,5 个库在同一台
  PostgreSQL 上时用整实例物理备份(`pg_basebackup` / 卷快照)。恢复演练(`restore-drill.sh`)目前只验控制库。
- healthcheck:任一应有的最新备份超过 26 小时 → unhealthy。备份失败会 POST `OPS_ALERT_WEBHOOK_URL`;**unhealthy 本身仍没有人被通知**(§3)。
- **异地副本**:设 `BACKUP_OFFSITE_REMOTE` 后每次备份 `rclone copy` 到那里(下文「备份异地副本与告警」)。**目标还没定**(用户 2026-10-30),不设时备份只在本机 `./backups/`,机器坏了一起坏。
- **2026-10-31 起不设就不算部署好**:`check-deploy-env.sh` 在 `OPS_ALERT_WEBHOOK_URL` 或 `BACKUP_OFFSITE_REMOTE` 为空时 FAIL,除非明写 `ALLOW_NO_ALERTS=1` / `ALLOW_NO_OFFSITE=1`(变成 WARN)。`backup` 服务带 `BACKUP_STRICT=1`:缺这两样(且没明写放弃)时备份照写,但脚本退出 3、打印醒目的告警块、healthcheck 转 unhealthy(`.backup-ok` 只在退出 0 时才有),每晚的日志里都会再出现一次。告警发不出去时 `ops-alert.sh` 也打印一整块 `ALERT NOT DELIVERED` 并返回非 0。
- **加密**:设 `BACKUP_AGE_RECIPIENT`(age 公钥)后异地只传 `.age`;设了异地而没设公钥,异地复制被拒(退出 3),除非 `ALLOW_PLAINTEXT_OFFSITE=1`(下文「备份加密」)。
- **密钥不在备份里,另存进密码管理器**:`ENCRYPTION_KEY` + `ENCRYPTION_KEY_FALLBACKS`(丢了,库里加密列永久不可读)、`SECRET_KEY` + `SECRET_KEY_FALLBACKS`、age 私钥、`MATRIX_*` 全部、`MATRIX_USER_SALT`。最省事:整份根 `.env` 存一份,每次轮换后更新。
- 恢复只能进空库,步骤与实测记录见 下文「数据库备份与恢复」。**上线前至少在 staging 演练一次完整恢复**:`scripts/restore-drill.sh`(下文「恢复演练」;2026-10-31 起同时演练媒体、Synapse 库与签名密钥,`BACKUP_AGE_IDENTITY` 验解密,`DRILL_STANDALONE=1` 在另一台机器上演练)。RPO 24 小时 / RTO 2 小时(用户 2026-10-30 接受);**PITR 只写了做法、没有配**(下文「RPO / RTO」写了为什么不放进 compose)。
- **Redis 有卷了**(`redis_data`,AOF 每秒落盘):重建 redis 容器不再丢队列里还没被 worker 取走的任务(找回密码邮件、导出、推送)。健康检查要 `PONG`,生产经 `REDISCLI_AUTH` 带密码。
- **容器日志有上限**:每个服务 `json-file`,10 MB × 5 个文件(两份 compose 里的 `x-logging` 锚点)。要集中日志见 下文「指标与集中日志」。
- 部署前手动补一份:`$DC run --rm --no-deps backup /scripts/backup-db.sh /backups`(与 下文「部署回滚」第 1 步同一条)。

### 9. 回滚

**按 下文「部署回滚」做**(2026-10-30:部署前给镜像打 `prev-<sha>` 标签并备份;先在新镜像里倒回迁移再换旧镜像;不可逆迁移登记在 `backend/tests/irreversible_migrations.txt`,当天为空)。仍没有回滚脚本,整套也未演练。下面是 10-09 的原记录:

- **只回滚代码、迁移没变**:`git checkout <上一个 tag>` → `$DC build backend frontend` → `$DC up -d`。镜像是本地构建、标签固定为 `soulledger-backend`(`docker-compose.yml:72`),不是从镜像仓库拉的,所以「回滚」= 重新构建旧提交。如果想要可秒回的回滚,发布时给镜像打带版本的标签并保留旧镜像(目前没有这样做)。
- **迁移已经跑过**:backend 启动命令只会 `migrate` 向前。要退回:先停 `backend celery celery-beat pgbouncer`,用第 8 节的备份按 下文 恢复进空库(会丢失备份之后的数据),再启动旧版本。逐条 `migrate <app> <旧编号>` 的反向迁移:**未核实**哪些迁移可逆(CLAUDE.md 提到 `afc159a1` 迁移往返测试存在,说明有一部分被往返验证过,但不是全部)。
- **前端**:`NEXT_PUBLIC_API_URL` 烘焙在镜像里,回滚前端 = 重建旧提交的镜像。
- **证书/nginx 配置出错**:`nginx.conf` 是只读挂载的单文件;改坏了还原文件后 `$DC restart nginx`(或 `exec nginx nginx -s reload`)。`/.well-known/acme-challenge/` 与 80 端口别动。
- **App**:商店版本无法立即撤回。发布前先走 TestFlight / 内部测试轨道。

### 10. 需要你本人完成的 App 商店步骤

我无法代办(账号、签名、付款、证书):

1. **开发者账号**:Apple Developer Program(年费)、Google Play Console(一次性费用)、Expo 账号(EAS)。
2. **Bundle ID / 包名**(已在 `app.json` 里固定):灵魂端 `com.soulledger.soul`;官员端 `com.soulledger.officer`(iOS `ios.bundleIdentifier`,Android `android.package`)。在 Apple/Google 后台先注册这两个标识。
3. **EAS 项目与 projectId**:在 `mobile/` 与 `mobile-officer/` 各自 `npx eas-cli init`(生成 projectId 并写进 `app.json` 的 `extra.eas.projectId`)和 `eas build:configure`(生成 `eas.json`)。**这两个文件目前都不存在**。没有 projectId 就没有推送 token(第 0.3 节)。
4. **构建环境变量**:在 `eas.json` 的 profile `env` 或 EAS 控制台里设 `EXPO_PUBLIC_API_URL=https://example.com/api/v1`(两个 App)、`EXPO_PUBLIC_DESK_URL=https://example.com`(官员端)。商店包没设就连 localhost。
5. **iOS 推送证书**:在 Expo(EAS)上配置 APNs 密钥(`eas credentials`)。后端不持有它(下文「灵魂端推送」)。
6. **Android 推送**:FCM 凭据(FCM v1 服务账号密钥)上传到 Expo/EAS;`google-services.json` 是否需要放进项目:**未核实**(`app.json` 的 `android` 段目前没有 `googleServicesFile`)。
7. **签名**:iOS 分发证书与 provisioning(`eas build` 可托管)、Android 上架密钥(Play App Signing)。
8. **原生构建**:本 App 是 dev-client,用了 `expo-notifications`、`expo-secure-store`、`expo-image-picker` 等原生模块,**不能用 Expo Go**;商店包用 `eas build --platform ios|android --profile production`。
   Android release 构建(两个 App 都挂了 `mobile/plugins/withBuildTuning.js`,2026-10-30 起):开 R8 与资源裁剪(`android.enableMinifyInReleaseBuilds` /
   `android.enableShrinkResourcesInReleaseBuilds`,只作用于 `buildTypes.release`,debug dev client 不变),`reactNativeArchitectures` 只有
   `armeabi-v7a,arm64-v8a`(不含 x86,装不进 x86 模拟器;`expo run:android` 会按连着的设备改写)。release 清单**不允许明文 http**
   (只有 debug 清单开了 `usesCleartextTraffic`),所以 release 包的 `EXPO_PUBLIC_API_URL` 必须是 `https://`;连 `http://` 后端时请求全部失败,
   界面停在出错页。2026-10-30 在 unRAID 上 `assembleRelease`(arm64)装到真机:能启动、无 ClassNotFound,连 http 的测试后端失败即此原因。
9. **上架材料**:隐私政策 URL、截图、应用描述、年龄分级;`expo-image-picker` 的相册权限文案在 `mobile/app.json`。灵魂端**社交/聊天内容**(UGC)——Apple 审核会要求举报/屏蔽入口;是否已满足:**未核实**。
10. **通知**:`soulledger-soul` 与 `soulledger-officer` 各自独立的 Expo 项目;推送令牌 `SOUL_PUSH_ENABLED=True` 并重启 backend/worker 后,最近 24 小时内记为 `DISABLED` 的行会被 `soul_push.sweep` 补发(要 beat 在跑)。

### 11. 上线后冒烟测试清单

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

### 附录 A:让 compose 把缺的变量传进容器的补丁

> **已应用**(现行 `docker-compose.yml` 的 `x-django-env` 里有这些行),留作记录;`ASSISTANT_*` 仍未补。

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

### 附录 B:本文用到的校验脚本

`scripts/check-deploy-env.sh [ENV_FILE]`:一项一行 `PASS`/`FAIL`/`WARN`,有 `FAIL` 退出码 1,不打印密钥值。检查项:`SECRET_KEY` 存在且 ≥32 字节、`DEBUG` 不为 true、`ALLOWED_HOSTS` 存在且无 `*`、`DESK_URL` 存在且 https 且非 localhost、`ENCRYPTION_KEY` 存在且为 Fernet 格式、数据库/Redis 凭据存在、`NEXT_PUBLIC_API_URL` 为 https、`CORS_ALLOWED_ORIGINS` 无通配/localhost、开聊天时 `MATRIX_*` 齐全且 `MATRIX_JWT_SECRET` ≥32 字节;`SECURE_SSL_REDIRECT` 开着时 `TLS_DOMAIN` 存在且 `${LETSENCRYPT_DIR:-/etc/letsencrypt}/live/$TLS_DOMAIN/fullchain.pem` 在(读不到就用 root 跑;首签 `ALLOW_NO_TLS_CERT=1`);`OPS_ALERT_WEBHOOK_URL`、`BACKUP_OFFSITE_REMOTE` 存在(或 `ALLOW_NO_ALERTS=1` / `ALLOW_NO_OFFSITE=1`,降为 WARN);设了异地就要 `BACKUP_AGE_RECIPIENT` 是 age / ssh 公钥(或 `ALLOW_PLAINTEXT_OFFSITE=1`)。`ALLOW_*` 可以写在文件里,也可以只在这次命令行上给。`SENTRY_DSN`、`EMAIL_HOST` 为空只给 `WARN`。测试:`backend/tests/test_check_deploy_env_script.py`、`backend/tests/test_deploy_hardening.py`。

## TLS 证书:首次签发(手动,一次)

`certbot` 服务只负责续期。首签需要真实域名,不在 compose 里自动做。

1. 域名的 DNS 指向这台主机,80 端口从公网可达。
2. 根 `.env` 设 `TLS_DOMAIN=<第 3 步 -d 的第一个域名>`,先起 nginx:`$DC up -d nginx`。
   证书还不在,nginx 的入口脚本(`scripts/nginx-entrypoint.sh`)就只听 80,日志一行
   `WARNING: TLS_DOMAIN=… but no certificate`;`/.well-known/acme-challenge/` 从 `certbot_www` 卷提供。
   这一步 `scripts/check-deploy-env.sh` 会因为没有证书而 FAIL,首签这一次用 `ALLOW_NO_TLS_CERT=1 scripts/check-deploy-env.sh .env`。
3. 签发(webroot,与续期同一个卷)。**先带 `--staging` 跑一遍**,通过后去掉再跑 ——
   Let's Encrypt 对失败的验证有速率限制:

   ```bash
   $DC run --rm --no-deps --entrypoint certbot certbot certonly \
     --webroot -w /var/www/certbot \
     -d example.com -d www.example.com \
     --email ops@example.com --agree-tos --no-eff-email
   ```

4. 不用改任何文件:入口脚本每 5 分钟看一次 `/etc/letsencrypt/live/$TLS_DOMAIN/fullchain.pem` 与
   `privkey.pem`,出现了就写出 443 的监听与证书两行、加一个 80 端口的 server(只发 ACME 挑战,其余 301 到
   https),`nginx -t` 通过后 reload(日志 `certificate state changed or renewed; reloading nginx (https)`)。
   等不及就 `$DC restart nginx`。验:`curl -sI http://example.com/` 是 301 到 https,`curl -sI https://example.com/health/` 是 200。
   网页、API、`/ws/`、`/_matrix` 仍是同一个 server、同一个源。
   不用 Let's Encrypt 的证书也一样:把 `fullchain.pem` 与 `privkey.pem` 放到 `/etc/letsencrypt/live/$TLS_DOMAIN/`。
   证书删掉或读不到时,下一次检查会退回只听 80(不会让 nginx 起不来);但 Django 的 `SECURE_SSL_REDIRECT`
   仍会把 http 301 到 https,所以那时全站不可用 —— `check-deploy-env.sh` 部署前就拦这一点。
5. `$DC up -d certbot`

## 续期

- `certbot` 服务每 12 小时跑一次 `certbot renew --webroot -w /var/www/certbot`。
  真的续出新证书时,deploy-hook touch `/etc/letsencrypt/.deployed`;nginx 容器每 5 分钟
  检查这个标记,比上次 reload 新就 `nginx -s reload`(日志 `certificate renewed; reloading nginx`)。
- **失败可见:** `renew` 非零退出时日志有一行 `certbot renew FAILED exit=N`
  (`$DC logs certbot`);没有任何证书、或最近一次成功的 `renew` 超过 25 小时,
  `certbot` 的 healthcheck 为 unhealthy。外部监控盯
  `docker inspect --format '{{.State.Health.Status}}' <certbot 容器>`。
  失败时容器不重启 —— 重启循环会一直撞 Let's Encrypt 的失败限额。
- 手动验证续期路径:
  `$DC run --rm --no-deps --entrypoint certbot certbot renew --dry-run --webroot -w /var/www/certbot`

## 每次部署之后

- **权限码名:** `$DC exec backend python manage.py sync_permissions`(先 `--dry-run` 看会做什么)。
  补建代码里新加、库里还没有的权限码名,并按 `ROLE_PERMISSIONS` 授给默认角色;已有的码名一行不碰,
  管理员在权限矩阵里的改动保留。启动命令**不**自动跑它,加了新码名的版本部署后要手动跑一次。
- 定时任务的行不用手动补:启动命令已经跑 `setup_scheduled_tasks`(见下节)。
- **余额月快照(带上 `ledger` 0002 的那次部署,跑一次):** `$DC exec backend python manage.py snapshot_balances`。
  概览的平均余额卡写「较上月」,要读上个月那一行快照;日常由 `ledger.snapshot_balance_for_tenant`(每天 23:55)
  覆盖当月,但 beat 没跑(见下节)时一行都不会有。这条命令现在就写当月的一行,不补更早的月份;重跑无害(覆盖当月)。

- **灵魂普查日快照(`ledger` 0003):** 仪表盘「趋势」读 `ledger.snapshot_census_for_tenant`(每天 23:50 UTC)写的日快照,
  按状态 / 文明 / 界域各数一遍,每租户每天一行、超过 731 天的顺手删掉。**不回填**(过去某天的状态无法倒推),趋势从第一份快照起有数;
  beat 没跑时没有数据,面板会写「快照还不足两天」。

- **2026-10-29 那批(权限严查 / 数据范围 / 流程决定)部署时:**
  - 先备份 115 再迁移;这批迁移跨 judgment、workflow、events、notifications、authentication、perm、menus、souls、org
    多个 app(以 `showmigrations` 为准)。`perm` 0029 按现有持有关系授出拆分后的业务码(`city_god.*` / `tudi.*` /
    `wangsi.*` / `capture.*` / `*.export` / `ledger.calculate`),`org` 0010 给每殿建根机构 `ROOT_<殿代码>` 并回填灵魂与审判的归属机构。
  - 地府天道(`DY_01_HEAVEN`)停用不靠部署步骤:它写在代码里(`apps/realms/models.py::RETIRED_REALM_CODES`,接口回
    `is_retired`,选单不再列它)。种子里那句「No longer used」说明只在 `seed_mythology --update` 时写进已有的行,
    而 `--update` 会用种子值覆盖运维改动(上文「上线清单」§6),不必为这句说明去跑。
  - 网页的刷新令牌改放 httpOnly cookie:上线后已登录的网页用户要重新登录一次。
  - 助手若配了内网 `base_url`,把那个主机写进 `ASSISTANT_PRIVATE_HOSTS_ALLOWED`(逗号分隔),否则助手管理页整表保存 400。

## 定时任务(celery beat)

- **现状(2026-09-26):没有任何环境在跑 beat。** compose 里有 `celery-beat` 服务,但 115 测试环境
  没起它,生产还没上线。所以下面所有「每 N 分钟」的任务目前都不会自动触发,只能在 `/scheduler`
  页面手动运行。上线时:起 `celery`(worker)与**一个** `celery-beat`,backend 启动时的
  `setup_scheduled_tasks` 会把调度表补齐;之后在 `/scheduler` 确认各行已启用、`/health/detailed/`
  的 `scheduler` 字段不是 `"overdue"`。
- 2026-09-26 新登记的维护任务(此前只能手动跑同名命令,命令仍保留;表里四行,含后来加的书信图片清理):

  | 任务 | 范围 | 默认 cron(UTC) | 作用 |
  |---|---|---|---|
  | `workflow.process_timeouts_for_tenant` | 按租户 | `*/5 * * * *` | 审批节点超时按节点配置自动处理 |
  | `social.cleanup_orphan_post_media` | 全局 | `15 3 * * *` | 删上传了但没发出去的朋友圈图片 |
  | `chat.reconcile_inbox` | 全局 | `45 3 * * *` | 按 Synapse 校对殿司收件箱;聊天没配置时记成功并跳过 |
  | `chat.cleanup_unsent_images` | 全局 | `20 3 * * *` | 删上传超过 24 小时仍未发出的书信图片(行与文件);已发出的不动 |
  | `chat.sync_all_rooms` | 全局 | `50 3 * * *` | 把书信房间的发言权对一遍:补入队失败的同步与到期的禁言;聊天没配置时记成功并跳过 |

  beat 没跑时审批**不会**因超时自动处理,节点会一直停在待办。

- **处置期满与欧洲炼狱升天也靠 beat。** `disposition.expire_due_for_tenant`(按租户,默认 `30 2 * * *`,
  `backend/apps/scheduler/registry.py`;任务在 `backend/apps/disposition/tasks.py`)把刑期走完的处置标为期满,
  并把炼狱期满的欧洲灵魂经地上乐园升到天堂(`backend/apps/disposition/expiry.py::ascend_from_purgatory`,
  `via=TERM_SERVED`)。beat 没跑时这两件事都不会自动发生:可在 `/scheduler` 手动运行,或
  `$DC exec backend python manage.py expire_dispositions`;单个欧洲灵魂也可以走「炼狱复核」流程
  (`CaseType.PURGATORY_REVIEW`,流程批准即视为期满升天,`backend/apps/workflow/models.py`)。

- 调度存在数据库里(`DatabaseScheduler`),清单在 `backend/apps/scheduler/registry.py`。
  backend 的启动命令每次都会跑 `python manage.py setup_scheduled_tasks`:按
  (任务 × 活跃租户) 补齐缺失的 PeriodicTask 行,任务名与参数以清单为准,**保留**运维
  改过的启停 / cron / 时区;删掉旧的扇出行(`ledger.recalculate_all` 等)与已停用租户的行。
  要把 cron 也恢复成默认:`$DC exec backend python manage.py setup_scheduled_tasks --reset`。
  新建租户时由 `Tenant` 的 post_save 自动补行,不用等下次启动。
- 页面 `/scheduler`(权限码 `scheduler.read` / `scheduler.manage`,默认只 ADMIN)可以
  启停、改 cron、手动运行、看执行记录;「重建」等于再跑一遍上面的命令。
- 执行记录(`scheduler_taskrun`)保留 `SCHEDULER_RUN_RETENTION_DAYS`(默认 30)天,失败(FAILURE)
  与丢失(LOST)的保留 `SCHEDULER_FAILED_RUN_RETENTION_DAYS`(默认 365)天;每个
  任务至少留 `SCHEDULER_RUN_KEEP_MIN`(默认 20)条;卡死的 RUNNING 超过任务的 max_runtime、
  或 PENDING 超过 `SCHEDULER_PENDING_GRACE_SECONDS`(默认 900)没被取走,都由每 5 分钟的
  `scheduler.reap_stale_runs` 标成 LOST;worker 重启时它名下遗留的 RUNNING 也标 LOST。
- 审计日志(`AuditLog`)默认保留 `AUDIT_LOG_RETENTION_DAYS`(默认 365)天,登录日志(`LoginLog`)保留
  `LOGIN_LOG_RETENTION_DAYS`(默认 180)天,由定时清理任务按租户删除过期行。设为 `0`(或留空)表示
  不清理;**升级到这个默认值后第一轮清理会删掉早于窗口的旧行**,要保留更久先在环境里设大或设 0。
- **beat 只能起一个实例。** 两个 beat 读同一张调度表，会把每个任务派发两次。compose 里 `celery-beat`
  只有一份，**不要** `docker compose up --scale celery-beat=2`,也不要在另一台机器上对同一个库再起 beat。
  误起了第二个时，按 (任务, 租户) 的单飞锁只挡得住**时间重叠**的那次(记成 SKIPPED);
  跑得快的任务在第二次派发到达前已经结束，仍会执行两次。锁是兜底，不是用法。
  需要 beat 高可用(一台挂了另一台自动接手)时，再换 `celery-redbeat` 这类带分布式锁的调度器。
  `celery-beat` 的命令写明 `--scheduler django_celery_beat.schedulers:DatabaseScheduler`(与 settings 一致);
  `backend/tests/test_one_beat_on_the_database_scheduler.py` 守着每个 compose 组合里恰好一个 beat、
  它在 DatabaseScheduler 上、worker 没带 `-B`。
- **healthcheck(2026-10-30 起)**:`celery`(worker)用 `celery inspect ping` 探自己;`celery-beat` 用
  `python -m apps.scheduler.beat_guard`,本容器持有单 beat 锁(Redis 键,20 秒续一次、60 秒过期)才健康 ——
  被第二个 beat 抢了锁、或 Redis 不通,都转 unhealthy。compose 不会因 unhealthy 自动重启,外部监控盯
  `docker inspect --format '{{.State.Health.Status}}'`,与 certbot / backup 同一种接法。
- **上线联调清单**:`$DC up -d backend celery celery-beat` 之后 ——
  1. `$DC ps` 三个都是 healthy(beat 的 start_period 60 秒);
  2. `$DC logs celery-beat` 里有 `DatabaseScheduler` 且没有 `refusing to start a second one`;
  3. `$DC exec backend python manage.py post_deploy` 打印 `beat: DatabaseScheduler configured; running as …`;
  4. `/scheduler` 里随便手动运行一个全局任务,执行记录出现 SUCCESS(证明 worker 收得到);
  5. 等过一个 `*/5` 周期,`/health/detailed/` 的 `scheduler` 不是 `"overdue"`;配了 `SENTRY_DSN` 的话 Sentry Crons 出现报到。
- **beat 挂了怎么发现:** `GET /health/detailed/`(ADMIN)在有任务「该跑却没跑」
  (超过 cron 应触发时间 `SCHEDULER_OVERDUE_GRACE_SECONDS`,默认 600 秒)时,
  `scheduler` 字段为 `"overdue"`、`scheduler_overdue` 列出任务名;**状态码仍是 200、
  `status` 仍是 `"ok"`** —— 503 留给数据库/Redis 故障(那是这个进程自己的问题),
  beat 没跑是另一个容器的问题,探针要读 `scheduler` 字段而不是状态码。
  不要只靠站内通知 —— 发通知的检测任务自己也是 beat 派发的。设置了 `SENTRY_DSN` 时,
  每个 beat 派发的任务同时向 Sentry Crons 报到(`CeleryIntegration(monitor_beat_tasks=True)`)。
- 执行状态与调度变更通过既有 WebSocket 管道推送(domain `scheduler`,权限门
  `scheduler.read`;租户行只进该租户分组,全局行只到 ADMIN)。

## 帖子图片(nginx 发文件)

- `docker-compose.production.yml` 给 backend 设了 `POST_MEDIA_X_ACCEL: "true"`:后端验完签名与可见性后
  只回 `X-Accel-Redirect: /protected-media/…`,由 `nginx.conf` 里 `internal` 的 `/protected-media/`
  location 从 `/var/www/media/private/` 发文件。外部直接请求这个前缀是 404。
- **只有前面真有这份 nginx 时才能打开。** 没有 nginx 的环境(DEBUG、staging)保持默认 `False`,
  由 Django 自己流文件;误开了,图片全是空响应。
- 改 `nginx.conf` 的这个 location 时**不要**加 `add_header` / `expires`,否则 server 级的安全头
  在这个 location 里全部失效(注释里写了原因)。

## 权限配置「覆盖」导入

- `PERM_IMPORT_OVERWRITE_ENABLED`(默认 `False`)。权限配置不分殿、是全局的,「覆盖」导入改的是所有殿的权限。
  2026-10-29 起导入(连同权限页的一切写操作)只许**没绑殿的** ADMIN(`CanWriteGlobalSettings`,`apps/perm/views.py`),
  绑殿的 ADMIN 403。覆盖仍默认关闭 —— `POST /perm/import/` 收到 `overwrite=true`(预演也算)一律回 403
  `overwrite_disabled`,不碰任何行;合并导入与预演不受影响。有了跨殿的超级管理员角色之后再打开。
  接口响应里的 `overwrite_enabled` 告诉前端要不要显示「合并 / 覆盖」的选择。

## 邮件(找回密码验证码、官员重置链接、邮箱验证)

- 发信的有三处:找回密码的验证码、官员密码重置邮件(`/auth/officer-reset/*`,链接用 `DESK_URL` 拼:
  `DESK_URL` 落到默认的 `http://localhost:3000` 时链接指向收件人自己的电脑)、邮箱验证(`/auth/email/*`)。
  非 DEBUG 时走 SMTP,变量:`EMAIL_HOST`、`EMAIL_PORT`(默认 25)、
  `EMAIL_HOST_USER`、`EMAIL_HOST_PASSWORD`、`EMAIL_USE_TLS` / `EMAIL_USE_SSL`、`EMAIL_TIMEOUT`(默认 10 秒)、
  `DEFAULT_FROM_EMAIL`(其中除 `EMAIL_TIMEOUT` 外都在 `x-django-env` 里,见开头的传参说明)。
- 没配 `EMAIL_HOST` 只在启动时告警,不拒绝启动。除找回密码外一切照常;找回密码接口无论发没发出去
  都回同一个响应(不让它变成「这个邮箱注册过没有」的探针),所以**发信失败不会在界面上显出来**,
  上线后要真发一次验证。
- **必须有 celery worker 在跑,否则这些邮件不发(2026-10-30 起)。** 找回密码验证码、灵魂改联系邮箱的验证码与改后通知、
  灵魂初始密码都改成「业务提交后入队 celery 任务,worker 发信」(`apps/authentication/tasks.py`、`apps/soul_accounts/tasks.py`)。
  消息里只有 id 或随机 token,验证码与明文不进 broker。只有 **broker 连不上**(入队抛错)时才就地发;broker 在、worker 不在,
  任务就躺在队列里:找回密码那条在缓存里只留 5 分钟,过期即作废;初始密码那行停在待交付,官员可在界面上「重试」(同步发)。
  上线后看 `/metrics/` 的 `soulledger_celery_queue_length`,真发一封找回密码验证码确认收到。

## 灵魂端推送(Expo Push Service)

- 后端把推送交给 Expo(`https://exp.host/--/api/v2/push/send`),Expo 转 APNs / FCM。
  **APNs 密钥与 FCM 凭据配在 Expo(EAS)项目上,不在本后端**;没有它们,真机收不到,但后端流程不受影响。
- 环境变量(backend 与 celery worker 都要有):
  - `SOUL_PUSH_ENABLED`(默认 `False`)。**不打开时**事件照常记录成投递行(`soul_push_pushdelivery`),
    状态标 `DISABLED`(「推送未启用」),不访问 Expo、不报错。**打开并重启后,下一次 `soul_push.sweep`
    (≤5 分钟)补发 `created_at` 在 24 小时内的 `DISABLED` 行**(补发前照常核对设备、归属、账号未停用、偏好仍开;
    补的是原行,不会重复),更早的标 `EXPIRED`(不删)。beat 没跑就不会补发。
  - `EXPO_ACCESS_TOKEN`(可选)。只有在 Expo 控制台开启「增强推送安全」后才必需;设置了就随每个请求
    带 `Authorization: Bearer …`。开启增强安全却没设,Expo 整请求报 `UNAUTHORIZED`,投递记为 `FAILED`。
  - `SOUL_PUSH_SENDER`(默认 `apps.soul_push.expo.ExpoPushSender`)。发送端口的类路径,一般不改。
- 出站:worker 要能访问 `exp.host:443`。
- 定时任务 `soul_push.sweep`(每 5 分钟,全局)随 `setup_scheduled_tasks` 自动建行:
  把入队失败或 worker 崩掉而停在 `QUEUED` / `SENDING` 的投递重新入队;对发出满 15 分钟的查回执,
  `DeviceNotRegistered` 的设备置无效。**beat 没跑时回执不会被检查**,但首次发送不依赖它(提交后直接入队)。
- 排查:按状态看 `soul_push_pushdelivery.status` 与 `error`。`FAILED` + `DeviceNotRegistered` 是 App 被卸载或
  token 失效,属正常;成片 `FAILED` + `HTTP 4xx` / `UNAUTHORIZED` 看上面的访问令牌;`QUEUED` 堆积看 worker 与 beat。

## 判决文书 PDF(Gotenberg)

审判页判决文书上的「下载 PDF」直接下载一个真 PDF(2026-11-07)。地府文书竖排(`writing-mode: vertical-rl`),
后端排版库排不对,所以 PDF 由无头 Chromium 打开**前端那一份文书**出:同一个 `VerdictPaper`、同一份
`verdict-doc.css` / `print.css`(`@page verdict`,A4)、同一批自托管字体。「打印」照旧走浏览器打印。

- 服务:compose 的 `gotenberg`(`gotenberg/gotenberg:8.20.1`,Apache-2.0,**不发布端口**)。命令行只许 Chromium
  打开 `http://frontend:3000/…`(`--chromium-allow-list`),LibreOffice 路由关掉。production 限 1 GB 内存。
  镜像约 1.5 GB(含 Chromium 与 LibreOffice;以 `docker image ls` 为准)。
- 一次下载的路径(全在 compose 网络里,细节在 `backend/apps/judgment/verdict_pdf.py` 文件头):
  1. 浏览器 `GET /api/v1/judgment/{id}/verdict-document.pdf/?locale=…`:与判决详情同一个权限(`judgment.read`)、
     同一个租户划界;后端用详情的序列化器备好数据,放进缓存(Redis),键是 256 位随机串。
  2. 后端把 `http://frontend:3000/verdict-print?key=…` 交给 gotenberg。
  3. 前端那一页在**服务端**用键向 `http://backend:8000/api/v1/judgment/verdict-print/<键>/` 取数据,渲染文书;
     字体到齐后 gotenberg 出 PDF。PDF 出完即删缓存里的那份数据。这条取数据的路径 nginx 对外一律 403。
- 环境变量:
  - backend:`VERDICT_PDF_RENDERER_URL`(compose 里是 `http://gotenberg:3000`)、`VERDICT_PDF_FRONTEND_URL`
    (`http://frontend:3000`)。**任一项为空就是关着**:接口答 503 `verdict_pdf_not_configured`,网页提示一句后退回浏览器打印。
    `VERDICT_PDF_TIMEOUT_SECONDS`(默认 30)、`VERDICT_PDF_TOKEN_TTL_SECONDS`(默认 120)一般不改。
  - frontend(运行时,不是构建参数):`VERDICT_PRINT_API_URL`(compose 里是 `http://backend:8000/api/v1`)。
  - **`ALLOWED_HOSTS` 要含 `backend`**:前端的服务端按 `Host: backend:8000` 访问后端(书信推送回调同样要它)。
    没加的话取数据 400 `DisallowedHost`,下载退回浏览器打印。
- 部署:`docker compose -f docker-compose.yml -f docker-compose.production.yml pull gotenberg`,
  再 `up -d gotenberg backend frontend`(后端与前端要拿到新的环境变量)。验:登录后在一件已结的案子上点「下载 PDF」,
  得到以案号命名的 `.pdf`;或在主机上 `docker compose exec backend python -c "import requests; print(requests.get('http://gotenberg:3000/health').status_code)"`。
- 接口的错误码:没结案 409 `judgment_not_concluded`;结了但没有文书(重审,或不是四文明之一)404 `no_verdict_document`;
  gotenberg 连不上、超时、或没给回 PDF 503 `verdict_pdf_unavailable`(gotenberg 的日志里有原因,常见的是打印页 404 —— 看
  `VERDICT_PRINT_API_URL` 与 `ALLOWED_HOSTS`)。
- 演示站(`NEXT_PUBLIC_DEMO_MODE=1`)没有后端,「下载 PDF」仍是浏览器打印。
- 集成测试 `backend/tests/test_verdict_document_pdf.py::test_gotenberg_renders_the_real_print_page` 只在设了
  `VERDICT_PDF_RENDERER_URL` 与 `VERDICT_PDF_FRONTEND_URL` 时跑,条件写在它的 skip 原因里;门禁容器里没有这个服务,其余测试都换掉了渲染调用。

## 灵魂聊天(Matrix / Synapse)

- 单 Synapse homeserver(不联邦)。compose 的 `synapse` 服务(`matrixdotorg/synapse:v1.161.0`,
  **不发布端口**)+ `nginx.conf` 的 `/_matrix`、`/_synapse/client` 反代;`/_synapse/admin` 在 nginx
  上一律 403,admin API 只有 compose 网络里的后端够得着(`MATRIX_INTERNAL_URL=http://synapse:8008`)。
  联邦接口 `/_matrix/federation`、`/_matrix/key` 在 nginx 上也一律 403:不联邦(模板里
  `federation_domain_whitelist: []`,不与任何服务器互通),App 只用 `/_matrix/client`(媒体也在其下),
  这两个前缀没有任何客户端要用,关掉只是少暴露一块用不上的面。
  nginx 按请求解析 synapse(resolver),synapse 没起或在重启时只有这两条路径 502,不连累全站。
- 数据库:同一个 `db` 实例里单独一个 `synapse` 库(Synapse 要求 `LC_COLLATE`/`LC_CTYPE` 为 `C`,
  由初始化脚本从 `template0` 建),用单独的 `synapse` 账号(只拥有 `synapse` 库;非超级用户、不能建库建角色;
  脚本同时收回 PUBLIC 对 `soulledger`、`synapse` 两库的 CONNECT,所以它连不进主库)、直连 `db` 不经 pgbouncer(pgbouncer 只配了 `soulledger` 库;
  Synapse 自带连接池)。**不用 SQLite**:Synapse 官方只把它当试用,
  单写锁在灵魂数上来后顶不住,且 SQLite → PostgreSQL 迁移要停机跑 `synapse_port_db`。
  聊天消息(`synapse` 库)与 `synapse_data` 卷(签名密钥、聊天媒体)在每日备份里,见下面
  「聊天(Synapse)备份与恢复」。
- homeserver.yaml 含密钥,不进仓库,在 `synapse_data` 卷里,由 `scripts/synapse-init.sh` 生成:
  `generate` 的产物 − 与模板重复的顶层键(`registration_shared_secret` 等)− SQLite 的 `database` 段
  \+ PostgreSQL 的 `database` 与 `public_baseurl` + `config/synapse/homeserver.soulledger.yaml`
  (`${…}` 换成与后端相同的值)。模块 `config/synapse/soulledger_policy.py` 只读挂到 `/modules` 并放进
  `PYTHONPATH`:除服务账号外不能建房、邀请、建别名、发布房间,并在节流房间里只放行后端签过一次性凭据的
  那条私聊请求 —— **少了它,灵魂拿自己的 token 就能绕过全部聊天规则**。模块把用过的凭据记在进程内存里:
  Synapse 单进程部署;拆 worker 前先把它换成共享存储。
- 根 `.env` 的变量(backend、celery、celery-beat 与 synapse 都从这里取,见 `docker-compose.yml`):
  `MATRIX_ENABLED`(默认 `False`,关着时 `/me/chat/` 与 `/chat/inbox/` 一律 503)、
  `MATRIX_PUBLIC_BASEURL`(App → Synapse,即经 nginx 的公开地址,如 `https://example.com/`;
  也写进 homeserver 的 `public_baseurl`)、`MATRIX_SERVER_NAME`(**定了不能改**,它在每个 mxid 里)、
  `MATRIX_JWT_SECRET`(= Synapse `jwt_config.secret`,≥32 字节,**只用于登录**)、
  `MATRIX_GRANT_SECRET`(= 模块配置 `grant_secret`,节流私聊请求的一次性发言凭据,≥32 字节)、
  `MATRIX_HOOK_SECRET`(= 模块配置 `hook_secret`,新消息回调的签名,≥32 字节)——三把**互不相同**
  (审计 2026-11-11 A2-07:共用一把时,任一处副本泄漏就既能冒任何灵魂登录、又能伪造回调)。
  **过渡**:后两项没设时退回 `MATRIX_JWT_SECRET`,后端启动日志与 `scripts/synapse-init.sh` 各打一条警告
  (模块配置里没写 `hook_secret` 时 Synapse 启动日志也有一条,回调改用 `grant_secret` 签),功能照常;
  **上线前必须分别设置**,后端 `.env` 与 homeserver.yaml 的模块配置两边同值。
  `scripts/check-deploy-env.sh` 对没设的给 WARN,与 `MATRIX_JWT_SECRET` 相同的给 FAIL。另有
  `MATRIX_REGISTRATION_SHARED_SECRET`(= Synapse `registration_shared_secret`,只用来把服务账号
  注册成 admin 一次)、`MATRIX_USER_SALT`(mxid 由账号 id 经 HMAC 派生;**不可轮换**,换了所有 mxid
  都变)。`MATRIX_INTERNAL_URL` 在 compose 里写死为 `http://synapse:8008`;
  `CHAT_REQUEST_INTERVAL_SECONDS` 用默认(86400)。`SYNAPSE_DB_PASSWORD` 是 `synapse` 库账号的密码,
  只有 synapse 服务读(脚本用它建角色并写进 homeserver.yaml;角色已存在时脚本**不改密码** ——
  要换密码,在 db 里 `ALTER ROLE synapse PASSWORD …` 并同步改卷里 homeserver.yaml 的 `database.args.password`)。
- **新书信推送(Synapse → 后端回调)**:模块配置里的 `push_url`(模板里是 `${MATRIX_PUSH_HOOK_URL}`),指向后端
  `http://<后端内网地址>/api/v1/chat/hooks/new-message/`(容器网络内,不经 nginx、不对外暴露)。
  每条 `m.room.message` 落库之后,模块在后台进程里 POST `{room_id, event_id, sender, ts, mac}`;
  `mac` 用 `hook_secret`(= `MATRIX_HOOK_SECRET`;模块里没写 `hook_secret` 时退回 `grant_secret`)签,后端 `apps/chat/hook.py` 验签、限 5 分钟时间窗,
  不认令牌。后端按会话定收件人(那一世的本世账号;官员回信推给灵魂,灵魂写给殿司的不推),
  按收件人的「书信」偏好(`PushPreference.chat`)记推送,走 soul_push 的同一条发送 / 补发 / 回执路径
  (`SOUL_PUSH_ENABLED` 关着时照常记为 DISABLED)。**回调失败不影响消息本身**:Synapse 在落库之后才调,
  模块吞掉异常只记 warning;漏掉的那条不补推。不配 `push_url` 就不回调。
  **`push_url` 的主机名要在后端 `ALLOWED_HOSTS` 里**(例如 `backend`),否则 Django 对回调答 400、
  一条都推不出去,而消息照常收发 —— 故障是静默的,只在 Synapse 日志里有 `新消息回调失败 … 400`
  (2026-09-19 对真 Synapse v1.161.0 实测撞到)。
  改了模块文件要**重启 Synapse**(模块在启动时装载)。
- 限速:模板把 `rc_login.address` 放宽了 —— 后端代灵魂发言要以该灵魂身份 JWT 登录,所有这类登录
  都来自后端一个地址,默认值下突发用完即 429。服务账号替灵魂转发、改 power level、建房,量随灵魂数
  增长,由下面第 4 步免限速。

**首次部署(一次):**

```bash
# 0. 根 .env 里填好上面的 MATRIX_* 与 SYNAPSE_DB_PASSWORD(MATRIX_ENABLED 先留 False)
# 1. 建 synapse 角色与库 + 生成并合并 homeserver.yaml。幂等:已有的角色 / 库 / 文件 / 合并都跳过,永不覆盖
DC="$DC" scripts/synapse-init.sh
# 2. 起 Synapse 与 nginx
$DC up -d --wait synapse
$DC up -d nginx
# 3. 打开聊天:.env 里 MATRIX_ENABLED=True,然后
$DC up -d backend celery celery-beat
# 4. 服务账号注册成 admin(已有则 JWT 登录)并免限速。幂等,重跑无害
$DC exec backend python manage.py setup_matrix
# 5. 验证:经 nginx 客户端 API 200,admin 与联邦接口 403
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/_matrix/client/versions      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/_synapse/admin/v1/register   # 403
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/_matrix/federation/v1/version # 403
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/_matrix/key/v2/server        # 403
```

  改 homeserver 的值:编辑 `synapse_data` 卷里的 `/data/homeserver.yaml` 后 `$DC restart synapse`,
  或删掉它重跑脚本(签名密钥是单独的文件,不受影响)。**改 `MATRIX_JWT_SECRET` / `MATRIX_GRANT_SECRET` / `MATRIX_HOOK_SECRET` 都要两边一起改**
  (分别对 `jwt_config.secret` / 模块 `grant_secret` / 模块 `hook_secret`),
  否则依次是:App 登录与后端代发全部 403;私聊请求被模块当作无凭据拒绝;新书信推送全部 403(消息照常收发)。
  **已部署、还在共用一把的环境**(脚本「已合并过」就不再追加模板,所以要手改):根 `.env` 加
  `MATRIX_GRANT_SECRET` 与 `MATRIX_HOOK_SECRET`(各自 `python -c "import secrets; print(secrets.token_urlsafe(48))"`),
  卷里 `/data/homeserver.yaml` 的 `modules` → `SoulLedgerPolicy` → `config` 下把 `grant_secret` 换成新的
  `MATRIX_GRANT_SECRET`、加一行 `hook_secret: "<MATRIX_HOOK_SECRET>"`;然后 `$DC restart synapse`、
  `$DC up -d backend celery celery-beat`。先重启哪边都会有几秒对不上(私聊请求或推送 403),对齐后自愈,消息不丢。
- 2026-09-19 本机实跑过上面这套(synapse + 临时 postgres + nginx,端口只绑 127.0.0.1):脚本两次运行
  第二次全部跳过;`/_matrix/client/versions` 经 nginx 200,`/_synapse/admin/*` 经 nginx 403;
  `setup_matrix` 两次均成功(第二次走「已注册 → JWT 登录」);`test_chat_synapse_integration.py`
  2 passed。停掉 synapse 时 nginx 在、这两条路径 502。
- 实机验证:`backend/tests/test_chat_synapse_integration.py` 文件头有本机起一个 Synapse 跑它的命令。
- **已有一台用 SQLite 的 Synapse**:一次性迁移脚本 `scripts/synapse-migrate-sqlite-to-pg.sh`(官方 `synapse_port_db`,
  server_name 与签名密钥不动;2026-09-19 演练过)已在测试机上用完,2026-11-21 删除,见 git 历史。

## 数据库备份与恢复

- `backup` 服务启动时先备份一次(失败则容器退出、在 `$DC ps` 里反复重启),之后每天
  02:00 由 cron 执行 `scripts/backup-db.sh`,输出进 `$DC logs backup`,文件在主机的
  `./backups/`。最新一份合格备份超过 26 小时,它的 healthcheck 转 unhealthy。
- 恢复只能进**空库**:dump 不带 `--clean`,对已有表的库执行会在第一条 `CREATE TABLE`
  失败 —— `scripts/restore-db.sh` 用单事务 + `ON_ERROR_STOP`,失败即整体回滚、非零退出。

  ```bash
  $DC stop backend celery celery-beat pgbouncer   # 断开所有到库的连接
  $DC exec db dropdb -U soulledger soulledger
  $DC exec db createdb -U soulledger -O soulledger soulledger
  $DC run --rm --no-deps --entrypoint bash backup \
    /scripts/restore-db.sh /backups/soulledger_YYYYMMDD_HHMMSS.sql.gz
  $DC start pgbouncer backend celery celery-beat
  ```

  2026-09-14 在生产合并上实跑过 dropdb / createdb / restore 这三步(只起 db 与 backup):
  非空库上恢复 → `restore FAILED and was rolled back`;重建空库后 → `Restore complete.`,
  行数与备份前一致。

### 媒体(头像)备份与恢复

- 同一个 `backup` 服务、同一轮 cron、同一份 `RETENTION_DAYS`:`backup-db.sh` 在
  db dump 之后把只读挂进来的 `media_files` 卷(`/media`)打包成
  `soulledger_media_<timestamp>.tar.gz`,失败(打包或校验)非零退出、不留 `.partial`
  文件,和 db dump 的失败语义一致。healthcheck 现在同时要求 db 与 media 两份备份
  都在 26 小时以内,任一过期都转 unhealthy。
- 恢复(先按上面的步骤停 backend,避免边写边解包):

  ```bash
  docker run --rm \
    -v "$(docker volume ls -q --filter name=media_files)":/media \
    -v "$(pwd)/backups:/backups:ro" \
    alpine sh -c "rm -rf /media/* && tar xzf /backups/soulledger_media_YYYYMMDD_HHMMSS.tar.gz -C /media"
  $DC start pgbouncer backend celery celery-beat
  ```

### 聊天(Synapse)备份与恢复

- 同一个 `backup` 服务、同一轮 cron、同一份 `RETENTION_DAYS`。`synapse_data` 卷只读挂在
  `/synapse`;卷里有 `homeserver.yaml`(聊天已初始化)时,`backup-db.sh` 在 db 与 media 之后再出两份:
  - `soulledger_synapse_<timestamp>.dump`:`synapse` 库,`pg_dump -Fc`(自定义格式,
    写完先 `pg_restore --list` 校验再改名);
  - `soulledger_synapse_data_<timestamp>.tar.gz`:整个卷 —— **签名密钥**(丢了等于换了一台
    homeserver)、`homeserver.yaml`(含密钥)与聊天媒体 `media_store/`。
  失败语义与 db dump 一致(非零退出、不留 `.partial`)。聊天没初始化时两份都跳过并打印一行,
  healthcheck 也不要求它们;初始化了,healthcheck 就同样要求这两份在 26 小时以内。
- 恢复(同一台机器,或新机器上 `synapse_data` 卷还是空的):

  ```bash
  $DC stop synapse
  $DC exec db dropdb -U soulledger --if-exists synapse
  # 卷(签名密钥 / homeserver.yaml / 媒体)。只丢了库时可以跳过这一步
  docker run --rm \
    -v "$(docker volume ls -q --filter name=synapse_data)":/data \
    -v "$(pwd)/backups:/backups:ro" \
    alpine sh -c "rm -rf /data/* && tar xzf /backups/soulledger_synapse_data_YYYYMMDD_HHMMSS.tar.gz -C /data"
  # 建 synapse 角色与空库(已在的跳过;卷里已有 homeserver.yaml,generate 与合并也跳过)
  DC="$DC" scripts/synapse-init.sh
  $DC run --rm --no-deps -T --entrypoint pg_restore backup \
    --no-owner --role=synapse -d synapse --single-transaction --exit-on-error \
    /backups/soulledger_synapse_YYYYMMDD_HHMMSS.dump
  $DC start synapse
  ```

  `--role=synapse`:恢复出来的表归 `synapse` 角色,而不是执行恢复的 `soulledger`。
  2026-09-19 本机实跑过这一套(备份 → stop → dropdb → 卷恢复 → init → pg_restore → start):
  各步 exit 0,服务账号 `@soulledger:…` 与 admin 标记都在,`public` 下没有不属 `synapse` 的表,
  签名密钥前后 sha 相同,`/_matrix/client/versions` 经 nginx 200。

### 备份异地副本与告警(2026-10-30)

`backup` 服务用 `postgres:16-alpine`,不是库用的 `pgvector/pgvector:pg16`:它的命令要 busybox `crond`,
而 Debian 版的 pgvector 镜像里没有(`2cb14da8` 把两者一起换了,于是每日 cron 从没起来,容器在首次备份后反复重启)。
`pg_dump` 不需要服务端扩展,dump 里的 `CREATE EXTENSION vector` 在恢复时由库执行。

根 `.env` 里可设(都可不设,不设时脚本**打印一行**说明而不是静默):

| 变量 | 作用 | 默认 |
|------|------|------|
| `BACKUP_RETENTION_DAYS` | 本机 `./backups/` 保留天数 | 30 |
| `BACKUP_OFFSITE_REMOTE` | rclone 目标(`s3:bucket/soulledger`、`sftp-box:/srv/sl-backups`…)。设了就在每次备份后 `rclone copy`;启动时自动 `apk add rclone` | 不设 = 无异地副本 |
| `BACKUP_OFFSITE_RETENTION_DAYS` | 异地超过这么多天的 `soulledger_*` 被 `rclone delete --min-age` 删掉;`0` = 永不删(交给对象存储的生命周期规则) | 90 |
| `OPS_ALERT_WEBHOOK_URL` | 告警出口。备份 / 恢复演练失败、定时任务首次失败与逾期都 POST `{"text": …, "content": …}`(Slack / Mattermost 读 `text`,Discord 读 `content`) | 不设 = 只打印 / 只站内通知 |

- **异地目标还没定**(用户 2026-10-30:先不定)。没设 `BACKUP_OFFSITE_REMOTE` 时备份只在本机 `./backups/`,机器坏了备份一起坏。
- rclone 的远端配置放在 compose 目录的 `./rclone/rclone.conf`(只读挂进容器,已在 `.gitignore`),
  或者用 `RCLONE_CONFIG_<名字>_*` 环境变量。**是 copy 不是 sync**:本机卷被清空后下一次备份不会把异地也清空。
- 异地失败时本机备份照样留着,脚本非零退出并告警;healthcheck 只看本机文件,所以异地失败**只靠告警**被看见。
- 定时任务那一侧:`apps/scheduler/services.py::ops_alert`,在站内通知之外 POST 同一个地址,每个失败 / 逾期回合一次;
  backend / celery 经 `x-django-env` 收到这个变量。`post_deploy` 在它为空时警告一行。
- 验:`$DC run --rm --no-deps backup /scripts/backup-db.sh /backups`,看末尾 `Off-site copy complete.`;
  把 `BACKUP_OFFSITE_REMOTE` 临时改成不存在的远端再跑一次,应退出 1 并在 webhook 收到 `backup-db.sh FAILED`。

### 备份加密(2026-10-31)

- `BACKUP_AGE_RECIPIENT` 设成一把 [age](https://age-encryption.org) 公钥(`age1…`,或一行 `ssh-ed25519 …`)后,
  每份备份写完再生成一份 `<文件名>.age`,**异地只传 `.age`**;容器启动时自动 `apk add age`。本机 `./backups/` 里的明文照留
  (它和被 dump 的库在同一块盘上,加密它挡不住拿到这块盘的人),保留天数同样适用于 `.age`。
- 设了 `BACKUP_OFFSITE_REMOTE` 而没设 `BACKUP_AGE_RECIPIENT`:**拒绝异地复制**,脚本退出 3 并告警;
  确实要传明文才设 `ALLOW_PLAINTEXT_OFFSITE=1`(每次打印一行 `copying UNENCRYPTED backups off-site`)。
- 生成密钥(在你自己的电脑上,不在服务器上):`age-keygen -o soulledger-backup.key`,把输出的 `Public key: age1…`
  填进 `BACKUP_AGE_RECIPIENT`。**私钥文件不放在这台服务器上**,放进密码管理器;恢复演练用它
  (`BACKUP_AGE_IDENTITY=<私钥文件>`)证明异地那份解得开。
- **这些值不在任何备份里,必须另存(密码管理器),而且和备份分开放**:
  `ENCRYPTION_KEY` 与 `ENCRYPTION_KEY_FALLBACKS`(丢了,库里的加密字段永久解不开 —— 备份恢复得出来,那些列也只是乱码)、
  `SECRET_KEY` 与 `SECRET_KEY_FALLBACKS`(丢了,全部会话、JWT、密码重置链接、签名的媒体网址作废)、
  `BACKUP_AGE_IDENTITY` 对应的 age 私钥(丢了,异地备份全部解不开)、`MATRIX_*` 全部与 `SYNAPSE_DB_PASSWORD`、`DB_PASSWORD`、`REDIS_PASSWORD`。
  整份根 `.env` 存一份进密码管理器最省事;每次轮换(本文「密钥轮换」)之后更新那一份。

### 恢复演练

`scripts/restore-drill.sh` 把**最新一份** db 备份恢复进同一台库上的临时库 `soulledger_drill_<pid>`,
与线上库比对后删掉(成功、失败都删;`DRILL_KEEP=1` 保留);2026-10-31 起同一次演练也恢复媒体与聊天,
全部恢复到临时位置(`mktemp` 目录、`*_drill_<pid>` 临时库),**不碰线上的卷和库**:

```bash
$DC run --rm --no-deps --entrypoint bash backup /scripts/restore-drill.sh /backups
```

- 线上库只读。比对两项,任一不符即退出 1 并告警:线上有的表恢复出来都要有;线上 `django_migrations` 的每一行
  恢复出来都要有(等于对线上代码问一次 `migrate --check` —— 备份之后又部署过带迁移的版本时这一项会红,那是对的:
  那份备份恢复后要再 `migrate`)。另打印两边逐表行数与合计、以及恢复耗时(RTO 里实测的那一段)。
- 要用 Django 自己的 `migrate --check` 再核一次:`DRILL_KEEP=1` 跑完,
  `$DC run --rm --no-deps -e DATABASE_URL=postgres://soulledger:<密码>@db:5432/soulledger_drill_<pid> backend python manage.py migrate --check`,
  然后 `$DC exec db dropdb -U soulledger soulledger_drill_<pid>`。
- 媒体:最新的 `soulledger_media_*.tar.gz` 必须存在并能解包,打印文件数(在 `backup` 容器里另打印线上 `/media` 的文件数)。
- 聊天(有 Synapse 备份,或 `/synapse/homeserver.yaml` 在):最新的 `soulledger_synapse_<ts>.dump` 用 `pg_restore` 恢复进
  `synapse_drill_<pid>`(C collation,Synapse 要求),打印 users / events / rooms 行数;`soulledger_synapse_data_*.tar.gz`
  解包后必须有 `homeserver.yaml` 与 ed25519 的 `*.signing.key`,而且**和线上那把逐字节相同**(签名密钥变了,对所有客户端就是另一台 homeserver)。
  聊天在用而两份备份缺一份 → 退出 1。
- `BACKUP_AGE_IDENTITY=<age 私钥文件>`:改为挑最新的 `*.age`,先解密再做上面全部步骤 —— 证明异地那份能用。
- 建议每月一次,以及每次改了备份脚本、换了镜像之后。临时库和线上库同在一台,数据量大时先看磁盘余量(约等于线上库大小)。

**在另一台机器上演练**(证明「这台机器整个没了」也恢复得出来;每季度一次):

```bash
# 演练机上:取异地副本(只读),起一个一次性的库(要 pgvector,dump 里有 CREATE EXTENSION vector)
rclone copy <BACKUP_OFFSITE_REMOTE> ./drill-backups --max-age 2d
docker network create sl-drill
docker run -d --rm --name sl-drill-pg --network sl-drill -e POSTGRES_USER=soulledger -e POSTGRES_PASSWORD=drill pgvector/pgvector:pg16
# 演练(私钥从密码管理器取出放到 ./drill.key,演练完删掉)
docker run --rm --network sl-drill -v "$PWD/drill-backups:/backups:ro" -v "$PWD/scripts:/scripts:ro" -v "$PWD/drill.key:/drill.key:ro" \
  -e PGHOST=sl-drill-pg -e PGUSER=soulledger -e PGPASSWORD=drill -e PGDATABASE=postgres \
  -e DRILL_STANDALONE=1 -e BACKUP_AGE_IDENTITY=/drill.key \
  postgres:16-alpine sh -c 'apk add --no-cache bash age >/dev/null && bash /scripts/restore-drill.sh /backups'
docker stop sl-drill-pg; docker network rm sl-drill; rm -f drill.key
```

`DRILL_STANDALONE=1`:那里没有线上库可比,只核对「恢复得进去、有迁移记录」并打印各表行数。

### RPO / RTO

目标(现在没有生产;**用户 2026-10-30 接受 RPO 24 小时 / RTO 2 小时**作为上线时的目标):

| | 目标 | 依据 |
|--|------|------|
| RPO(最多丢多久的数据) | **24 小时** | 每天 02:00 一份全量 dump;healthcheck 在最新一份超过 26 小时时转 unhealthy |
| RTO(多久恢复服务) | **2 小时** | 停服务 + dropdb/createdb + 恢复(演练脚本打印实测耗时)+ 起服务 + 冒烟;媒体与聊天卷另计解包时间 |

RPO 要比 24 小时更短,做法是 **WAL 归档 + 时间点恢复(PITR)**,这里只写做法,**现在不配,上线前再配**(用户 2026-10-30 定)。
2026-10-31 复核仍不放进 compose:只开 `archive_mode` 把 WAL `cp` 到备份卷不构成 PITR —— 还要定期基础备份
(`pg_dump` 不能接 WAL)、按最老基础备份清 WAL、WAL 异地(否则和库同盘同坏),而 `archive_command` 一旦失败 WAL 会
堆在 `pg_wal` 直到磁盘满、库停;这几样没有真服务器验不了,装一半比不装更危险。做法:

1. `db` 服务加 `command: postgres -c wal_level=replica -c archive_mode=on -c archive_timeout=300 -c archive_command='…'`,
   `archive_command` 把每段 WAL 送到异地(用 WAL-G / pgBackRest 之类的工具,不要手写 `cp`:要处理失败重试与校验)。
   `archive_timeout=300` 让空闲时也最多 5 分钟切一段,RPO 约为 5 分钟。
2. 每天(或每周)一次**基础备份**(`pg_basebackup` 或工具自带的 `backup-push`),保留到最老一份基础备份之后的 WAL。
3. 恢复:新数据目录放基础备份,`postgresql.conf` 设 `restore_command`(从异地取 WAL)与 `recovery_target_time='<出事前一刻>'`,
   建 `recovery.signal` 后启动;到达目标后 `pg_wal_replay_resume()` 或按 `recovery_target_action=promote` 提升。
4. 演练同样要做:把基础备份 + WAL 恢复到临时实例,核对到目标时间点的最后一笔业务在、之后的不在。
5. 每日 `pg_dump` 照留:它是逻辑备份,跨大版本、挑单表恢复都靠它;PITR 不替代它。

## 部署回滚

backend / celery / celery-beat 共用本机构建的 `soulledger-backend` 镜像,启动命令里会先跑 `migrate`。
**所以「回滚镜像」与「回滚数据库」是两件事。**

1. **部署前**给当前镜像打一个可回退的标签,并做一次备份:

   ```bash
   docker tag soulledger-backend soulledger-backend:prev-$(git rev-parse --short HEAD)
   $DC run --rm --no-deps backup /scripts/backup-db.sh /backups
   $DC exec backend python manage.py showmigrations --plan | grep '\[ \]'   # 这次要跑的迁移
   ```

2. **新版本不带迁移,或带的迁移都可逆**:回退镜像即可。
   - 有迁移时先在新镜像里把它们倒回到旧版本的最后一条:
     `$DC exec backend python manage.py migrate <app> <旧版本该 app 的最后一个迁移名>`(每个有新迁移的 app 各一次);
   - 然后 `docker tag soulledger-backend:prev-<sha> soulledger-backend && $DC up -d backend celery celery-beat`。
   - 顺序不能反:旧镜像里没有新迁移文件,它倒不回去。
3. **带不可逆迁移**(`RunPython` 没有 reverse、`RunSQL` 没有 reverse_sql):`migrate` 倒不回去,只能**恢复部署前那份备份**
   (上面「数据库备份与恢复」的 dropdb / createdb / restore 三步),再起旧镜像。部署后写入的数据会丢,所以:
   - 发布前看 `backend/tests/irreversible_migrations.txt`:它列出全部不可逆迁移,由
     `tests/test_irreversible_migrations_are_listed.py` 钉住 —— 新加一条不可逆迁移不登记就红,所以它一定出现在发布的 diff 里。
     2026-10-30 这份清单是空的。
   - 可逆但带数据的(reverse 是 `RunPython.noop`,或 reverse 只撤回 forward 自己写的行)倒回去不报错,
     数据却不会复原;这类看迁移自己的 docstring。
4. 只回退前端不涉及数据库。前端服务没有固定的 `image:` 名(compose 按项目名命名构建产物,`docker compose images frontend` 看),
   同样在部署前 `docker tag <那个名字> <那个名字>:prev-<sha>`,回退时 tag 回去再 `$DC up -d frontend`。

## 指标与集中日志(2026-10-30)

这一节的变量都已在 `docker-compose.yml` 的 `x-django-env` 和 `.env.example` 里(2026-10-30):`LOG_FORMAT`、`METRICS_TOKEN`、
`METRICS_ALLOWED_IPS`、`SECRET_KEY_FALLBACKS`、`ENCRYPTION_KEY_FALLBACKS`、`ASSIST_USAGE_RETENTION_DAYS`(默认 730)、
`DEATH_SYNC_REQUEST_RETENTION_DAYS`(默认 90)。`LOG_FORMAT` 留空时按 `DEBUG` 决定。

- **日志格式**:`LOG_FORMAT=json` 每行一个 JSON 对象(`time` / `level` / `logger` / `message` / `trace_id` /
  `tenant` / `user_id` / `exc_info`,`backend/config/json_logging.py`),给日志采集按行解析;每个请求结束时
  `apps.access` 写一行 `http_request`,另带 `method` / `route`(路由模板,不是原始路径)/ `status` / `duration_ms`。`LOG_FORMAT=text` 是人读的一行。
  默认:`DEBUG` 关时 json,开时 text;其它取值拒绝启动。`trace_id` 就是响应头 `X-Request-ID`,
  同一请求的日志、审计行与它派发的 Celery 任务共用一个(`backend/apps/core/trace.py`)。
  采集:容器日志走 stdout/stderr,用 Docker 的日志驱动或 Promtail / Vector / Fluent Bit 收 `docker logs`,
  按 JSON 解析即可,不用改代码。
- **`/metrics/`**(Prometheus 文本格式,`backend/apps/core/metrics.py`,没有新增依赖):
  - 默认关闭(404)。`METRICS_TOKEN` 设了就认 `Authorization: Bearer <token>`;`METRICS_ALLOWED_IPS`
    (逗号分隔的地址或 CIDR,写错拒绝启动)设了就认来源地址 —— 来源地址按 `TRUSTED_PROXY_COUNT` 解析
    (`backend/apps/core/client_ip.py`),随手写的 `X-Forwarded-For` 不算。任一满足即放行,其余一律 404。
  - nginx **不转发** `/metrics/`(`location /` 指向前端)。Prometheus 在 compose 网络里直接抓 `backend:8000/metrics/`;
    这时 Host 是 `backend`,要加进 `ALLOWED_HOSTS`。生产的 HTTPS 跳转对 `/metrics/` 豁免(同 `/health/`)。
    推荐用 token:compose 网络里的来源地址会随容器重建变化。
  - 两类值:抓取时现算的 gauge;以及 counter / 直方图 —— 每个进程(daphne、每个 Celery 子进程)在内存里累加,
    满 100 个请求或每 10 秒刷进 Redis(`REDIS_URL` 那个库的 `obs:total`,另按小时 `obs:h:<yyyymmddHH>` 留 35 天),
    抓取时读 Redis(`backend/apps/core/obs.py`)。Redis 挂了丢的是最近一批计数,请求不受影响:

    | 指标 | 含义 |
    |---|---|
    | `soulledger_up` | 恒为 1 |
    | `soulledger_database_up` | 本进程能否查库 |
    | `soulledger_redis_up` | Celery broker 能否连上 |
    | `soulledger_celery_queue_length{queue}` | broker 队列里排队的消息数(队列深度) |
    | `soulledger_celery_unacked` | worker 已取走、未确认的消息数 |
    | `soulledger_scheduler_overdue_jobs` | 该跑却没跑的定时任务数(同 `/health/detailed/` 的 `scheduler`) |
    | `soulledger_scheduler_runs_24h{status}` | 近 24 小时定时任务执行记录,按状态 |
    | `soulledger_webhook_deliveries_pending` | 待投递的事件 webhook |
    | `soulledger_push_deliveries_unsent` | 灵魂端推送里排队 / 发送中的 |
    | `soulledger_webhook_oldest_pending_seconds` / `soulledger_push_oldest_unsent_seconds` | 上两行里最老一条等了多少秒(无则 0) |
    | `soulledger_counters_up` | 计数存储(Redis)能否读到;为 0 时下面几项不输出 |
    | `soulledger_http_requests_total{method,route,class}` | 请求数,按路由模板与状态类(2xx / 4xx / 5xx) |
    | `soulledger_http_request_duration_seconds{method,route}` | 非 5xx 请求的耗时直方图;桶 0.1 / 0.25 / 0.4 / 0.5 / 0.8 / 1.5 / 3 s,含 `docs/SLO.md` 的全部延迟阈值 |
    | `soulledger_event_handler_failures_total{handler}` | 尽力而为的事件处理器(推送 / webhook / WebSocket)抛错次数 |
    | `soulledger_celery_tasks_total{task,state}` | 任务结束次数,按任务名与最终状态 |
    | `soulledger_ws_connections` | 在线 WebSocket 连接(开 − 关;进程崩溃会让它偏高) |

    建议告警:`soulledger_celery_queue_length > 100` 持续 10 分钟(worker 跟不上或挂了)、
    `soulledger_scheduler_overdue_jobs > 0`(beat 挂了)、`soulledger_redis_up == 0`、`up == 0`。

## 数据保留(2026-10-30)

每天 04:25(UTC)的全局任务 `audit.prune_retained_data`(`backend/apps/core/retention.py`)按下表删过期行,
分批 `_raw_delete`,不写审计行。天数是环境变量,`0`(或留空)= 不清。

| 表 | 变量(默认天数) | 条件 |
|---|---|---|
| 事件 webhook 投递 | `EVENT_WEBHOOK_DELIVERY_RETENTION_DAYS`(90) | 不含 PENDING |
| 站内通知 | `USER_NOTIFICATION_READ_RETENTION_DAYS`(180) | 只删已读;连带它的邮件记录 |
| 灵魂端 / 官员端推送投递 | `PUSH_DELIVERY_RETENTION_DAYS`(90) | 灵魂端不含排队 / 发送中 |
| 停用的推送设备 | `INACTIVE_PUSH_DEVICE_RETENTION_DAYS`(30) | 按最后出现时间 |
| 过期的「记住此设备」 | `EXPIRED_MFA_DEVICE_GRACE_DAYS`(1) | 过期后 N 天 |
| 助手用量(`AssistUsage`) | `ASSIST_USAGE_RETENTION_DAYS`(730,用户 2026-10-30 定) | 用量页与月度上限只读当月 |
| Django 会话 | —— | 已过期的(admin 后台的会话) |
| 朋友圈互动消息 | —— | 90 天(产品文案写死) |

另有各自的任务:审计 / 登录日志(`AUDIT_LOG_RETENTION_DAYS` 365 / `LOGIN_LOG_RETENTION_DAYS` 180,按租户)、
土地神死亡登记请求(`DEATH_SYNC_REQUEST_RETENTION_DAYS` 90,按租户,`death_sync.cleanup_old_requests_for_tenant`;
此前写死在任务表参数里;用户 2026-10-30 定 90 天后删除 —— 它是外部系统的入站请求记录,不是账号数据)、定时任务执行记录(`SCHEDULER_*`)、灵魂登录记录(90 天)、助手会话(30 天)、个人资料导出(7 天)。

**永不删**(用户 2026-10-30 定为保留):`SoulEvent` 事件日志、审判、灵魂、账号,以及其它业务记录。
它们的归档见 `docs/ARCHITECTURE-annual-archive.md`(设计稿;用户 2026-10-30 定**上线前再做**)。

## 密钥轮换(2026-10-30)

三把密钥都能不停机轮换。顺序永远是:**新旧并存 → 所有进程换上 → 等旧的东西自然失效或重写 → 去掉旧的。**
backend、celery、celery-beat 三个容器读同一组变量,一起重建。

### SECRET_KEY

签的东西:会话与 CSRF、官员重置密码 / 邮箱验证链接(1 小时)、JWT(access 30 分钟;refresh 官员台 7 天、勾「保持登录」30 天,灵魂端 App 30 天)。

1. 生成新 key(≥ 32 字节):`python -c "import secrets; print(secrets.token_urlsafe(48))"`。
2. `SECRET_KEY=<新>`,`SECRET_KEY_FALLBACKS=<旧>`(多把用逗号分隔),重建三个容器。
   新签的一律用新 key;旧 key 签的会话、链接与 JWT 照常认(JWT 由 `backend/apps/core/jwt_fallback.py` 补上,
   SimpleJWT 自己不认 fallback),过期的照样按过期拒。
3. 等最长的刷新令牌有效期过去(默认 30 天:灵魂端 `JWT_SOUL_REFRESH_LIFETIME_DAYS`,与官员台「保持登录」)——
   那之后旧 key 签的刷新令牌都已过期或已被轮换掉。
4. 删掉 `SECRET_KEY_FALLBACKS`,再重建。

不受影响:`MATRIX_USER_SALT`(**不可轮换**,见上文聊天一节)与 `MATRIX_JWT_SECRET` / `MATRIX_GRANT_SECRET` / `MATRIX_HOOK_SECRET` 是各自的密钥。
会变的:助手审计里「问题的 HMAC」与助手配置的缓存指纹用 `SECRET_KEY` 作 HMAC 键,换 key 之后新旧两段
哈希不能互相比对(缓存只是失效一次)。

### JWT 签名(`JWT_SIGNING`,2026-11-14)

**默认 `HS256`,并且有意保持关闭**(用户 2026-11-14 决定:没有第三方验签方之前不启用)。HS256 下令牌与此前完全相同:
用 `SECRET_KEY` 签,没有 `aud` / `iss`,轮换走上面 `SECRET_KEY` 那一节;`/.well-known/jwks.json` 返回 404。

有了只拿公钥验签的旁路服务(网关、另一套系统)时再开:

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out jwt-private.pem
openssl ec -in jwt-private.pem -pubout -out jwt-public.pem
```

- `JWT_SIGNING=ES256`,`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` 填 PEM 文本或 PEM 文件路径,`JWT_ISSUER` 可选(默认 `soulledger`)。
  缺一把、解析不了、不是 P-256、或公钥不是那把私钥的另一半 → 启动即 `ImproperlyConfigured`。其他取值同样拒绝启动。
- 开启后官员令牌 `aud=soulledger-officer`、灵魂令牌(`soul_*` 类型)`aud=soulledger-soul`,都带 `iss` 与 `kid` 头;
  `aud` 与 `token_type` 对不上的令牌即使签名有效也拒。公钥在 `/.well-known/jwks.json`(`kid` = RFC 7638 指纹)。
- **切换那一刻所有已签发的 HS256 令牌一并失效**(官员与两个 App 都要重新登录),`SECRET_KEY_FALLBACKS` 不覆盖 JWT。
  选个低峰时段;App 不需要改代码。ES256 下换钥匙同样会让全部令牌失效 —— 多把公钥并存(按 `kid` 选)还没做,要不停机换钥匙时再加。
- 私钥只给 backend、celery、celery-beat 三个容器;验签方只拿 `jwt-public.pem` 或 JWKS。

### ENCRYPTION_KEY

加密的列:`WebhookConfig.signing_secret`、`DeathRegistrationRequest.source_payload`、官员 / 灵魂两步验证的
`secret`、灵魂账号的初始凭据、助手的平台 API key。

1. 生成新 key:`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`。
2. `ENCRYPTION_KEY=<新>`,`ENCRYPTION_KEY_FALLBACKS=<旧>`,重建三个容器。读时依次试每把 key,写时只用新 key。
   旧 key 写坏或不是合法 Fernet key 时拒绝启动。
3. `$DC exec backend python manage.py rotate_encryption_key --dry-run` 看各列要重写多少,
   再去掉 `--dry-run` 跑一次:逐行读出、用新 key 写回(行锁、`.update()`,不写审计、不改 `update_time`),可重复跑。
   有任何一个值所有 key 都读不出时,它原样不动、命令以非 0 退出 —— **这时不要去掉旧 key**,先查清那几行。
4. 命令退出 0 之后删掉 `ENCRYPTION_KEY_FALLBACKS`,再重建。
5. 新旧两把都要进备份记录:旧备份里的密文只认旧 key。

### Webhook 签名密钥(`WebhookConfig.signing_secret`)

每个出站 webhook 一把,建 webhook 时由服务端生成(`whsec_…`)、只在 201 响应里出现一次
(`backend/apps/death_sync/views.py`),库里由上面的 `ENCRYPTION_KEY` 加密。**没有「换密钥」接口**,
一个 webhook 也只存一把。现在能做到不丢投递的办法:

1. 在 `/death-sync` 给同一个 URL 再建一个 webhook,记下新密钥,交给接收方;
2. 接收方改成两把密钥任一验过即收(按 `X-SoulLedger-Delivery` 去重 —— 过渡期同一事件会各投一次);
3. 停用旧 webhook(`PATCH {"is_active": false}`,投递历史保留),接收方删掉旧密钥。

要在一个 webhook 上原地轮换(新旧密钥并存一段时间、同时发两个签名),需要新字段、迁移、接口与前端按钮,
没有实现;用户 2026-10-30 定**上线前再做**。
