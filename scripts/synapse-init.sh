#!/bin/bash
# 首次部署灵魂聊天前跑一次:建 `synapse` 库、生成 /data/homeserver.yaml 并追加
# config/synapse/homeserver.soulledger.yaml(docs/DEPLOYMENT.md「灵魂聊天」)。
#
#   DC="docker compose -f docker-compose.yml -f docker-compose.production.yml" scripts/synapse-init.sh
#
# 值全部来自 compose 读的根 `.env`(经 synapse 服务的 environment 进容器),本脚本
# 自己不读任何 .env。**幂等**:库已存在不建;homeserver.yaml 已存在不 generate;
# 已合并过(带 SoulLedger 标记)不再追加 —— 已有的文件永不覆盖。要改其中的值,
# 手工编辑卷里的文件,或删掉它再跑(签名密钥是单独的文件,不受影响)。
set -euo pipefail
cd "$(dirname "$0")/.."
DC=${DC:-docker compose -f docker-compose.yml -f docker-compose.production.yml}

# 1. 数据库。Synapse 拒绝在 collation 不是 C 的库上启动,而 postgres 镜像建的默认库
#    是 en_US.utf8 —— 所以从 template0 显式建。
$DC up -d --wait db
if [ "$($DC exec -T db psql -U soulledger -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='synapse'")" = "1" ]; then
  echo "synapse 库已存在,跳过"
else
  $DC exec -T db psql -U soulledger -d postgres -v ON_ERROR_STOP=1 -c \
    "CREATE DATABASE synapse OWNER soulledger ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
fi

# 2. generate(server_name、签名密钥、macaroon/form 密钥)。已有配置就跳过。
if $DC run --rm --no-deps -T --entrypoint test synapse -f /data/homeserver.yaml; then
  echo "/data/homeserver.yaml 已存在,跳过 generate"
else
  $DC run --rm --no-deps -T synapse generate
fi

# 3. 合并:删掉 generate 里与模板重复的顶层键(registration_shared_secret 等)和 SQLite
#    的 database 段,换成 PostgreSQL,追加模板并把 ${...} 换成环境里的值。
$DC run --rm --no-deps -T --entrypoint python synapse - <<'PY'
import json, os, re, sys, yaml

PATH, TEMPLATE, MARK = "/data/homeserver.yaml", "/modules/homeserver.soulledger.yaml", "# --- SoulLedger ---"
text = open(PATH).read()
if MARK in text:
    print("homeserver.yaml 已合并过,跳过")
    sys.exit(0)

required = ["MATRIX_SERVER_NAME", "MATRIX_PUBLIC_BASEURL", "MATRIX_JWT_SECRET",
            "MATRIX_REGISTRATION_SHARED_SECRET", "SYNAPSE_DB_PASSWORD"]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    sys.exit(f"缺少环境变量(写进根 .env):{', '.join(missing)}")
if len(os.environ["MATRIX_JWT_SECRET"].encode()) < 32:
    sys.exit("MATRIX_JWT_SECRET 至少 32 字节")
if os.environ["SYNAPSE_SERVER_NAME"] != os.environ["MATRIX_SERVER_NAME"]:
    sys.exit("SYNAPSE_SERVER_NAME 与 MATRIX_SERVER_NAME 不一致")

def q(value):  # YAML 双引号字符串的内容(转义规则与 JSON 相同)
    return json.dumps(value)[1:-1]

def fill(match):
    name = match.group(1)
    if not os.environ.get(name):
        sys.exit(f"模板引用了未设置的 {name}")
    return q(os.environ[name])

template = re.sub(r"\$\{([A-Z_]+)\}", fill, open(TEMPLATE).read())
added = {
    "public_baseurl": f'"{q(os.environ["MATRIX_PUBLIC_BASEURL"])}"',
    "database": (
        '\n  name: psycopg2\n  args:\n    user: soulledger\n'
        f'    password: "{q(os.environ["SYNAPSE_DB_PASSWORD"])}"\n'
        '    database: synapse\n    host: db\n    port: 5432\n    cp_min: 5\n    cp_max: 10'
    ),
}
# 模板里的说明注释里也写着「${...}」—— 那不是 [A-Z_]+,不会被替换,原样留下。
drop = set(re.findall(r"^([a-z_]+):", template, flags=re.M)) | set(added)

kept, skipping = [], False
for line in text.splitlines():
    key = re.match(r"^([a-z_]+):", line)
    if key:
        skipping = key.group(1) in drop
    elif line and not line[0].isspace() and not line.startswith("#"):
        skipping = False
    if not skipping:
        kept.append(line)

merged = "\n".join(kept).rstrip() + "\n\n" + MARK + "\n" + \
    "".join(f"{k}: {v}\n" for k, v in added.items()) + "\n" + template
keys = re.findall(r"^([a-z_]+):", merged, flags=re.M)
dupes = sorted({k for k in keys if keys.count(k) > 1})
if dupes:
    sys.exit(f"合并后顶层键重复:{dupes}")
yaml.safe_load(merged)  # 语法错误在这里失败,不是在 Synapse 启动时
open(PATH, "w").write(merged)
print("homeserver.yaml 已合并")
PY

echo "完成。下一步:$DC up -d synapse nginx,然后 $DC exec backend python manage.py setup_matrix"
