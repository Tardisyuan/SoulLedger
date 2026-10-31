# 对外对接说明

给接入 SoulLedger 的外部系统看:**外部死亡登记接口**(外部系统调我们)和 **webhook**(我们推给外部系统)。
所有路径都以 `/api/v1/` 开头。字段以代码为准(`backend/apps/death_sync/`、`backend/apps/events/tasks.py`),
完整的机器可读定义见 `packages/core/openapi/schema.yml`。

## 一、认证:API Key

- 由殿的管理员在管理后台「死亡同步 › API Key」里创建;明文只在创建时显示一次。
- 每个请求带请求头:`Authorization: ApiKey <key>`
- 每个 Key 有三项能力,按需开:
  - `can_register_death` —— 调登记接口(默认开)
  - `can_query_status` —— 调 `health/` 与登记进度 `register/{id}/progress/`(默认开)
  - `can_manage_webhooks` —— 用 Key 自己管理 webhook(默认关)
- 可设过期时间与 IP 白名单(`allowed_ips`);过期、停用、来源 IP 不在白名单都返回 401。
- 限流按 Key 计:默认每分钟 60 次、每小时 1000 次(管理员可改)。超出返回 429。
  `GET death-sync/health/` 不计入限流,返回里有本 Key 剩余的次数。

## 二、外部死亡登记

`POST /api/v1/death-sync/register/`

### 单条

```json
{
  "soul_lookup": { "soul_id": "<灵魂 UUID>" },
  "death_date": "2026-10-23",
  "death_location": "可选",
  "cause_of_death": "可选",
  "source_reference": "可选,你方的单号",
  "contact_email": "可选",
  "contact_phone": "可选,7–15 位数字,可带 +",
  "metadata": {}
}
```

- `soul_lookup` 用 `soul_id`,或 `name`(可再加 `birth_date` / `civilization`)找灵魂。
- 幂等:可带请求头 `X-Idempotency-Key`;不带时按「本 Key + 请求体」算一个。同一个键重复提交返回
  **409** `{"status": "duplicate", "registration_id", "existing_status"}`,不会重复登记。
- 成功 **201**:

```json
{ "status": "accepted", "registration_id": "…", "idempotency_key": "…",
  "result": { "soul_id": "…", "previous_state": "ALIVE", "new_state": "JUDGING", "judgment_id": "…" } }
```

- 业务失败 **400** `{"error": {"code", "message", "request_id"}}`;字段校验失败是 400 的逐字段错误。

### 批量

请求体 `{"batch": true, "registrations": [ <单条的对象>, … ]}`,**最多 50 条**(超出 400 `BATCH_TOO_LARGE`)。

- 全部成功 **201**,有失败 **207**:

```json
{ "status": "accepted | partial", "total": 3, "succeeded": 2, "failed": 1,
  "results": [ { "index": 0, "status": "PROCESSED", "registration_id": "…", "soul_id": "…", "judgment_id": "…" },
               { "index": 2, "status": "FAILED", "registration_id": "…", "error_code": "SOUL_NOT_FOUND", "error_message": "…" } ] }
```

### 错误码

| code | HTTP | 含义 |
|---|---|---|
| `KEY_NO_DEATH_PERMISSION` | 403 | 这个 Key 没开 `can_register_death` |
| `BATCH_TOO_LARGE` | 400 | 批量超过 50 条 |
| `SOUL_NOT_FOUND` | 400 / 批量项 | 按 `soul_lookup` 找不到灵魂 |
| `SOUL_NOT_ALIVE` | 400 / 批量项 | 灵魂已不是「在世」(已登记过死亡等) |
| `INVALID_TRANSITION` | 400 / 批量项 | 状态机拒绝这次转换 |
| `VALIDATION_ERROR` | 批量项 | 该条字段不合法 |
| `INTERNAL_ERROR` | 400 / 批量项 | 服务端处理出错;管理员可在后台重试这条 |
| `HALL_INACTIVE` | 400 / 批量项 | 这个殿已停用,不再收新的死亡登记(已有数据照常可查) |

### 查询登记进度

