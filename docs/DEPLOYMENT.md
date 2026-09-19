# 生产部署

生产栈是 `docker-compose.yml` + `docker-compose.production.yml`(`scripts/deploy.sh production`
就是 `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`)。
根 `.env` 需要的变量见 `.env.example`。下文把这对 `-f` 简写为 `$DC`:

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.production.yml"
```

## TLS 证书:首次签发(手动,一次)

`certbot` 服务只负责续期。首签需要真实域名,不在 compose 里自动做。

1. 域名的 DNS 指向这台主机,80 端口从公网可达。
2. 先起 nginx(此时 `nginx.conf` 只听 80,`/.well-known/acme-challenge/` 从
   `certbot_www` 卷提供):`$DC up -d nginx`
3. 签发(webroot,与续期同一个卷)。**先带 `--staging` 跑一遍**,通过后去掉再跑 ——
   Let's Encrypt 对失败的验证有速率限制:

   ```bash
   $DC run --rm --no-deps --entrypoint certbot certbot certonly \
     --webroot -w /var/www/certbot \
     -d example.com -d www.example.com \
     --email ops@example.com --agree-tos --no-eff-email
   ```

4. 编辑 `nginx.conf`:解开 `listen 443 ssl;`、`http2 on;` 与两行 `ssl_certificate*`,
   把 `YOUR_DOMAIN` 换成第 3 步 `-d` 的第一个域名;然后 `$DC up -d nginx`。
   (`tests/test_production.py` 要求 443 与证书两行同时开或同时关。)
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

## 定时任务(celery beat)

- 调度存在数据库里(`DatabaseScheduler`),清单在 `backend/apps/scheduler/registry.py`。
  backend 的启动命令每次都会跑 `python manage.py setup_scheduled_tasks`:按
  (任务 × 活跃租户) 补齐缺失的 PeriodicTask 行,任务名与参数以清单为准,**保留**运维
  改过的启停 / cron / 时区;删掉旧的扇出行(`ledger.recalculate_all` 等)与已停用租户的行。
  要把 cron 也恢复成默认:`$DC exec backend python manage.py setup_scheduled_tasks --reset`。
  新建租户时由 `Tenant` 的 post_save 自动补行,不用等下次启动。
- 页面 `/scheduler`(权限码 `scheduler.read` / `scheduler.manage`,默认只 ADMIN)可以
  启停、改 cron、手动运行、看执行记录;「重建」等于再跑一遍上面的命令。
- 执行记录(`scheduler_taskrun`)保留 `SCHEDULER_RUN_RETENTION_DAYS`(默认 30)天,每个
  任务至少留 `SCHEDULER_RUN_KEEP_MIN`(默认 20)条;卡死的 RUNNING 超过任务的 max_runtime、
  或 PENDING 超过 `SCHEDULER_PENDING_GRACE_SECONDS`(默认 900)没被取走,都由每 5 分钟的
  `scheduler.reap_stale_runs` 标成 LOST;worker 重启时它名下遗留的 RUNNING 也标 LOST。
- **beat 只能起一个实例。** 两个 beat 读同一张调度表，会把每个任务派发两次。compose 里 `celery-beat`
  只有一份，**不要** `docker compose up --scale celery-beat=2`,也不要在另一台机器上对同一个库再起 beat。
  误起了第二个时，按 (任务, 租户) 的单飞锁只挡得住**时间重叠**的那次(记成 SKIPPED);
  跑得快的任务在第二次派发到达前已经结束，仍会执行两次。锁是兜底，不是用法。
  需要 beat 高可用(一台挂了另一台自动接手)时，再换 `celery-redbeat` 这类带分布式锁的调度器。
- **beat 挂了怎么发现:** `GET /health/detailed/`(ADMIN)在有任务「该跑却没跑」
  (超过 cron 应触发时间 `SCHEDULER_OVERDUE_GRACE_SECONDS`,默认 600 秒)时,
  `scheduler` 字段为 `"overdue"`、`scheduler_overdue` 列出任务名;**状态码仍是 200、
  `status` 仍是 `"ok"`** —— 503 留给数据库/Redis 故障(那是这个进程自己的问题),
  beat 没跑是另一个容器的问题,探针要读 `scheduler` 字段而不是状态码。
  不要只靠站内通知 —— 发通知的检测任务自己也是 beat 派发的。设置了 `SENTRY_DSN` 时,
  每个 beat 派发的任务同时向 Sentry Crons 报到(`CeleryIntegration(monitor_beat_tasks=True)`)。
- 执行状态与调度变更通过既有 WebSocket 管道推送(domain `scheduler`,权限门
  `scheduler.read`;租户行只进该租户分组,全局行只到 ADMIN)。

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
  `MATRIX_JWT_SECRET`(= Synapse `jwt_config.secret`,≥32 字节)、
  `MATRIX_REGISTRATION_SHARED_SECRET`(= Synapse `registration_shared_secret`,只用来把服务账号
  注册成 admin 一次)、`MATRIX_USER_SALT`(mxid 由账号 id 经 HMAC 派生;**不可轮换**,换了所有 mxid
  都变)。`MATRIX_INTERNAL_URL` 在 compose 里写死为 `http://synapse:8008`;
  `CHAT_REQUEST_INTERVAL_SECONDS` 用默认(86400)。`SYNAPSE_DB_PASSWORD` 是 `synapse` 库账号的密码,
  只有 synapse 服务读(脚本用它建角色并写进 homeserver.yaml;角色已存在时脚本**不改密码** ——
  要换密码,在 db 里 `ALTER ROLE synapse PASSWORD …` 并同步改卷里 homeserver.yaml 的 `database.args.password`)。
