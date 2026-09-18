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

- 单 Synapse homeserver(不联邦)。**compose 里还没有 synapse 服务与 nginx 反代**(2026-09-18),
  上线前要补;本节是它们要满足的条件。
- homeserver.yaml = `docker run … matrixdotorg/synapse generate` 产出的那份 + 追加
  `config/synapse/homeserver.soulledger.yaml`(`${…}` 换成与后端相同的值)。模块
  `config/synapse/soulledger_policy.py` 挂进容器并放进 `PYTHONPATH`:除服务账号外不能建房、邀请、
  建别名、发布房间,并在节流房间里只放行后端签过一次性凭据的那条私聊请求 ——
  **少了它,灵魂拿自己的 token 就能绕过全部聊天规则**。模块把用过的凭据记在进程内存里:
  Synapse 单进程部署;拆 worker 前先把它换成共享存储。
- 后端环境变量:`MATRIX_ENABLED`(默认 `False`,关着时 `/me/chat/` 与 `/chat/inbox/` 一律 503)、
  `MATRIX_INTERNAL_URL`(后端 → Synapse)、`MATRIX_PUBLIC_BASEURL`(App → Synapse,发给 App)、
  `MATRIX_SERVER_NAME`、`MATRIX_JWT_SECRET`(= Synapse `jwt_config.secret`,≥32 字节)、
  `MATRIX_REGISTRATION_SHARED_SECRET`(= Synapse `registration_shared_secret`,只用来把服务账号
  注册成 admin 一次)、`MATRIX_USER_SALT`(mxid 由账号 id 经 HMAC 派生;**不可轮换**,换了所有 mxid
  都变)、`CHAT_REQUEST_INTERVAL_SECONDS`(默认 86400)。
- 限速:服务账号替灵魂转发、改 power level、建房,量随灵魂数增长。用 admin API
  `POST /_synapse/admin/v1/users/@soulledger:<server_name>/override_ratelimit` 给它免限速。
- 实机验证:`backend/tests/test_chat_synapse_integration.py` 文件头有本机起一个 Synapse 跑它的命令。

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
