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
