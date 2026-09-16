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
- **beat 挂了怎么发现:** `GET /health/detailed/`(ADMIN)在有任务「该跑却没跑」
  (超过 cron 应触发时间 `SCHEDULER_OVERDUE_GRACE_SECONDS`,默认 600 秒)时返回 503,
  `scheduler_overdue` 列出任务名。外部探针盯这个;不要只靠站内通知 —— 发通知的检测任务
  自己也是 beat 派发的。设置了 `SENTRY_DSN` 时,每个 beat 派发的任务同时向 Sentry Crons
  报到(`CeleryIntegration(monitor_beat_tasks=True)`)。

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
