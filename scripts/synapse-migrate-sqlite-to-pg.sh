#!/bin/bash
# 把一台**用 SQLite 的** Synapse 迁到同一个 compose 里的 PostgreSQL(官方 synapse_port_db)。
# 给 115 那种手工加进 compose 的 synapse 容器用;docker-compose.yml 里的 synapse 服务
# 一开始就是 PostgreSQL,用不着它(docs/DEPLOYMENT.md「灵魂聊天」)。
#
#   cd <compose 文件所在目录>
#   SYNAPSE_DB_PASSWORD=… bash <repo>/scripts/synapse-migrate-sqlite-to-pg.sh
#
# 参数全走环境变量(括号里是默认值):
#   DC                  compose 命令(docker compose);要指定文件就用 COMPOSE_FILE 或写进 DC
#   SYNAPSE_SERVICE     synapse 服务名(synapse)。它的 /data 是 homeserver.yaml 与 SQLite 所在
#   PG_SERVICE          postgres 服务名(postgres)
#   PG_SUPERUSER        postgres 里能建角色建库的账号(soulledger)
#   PG_HOST / PG_PORT   从 synapse 容器看 postgres 的主机名与端口(postgres / 5432)
#   SYNAPSE_DB_NAME     新库名(synapse)
#   SYNAPSE_DB_USER     新角色(synapse):只拥有新库,非超级用户,不能建库建角色
#   SYNAPSE_DB_PASSWORD 新角色的密码(必填;只经 stdin / 容器环境传递,不上命令行)
#   BACKUP_DIR          备份放哪(./synapse-migrate-<时间>);含签名密钥,目录权限 700
#   BG_WAIT_SECONDS     停机前等 SQLite 后台更新跑完的上限(600)
#
# 做什么:停 synapse → 把 /data 整个打包到 BACKUP_DIR → 建角色与库(C collation)→
# 写出换成 psycopg2 的新配置 → synapse_port_db → 换上新配置(原文件留作
# homeserver.yaml.sqlite.bak)→ 启动 → 健康检查,并核对 server_name、签名密钥、
# users/rooms/events 行数与迁移前一致。server_name 与签名密钥**不动**:只改 database 段。
# SQLite 文件原样留着,确认无误后再手工删。
#
# 任何一步失败就停,并打印当时该怎么回滚 —— 换配置之前失败,SQLite 与原配置都没动过,
# 起回 synapse 即可;换配置之后失败,先恢复 homeserver.yaml.sqlite.bak 再起。
# 已经是 psycopg2 的配置直接退出 0(不重复迁移)。
set -Eeuo pipefail

DC=${DC:-docker compose}
SYNAPSE_SERVICE=${SYNAPSE_SERVICE:-synapse}
PG_SERVICE=${PG_SERVICE:-postgres}
PG_SUPERUSER=${PG_SUPERUSER:-soulledger}
PG_HOST=${PG_HOST:-postgres}
PG_PORT=${PG_PORT:-5432}
SYNAPSE_DB_NAME=${SYNAPSE_DB_NAME:-synapse}
SYNAPSE_DB_USER=${SYNAPSE_DB_USER:-synapse}
: "${SYNAPSE_DB_PASSWORD:?设置 SYNAPSE_DB_PASSWORD(新 synapse 角色的密码)}"
export SYNAPSE_DB_PASSWORD PG_HOST PG_PORT SYNAPSE_DB_NAME SYNAPSE_DB_USER
BACKUP_DIR=${BACKUP_DIR:-./synapse-migrate-$(date +%Y%m%d_%H%M%S)}

case "$SYNAPSE_DB_NAME$SYNAPSE_DB_USER" in
  *[!a-z0-9_]*) echo "SYNAPSE_DB_NAME / SYNAPSE_DB_USER 只允许小写字母、数字、下划线" >&2; exit 1 ;;
esac

STAGE=preflight
rollback() {
  echo >&2
  echo "!!! 失败于第 $1 行,阶段:$STAGE" >&2
  case "$STAGE" in
    preflight)
      echo "什么都没动过。" >&2 ;;
    backup|database|port)
      echo "SQLite 与 homeserver.yaml 都没动过。回滚:$DC start $SYNAPSE_SERVICE" >&2
      echo "(已建的 $SYNAPSE_DB_NAME 库 / $SYNAPSE_DB_USER 角色不影响 SQLite 运行,可留着重跑,也可删掉。)" >&2 ;;
    switch|start|verify)
      echo "回滚到 SQLite:" >&2
      echo "  $DC stop $SYNAPSE_SERVICE" >&2
      echo "  $DC run --rm --no-deps -T --entrypoint cp $SYNAPSE_SERVICE -p /data/homeserver.yaml.sqlite.bak /data/homeserver.yaml" >&2
      echo "  $DC start $SYNAPSE_SERVICE" >&2
      echo "迁移后若已有新消息写进 PostgreSQL,回滚会丢掉它们。" >&2 ;;
  esac
  echo "完整备份:$BACKUP_DIR/synapse-data.tar.gz(/data 原样)" >&2
}
trap 'rollback $LINENO' ERR