- **新书信推送(Synapse → 后端回调)**:模块配置里的 `push_url`(模板里是 `${MATRIX_PUSH_HOOK_URL}`),指向后端
  `http://<后端内网地址>/api/v1/chat/hooks/new-message/`(容器网络内,不经 nginx、不对外暴露)。
  每条 `m.room.message` 落库之后,模块在后台进程里 POST `{room_id, event_id, sender, ts, mac}`;
  `mac` 用 `grant_secret`(= `MATRIX_JWT_SECRET`)签,后端 `apps/chat/hook.py` 验签、限 5 分钟时间窗,
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
  或删掉它重跑脚本(签名密钥是单独的文件,不受影响)。**改 `MATRIX_JWT_SECRET` 要两边一起改**,
  否则 App 登录与后端代发全部 403。
- 2026-09-19 本机实跑过上面这套(synapse + 临时 postgres + nginx,端口只绑 127.0.0.1):脚本两次运行
  第二次全部跳过;`/_matrix/client/versions` 经 nginx 200,`/_synapse/admin/*` 经 nginx 403;
  `setup_matrix` 两次均成功(第二次走「已注册 → JWT 登录」);`test_chat_synapse_integration.py`
  2 passed。停掉 synapse 时 nginx 在、这两条路径 502。
- 实机验证:`backend/tests/test_chat_synapse_integration.py` 文件头有本机起一个 Synapse 跑它的命令。
- **已有一台用 SQLite 的 Synapse**(如测试机上手工加进 compose 的那台):`scripts/synapse-migrate-sqlite-to-pg.sh`
  在那台机器的 compose 目录里执行,用官方 `synapse_port_db` 迁到同一 compose 里的 PostgreSQL,
  建单独的 `synapse` 角色与 C collation 的库,只换 `homeserver.yaml` 的 `database` 段 ——
  **server_name 与签名密钥不动**。先等 SQLite 的后台更新跑完(`synapse_port_db` 拒绝迁移有未完成
  后台更新的库,而新库常有),停机前把 `/data` 整个打包;迁移后核对 server_name、签名密钥 id 与
  users/rooms/events 行数。任一步失败即停,并打印该阶段的回滚命令(换配置前:直接起回;换配置后:
  恢复 `homeserver.yaml.sqlite.bak` 再起)。参数与默认值见脚本头。2026-09-19 本机演练(SQLite 版
  synapse + postgres:16-alpine,只绑 127.0.0.1):迁移 exit 0;迁移后服务账号 JWT 登录、admin 标记、
  房间与三条消息、迁移前签发的 access token 都在;重跑识别为已迁移、exit 0。

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