`GET /api/v1/death-sync/register/<registration_id>/progress/`(要 `can_query_status`)

只能查**本 Key 自己提交**的登记;别的 Key 的登记与不存在的一样答 404。只给粗粒度阶段,不含裁决、批语与经办官员:

```json
{ "registration_id": "…", "registration_status": "PROCESSED", "soul_id": "…", "soul_state": "JUDGING",
  "stage": "at_city_god" }
```

| stage | 含义 |
|---|---|
| `registered` | 已收到登记(含登记失败、尚未开审) |
| `at_city_god` | 在城隍初审(只地府有这一站) |
| `judging` | 审判中 |
| `sentenced` | 已判,受刑、候转世,或押送途中失踪(`soul_state` 为 `LOST`) |
| `reincarnated` | 已转入下一世(此后的事不再属于这条登记) |
| `settled` | 终局,不再转世 |

`GET /api/v1/death-sync/register/` 与 `register/<id>/` 仍返回本 Key 的登记记录本身(含处理状态与错误码)。

## 三、webhook(我们推给你)

### 配置

- 管理员在后台「死亡同步 › Webhook」里填地址;或用开了 `can_manage_webhooks` 的 Key 调
  `death-sync/webhooks/`。签名密钥只在创建时显示一次(201 响应里的 `_signing_secret`;列表、详情、修改都不再返回),
  请交给接收方保存。
- `events` 填要订阅的事件类型,**留空 = 全部**。发事件的域:soul、workflow、notification、dispatch、
  deathsync、social,以及单独登记的 `SCHEDULER_RUN_FAILED`(某个殿的定时任务运行失败)。
- 每个请求 POST 一段 JSON:

```json
{ "event_type": "…", "domain": "…", "tenant_code": "…", "user_ids": [], "permission": "…", "actor": "…", "payload": { … } }
```

### 请求头

| 头 | 内容 |
|---|---|
| `X-SoulLedger-Event` | 事件类型 |
| `X-SoulLedger-Domain` | 事件所属的域 |
| `X-SoulLedger-Delivery` | 这次投递的 id;重试时不变,可用来去重 |
| `X-SoulLedger-Timestamp` | 签名时的 Unix 秒 |
| `X-SoulLedger-Signature-V2` | `sha256=` + HMAC-SHA256(密钥, `"<Timestamp>." + 原始请求体`) |
| `X-SoulLedger-Signature` | `sha256=` + HMAC-SHA256(密钥, 原始请求体)。旧格式,不含时间,截获后可被重放;新接入请用 V2 |

### 校验(推荐做法)

1. 用**原始请求体字节**算 `"<Timestamp>." + body` 的 HMAC-SHA256,与 `X-SoulLedger-Signature-V2` 做常量时间比较。
2. 拒绝 `X-SoulLedger-Timestamp` 与本机时间相差超过 5 分钟的请求(防重放)。
3. 可选:记下处理过的 `X-SoulLedger-Delivery`,重复的直接回 2xx。

```python
import hashlib, hmac, time

def verify(secret: str, body: bytes, headers) -> bool:
    ts = headers["X-SoulLedger-Timestamp"]
    if abs(time.time() - int(ts)) > 300:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, headers["X-SoulLedger-Signature-V2"])
```

### 回应与重试

- 回 **2xx** 算成功;其他状态码、超时、连不上都算失败。**不跟随重定向**(3xx 也是失败)。
- 超时默认 10 秒(配置里的 `timeout_seconds`)。
- 失败后指数退避重试(第 n 次后等 2ⁿ 秒),最多 `max_retries` 次,且不超过 5 次;用完后管理员可在后台
  「投递记录」里手动重投。
- 投递是在业务提交之后排队的,**尽力而为**:极端情况下(排队本身失败)可能漏发,需要对账时以登记接口与
  后台记录为准。

### 地址限制

- 生产环境只接受 `https://`。
- 地址解析出的每个 IP 都必须是公网可路由地址:私网、回环、链路本地、组播、保留段、IPv4 映射的 IPv6
  地址一律拒绝(配置时和每次投递前都会检查)。