# 一次性容器:同一镜像、同一 /data、同一网络。`--` 之前是 compose run 的选项,之后是命令参数。
run() {
  local opts=()
  while [ "$1" != "--" ]; do opts+=("$1"); shift; done
  shift
  $DC run --rm --no-deps -T "${opts[@]}" "$SYNAPSE_SERVICE" "$@"
}
syn_py() { run -e SYNAPSE_DB_PASSWORD -e PG_HOST -e PG_PORT -e SYNAPSE_DB_NAME -e SYNAPSE_DB_USER --entrypoint python -- -; }
psql_su() { $DC exec -T "$PG_SERVICE" psql -U "$PG_SUPERUSER" -v ON_ERROR_STOP=1 -qtA "$@"; }

# ---------------------------------------------------------------- 0. 检查
echo "== 0. 检查当前配置"
INFO=$(syn_py <<'PY'
import os, sys, yaml
c = yaml.safe_load(open("/data/homeserver.yaml"))
db = c.get("database") or {}
if db.get("name") == "psycopg2":
    print("ALREADY"); sys.exit(0)
if db.get("name") != "sqlite3":
    sys.exit(f"database.name 是 {db.get('name')!r},既不是 sqlite3 也不是 psycopg2")
path = db["args"]["database"]
key = c.get("signing_key_path") or f"/data/{c['server_name']}.signing.key"
for p in (path, key):
    if not os.path.isfile(p):
        sys.exit(f"找不到 {p}")
print(c["server_name"], path, key)
PY
)
if [ "$INFO" = "ALREADY" ]; then
  echo "homeserver.yaml 的 database 已是 psycopg2,不重复迁移。"; exit 0
fi
read -r SERVER_NAME SQLITE_PATH KEY_PATH <<<"$INFO"
echo "server_name=$SERVER_NAME  sqlite=$SQLITE_PATH  signing_key=$KEY_PATH"

# synapse_port_db 拒绝迁移还有「后台更新」没跑完的 SQLite,而这些更新只有运行中的
# Synapse 会跑(2026-09-19 本机演练:新建不久的库就撞上了)。所以停之前先等它们清空。
echo "== 0b. 等 SQLite 的后台更新跑完(最多 ${BG_WAIT_SECONDS:=600} 秒;synapse 须在运行)"
waited=0
while :; do
  pending=$($DC exec -T "$SYNAPSE_SERVICE" python - "$SQLITE_PATH" <<'PY'
import sqlite3, sys
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
print(c.execute("select count(*) from background_updates").fetchone()[0])
PY
)
  [ "$pending" = 0 ] && break
  if [ "$waited" -ge "$BG_WAIT_SECONDS" ]; then
    echo "还有 $pending 条后台更新没跑完;什么都没动,稍后重跑(或调大 BG_WAIT_SECONDS)" >&2; exit 1
  fi
  echo "  还有 $pending 条,等 10 秒…"; sleep 10; waited=$((waited + 10))
done

# ---------------------------------------------------------------- 1. 停 + 备份
STAGE=backup
echo "== 1. 停 $SYNAPSE_SERVICE 并备份 /data 到 $BACKUP_DIR"
$DC stop "$SYNAPSE_SERVICE"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd)
run -v "$BACKUP_DIR:/backup" --entrypoint tar -- czf /backup/synapse-data.tar.gz -C /data .
run -v "$BACKUP_DIR:/backup:ro" --entrypoint tar -- tzf /backup/synapse-data.tar.gz >/dev/null
KEY_SHA=$(run --entrypoint sha256sum -- "$KEY_PATH" | cut -d' ' -f1)
COUNTS_BEFORE=$(run --entrypoint python -- - "$SQLITE_PATH" <<'PY'
import sqlite3, sys
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
print(" ".join(str(c.execute(f"select count(*) from {t}").fetchone()[0]) for t in ("users", "rooms", "events")))
PY
)
echo "备份完成;签名密钥 sha256=${KEY_SHA:0:16}…;迁移前 users/rooms/events = $COUNTS_BEFORE"

# ---------------------------------------------------------------- 2. 角色与库
STAGE=database
echo "== 2. 在 $PG_SERVICE 里建角色 $SYNAPSE_DB_USER 与库 $SYNAPSE_DB_NAME(C collation)"
PW_LIT=${SYNAPSE_DB_PASSWORD//\'/\'\'}
psql_su -d postgres <<SQL
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', '$SYNAPSE_DB_USER')
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$SYNAPSE_DB_USER')\gexec
SELECT format('ALTER ROLE %I PASSWORD %L', '$SYNAPSE_DB_USER', '$PW_LIT')\gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' LC_COLLATE ''C'' LC_CTYPE ''C'' TEMPLATE template0', '$SYNAPSE_DB_NAME', '$SYNAPSE_DB_USER')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$SYNAPSE_DB_NAME')\gexec
REVOKE CONNECT ON DATABASE $SYNAPSE_DB_NAME FROM PUBLIC;
SQL
psql_su -d postgres -c "SELECT format('owner=%s collate=%s ctype=%s', pg_get_userbyid(datdba), datcollate, datctype) FROM pg_database WHERE datname = '$SYNAPSE_DB_NAME'"

# ---------------------------------------------------------------- 3. 新配置 + 迁移
STAGE=port
echo "== 3. 写 /data/homeserver.yaml.pg(只换 database 段)并运行 synapse_port_db"
syn_py <<'PY'
import json, os, re, yaml
src, dst = "/data/homeserver.yaml", "/data/homeserver.yaml.pg"
e = os.environ
kept, skipping = [], False
for line in open(src).read().splitlines():
    key = re.match(r"^([A-Za-z_]+):", line)
    if key:
        skipping = key.group(1) == "database"
    elif line and not line[0].isspace() and not line.startswith("#"):
        skipping = False
    if not skipping:
        kept.append(line)
block = (
    "database:\n  name: psycopg2\n  args:\n"
    f"    user: {e['SYNAPSE_DB_USER']}\n    password: {json.dumps(e['SYNAPSE_DB_PASSWORD'])}\n"
    f"    database: {e['SYNAPSE_DB_NAME']}\n    host: {e['PG_HOST']}\n    port: {int(e['PG_PORT'])}\n"
    "    cp_min: 5\n    cp_max: 10\n"
)
text = "\n".join(kept).rstrip() + "\n\n# --- 由 synapse-migrate-sqlite-to-pg.sh 从 sqlite3 换成 psycopg2 ---\n" + block
old, new = yaml.safe_load(open(src)), yaml.safe_load(text)
assert new["database"]["name"] == "psycopg2"
assert {k: v for k, v in old.items() if k != "database"} == {k: v for k, v in new.items() if k != "database"}, \
    "除 database 段外配置有变化"
open(dst, "w").write(text)
st = os.stat(src)
os.chown(dst, st.st_uid, st.st_gid)
os.chmod(dst, st.st_mode & 0o777)
PY
run --entrypoint synapse_port_db -- --sqlite-database "$SQLITE_PATH" --postgres-config /data/homeserver.yaml.pg

# ---------------------------------------------------------------- 4. 换配置
STAGE=switch
echo "== 4. 换上新配置(原文件 → /data/homeserver.yaml.sqlite.bak)"
run --entrypoint sh -- -c 'cp -p /data/homeserver.yaml /data/homeserver.yaml.sqlite.bak && mv /data/homeserver.yaml.pg /data/homeserver.yaml'

# ---------------------------------------------------------------- 5. 启动
STAGE=start
echo "== 5. 启动并等健康"
$DC start "$SYNAPSE_SERVICE"
for i in $(seq 1 45); do
  if $DC exec -T "$SYNAPSE_SERVICE" curl -fsS http://localhost:8008/health >/dev/null 2>&1; then break; fi
  if [ "$i" = 45 ]; then echo "90 秒内没有健康:$DC logs --tail 50 $SYNAPSE_SERVICE" >&2; false; fi
  sleep 2
done

# ---------------------------------------------------------------- 6. 核对
STAGE=verify
echo "== 6. 核对 server_name、签名密钥、行数"
$DC exec -T "$SYNAPSE_SERVICE" python - "$SERVER_NAME" "$KEY_PATH" <<'PY'
import json, sys, urllib.request
server_name, key_path = sys.argv[1:]
k = json.load(urllib.request.urlopen("http://localhost:8008/_matrix/key/v2/server"))
algo, version = open(key_path).read().split()[:2]
assert k["server_name"] == server_name, f"server_name 变了:{k['server_name']}"
assert f"{algo}:{version}" in k["verify_keys"], f"签名密钥 {algo}:{version} 不在 {list(k['verify_keys'])}"
print("server_name 与签名密钥 id 未变:", server_name, f"{algo}:{version}")
PY
[ "$($DC exec -T "$SYNAPSE_SERVICE" sha256sum "$KEY_PATH" | cut -d' ' -f1)" = "$KEY_SHA" ] || { echo "签名密钥文件变了" >&2; false; }
COUNTS_AFTER=$(psql_su -d "$SYNAPSE_DB_NAME" -c "SELECT (SELECT count(*) FROM users) || ' ' || (SELECT count(*) FROM rooms) || ' ' || (SELECT count(*) FROM events)")
echo "迁移后 users/rooms/events = $COUNTS_AFTER"
[ "$COUNTS_AFTER" = "$COUNTS_BEFORE" ] || { echo "行数与迁移前($COUNTS_BEFORE)不一致" >&2; false; }
$DC exec -T "$SYNAPSE_SERVICE" python -c 'import yaml; assert yaml.safe_load(open("/data/homeserver.yaml"))["database"]["name"] == "psycopg2"'

trap - ERR
echo
echo "完成:$SYNAPSE_SERVICE 已在 PostgreSQL($SYNAPSE_DB_NAME)上运行。"
echo "SQLite 文件 $SQLITE_PATH 与 /data/homeserver.yaml.sqlite.bak 保留未删;确认聊天正常后再手工清理。"
echo "备份:$BACKUP_DIR/synapse-data.tar.gz(含签名密钥,妥善保管)"
