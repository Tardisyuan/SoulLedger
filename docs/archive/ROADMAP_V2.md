# SoulLedger V2 规划 - 灵魂客户端 + 转生抢购系统

> ## ⛔ SUPERSEDED — 已废弃，2026-08-14 归档
>
> **这份路线图的前提与项目定位冲突，不再作为计划执行。** 保留是因为其中的
> 接口设计和数据模型有价值，而且它的一部分**已经交付了**（见下方「已交付」）。
>
> ### 冲突在哪里
>
> 本文档规划的是一个面向**真实终端用户**的产品：灵魂 C 端客户端（Flutter/RN，
> §七、§八）、转生名额抢购（Redis Lua 原子扣减、限流防刷，§五）、聊天与朋友圈
> （§四、Phase 4）。抢购系统、防刷限流、好友上限这类设计，只有在存在真实用户
> 与真实竞争的前提下才成立。
>
> 而 [`../README.md`](../README.md) 的「定位与状态」一节写明：这是一个个人项目，
> **从未部署到任何真实环境，没有用户**，不提供可用性、支持或向后兼容承诺。
>
> 所以 §十 路线图里 Phase 1-4 的 14 个任务框零勾选（全文 31 个复选框同样一个未勾），
> 不是能力问题，也不是排期问题——是这条路线本身没有需求支撑。为一个没有用户的系统
> 建抢购与防刷，是在解一个不存在的问题。
>
> ### 已交付的部分（不在废弃范围内）
>
> 本文档并非全盘落空。以下两节已经实现，只是走的是里程碑而不是本路线图：
>
> | 本文小节 | 状态 | 交付于 | 代码位置 |
> |---|---|---|---|
> | §二 死亡信息同步 API | ✅ 已交付 | M11 | `backend/apps/death_sync/` — `register/`、`webhooks/`、`api-keys/`、`health/` 四组端点，含 HMAC 签名（`signing.py`）、载荷加密（`encrypted_json.py`）、限流（`throttling.py`）、Celery 重试（`tasks.py`） |
> | §三 实时通知（WebSocket） | ✅ 已交付 | M12 | `backend/apps/notifications/consumers.py` — JWT 认证、心跳、user/tenant 分组广播、`permission.refresh` |
>
> §十一「技术债务」列出的条目也大多已被后续工作覆盖（限流、输入校验、索引优化、
> 覆盖率），不必再从本文档追踪。
>
> ### 部分交付
>
> §四的社交部分由 **M13** 以不同形态交付：`backend/apps/social/` 有 `Post`、
> `Comment`、`Reaction`、`Follow`、`UserProfile` 与 `Visibility` 可见性枚举。
> 但本文档设计的**双向好友关系**（§4.2、§4.4 好友状态机、§7.3 好友上限、
> §7.7 好友申请流程）并未实现——实际走的是单向 `Follow`，没有 `Friend` 模型、
> 没有申请/接受状态机、没有好友数上限。这是**有意的形态差异**，不是待办。
>
> ### 未实现，且不计划实现
>
> §五 抢购系统（Redis Lua、库存、防刷）、§七/§八 灵魂客户端（Flutter/RN）、
> Phase 4 聊天系统——代码库中无对应实现（无 `chat` app，无名额/Lua 相关代码），
> 且按上述定位不再规划。
>
> ---
>
> *以下为 2026-07-30 之前撰写的原文，未作改动，仅作历史参考。*

## 项目愿景

将 SoulLedger 打造成一个完整的灵魂管理生态系统：
- **地府职员端**：现有 Web 管理后台
- **灵魂客户端**：面向普通灵魂的移动/PC 客户端

---

## 一、现状分析

### 1.1 现有系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    SoulLedger 系统                          │
├─────────────────────────────────────────────────────────────┤
│  前端 (Next.js 16)  │  后端 (Django 5 + DRF)              │
│  - Web 管理后台      │  - REST API                         │
│  - TanStack Query   │  - JWT 认证                         │
│  - @xyflow 可视化    │  - 多租户 (CN/EU/EG)                │
│                     │  - Celery 任务队列                   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 现有功能

| 模块 | 状态 | 说明 |
|------|------|------|
| Soul CRUD | ✅ | 灵魂基本管理 |
| State Machine | ✅ | ALIVE→JUDGING→DISPOSED→REINCARNATING→ALIVE |
| Karma System | ✅ | 功德/业力计算 + 时间衰减 |
| Judgment | ✅ | 审判流程 |
| Disposition | ✅ | 判决执行 |
| Reincarnation | ✅ | 轮回管理 |
| Workflow | ✅ | 审批工作流（7种类型） |
| Actors/Realms | ✅ | 角色/领域 |
| Dispatch | ✅ | 跨文明派遣 |
| Audit | ✅ | 审计日志 |
| Multi-tenancy | ✅ | 三界租户 |

### 1.3 待完善功能

- [ ] 审判等待室（排队系统）
- [ ] 审判自动触发
- [ ] 灵魂客户端
- [ ] 转生名额抢购
- [ ] 聊天/朋友圈

---

## 二、死亡信息同步 API

### 2.1 外部系统集成

外部系统（如人间医院、公安系统等）通过 API 同步死亡信息，支持批量操作。

```python
# backend/apps/souls/api/death_sync.py
from rest_framework import routers

router = routers.DefaultRouter()
router.register(r'death-sync', DeathSyncViewSet, basename='death-sync')
```

### 2.2 API 接口文档

#### POST /api/v1/death-sync/batch
批量同步死亡信息

**限制：**
- 每批最多 100 条
- 超过 100 条自动拆分为多个异步任务（Celery）

**请求体：**
```json
{
  "deaths": [
    {
      "source_id": "hospital_001_20260527_001",
      "name": "张三",
      "id_number": "110101199001011234",
      "birth_date": "1990-01-01",
      "death_date": "2026-05-27T10:30:00Z",
      "death_location": "北京市朝阳区医院",
      "civilization": "CN",
      "contact_phone": "13800138000",
      "contact_email": "zhangsan@example.com"
    }
    // ... 最多 100 条
  ]
}
```

**响应（同步，≤100条）：**
```json
{
  "success": true,
  "processed": 2,
  "results": [
    {
      "source_id": "hospital_001_20260527_001",
      "soul_id": "550e8400-e29b-41d4-a716-446655440001",
      "status": "created",
      "message": "Soul created, judgment queued"
    }
  ],
  "errors": []
}
```

**响应（异步，>100条）：**
```json
{
  "success": true,
  "batch_id": "batch_12345",
  "status": "processing",
  "message": "Batch exceeds 100 records, processing asynchronously"
}
```

#### POST /api/v1/death-sync/single
单个死亡信息同步

**请求体：**
```json
{
  "source_id": "police_001_20260527_001",
  "name": "李四",
  "id_number": "310101199505051234",
  "birth_date": "1995-05-05",
  "death_date": "2026-05-27T14:00:00Z",
  "death_location": "上海市公安局",
  "civilization": "CN",
  "death_cause": "意外事故",
  "contact_phone": "13900139000"
}
```

**响应：**
```json
{
  "success": true,
  "soul_id": "550e8400-e29b-41d4-a716-446655440003",
  "status": "created",
  "message": "Soul created, judgment queued"
}
```

#### GET /api/v1/death-sync/status/{source_id}
查询同步状态

**响应：**
```json
{
  "source_id": "hospital_001_20260527_001",
  "soul_id": "550e8400-e29b-41d4-a716-446655440001",
  "soul_name": "张三",
  "sync_status": "completed",
  "judgment_status": "waiting",
  "created_at": "2026-05-27T10:30:05Z"
}
```

### 2.3 认证方式

| 方式 | 说明 |
|------|------|
| API Key | `X-API-Key` header，每个外部系统分配独立 key |
| IP 白名单 | 限制只有白名单 IP 可以调用（通过 `external_api_keys` 表管理） |

**安全要求：**
- `id_number` 等敏感信息需加密传输（HTTPS 强制）
- API Key 仅在 header 中传递，不允许放在请求体
- 支持基于 `source_id` 的幂等性去重

### 2.4 死亡触发流程

```
外部系统 ──POST /death-sync/batch──→ API
                                          │
                                          ▼
                                    创建/更新 Soul
                                          │
                                          ▼
                              自动创建 User 账号
                                          │
                                          ▼
                              发送初始密码（职员告知）
                                          │
                                          ▼
                                    状态 → JUDGING
                                          │
                                          ▼
                              加入审判等待室队列
```

### 2.5 初始密码发放

- 职员手动告知灵魂初始密码（暂无自动化）
- 后期可扩展：发送邮件/短信

---

## 三、实时通知（WebSocket）

### 3.1 通知类型

| 类型 | 触发时机 | 接收方 |
|------|----------|--------|
| `judgment_started` | 审判开始 | 涉案灵魂 |
| `judgment_result` | 审判完成 | 涉案灵魂 |
| `application_approved` | 申请通过 | 申请人 |
| `application_rejected` | 申请被拒 | 申请人 |
| `reincarnation_ready` | 可以投胎 | 灵魂 |
| `spot_released` | 名额释放 | 所有等待中的灵魂 |
| `chat_message` | 新消息 | 接收方 |
| `moment_like` | 朋友圈点赞 | 发布者 |
| `moment_comment` | 朋友圈评论 | 发布者 |

### 3.2 WebSocket 连接

```
连接地址: ws://server/api/v1/ws/notifications/
认证: JWT token 通过 Sec-WebSocket-Protocol header 传递

心跳: 每 30 秒发送 ping
重连: 指数退避 (1s → 2s → 4s → 8s → 16s)，最多 5 次
```

**认证流程：**
1. 客户端先通过 REST API 获取 JWT token
2. 连接时通过 `Sec-WebSocket-Protocol` header 传递 token
3. 服务端验证 token 有效性后建立连接

### 3.3 消息格式

```json
{
  "id": "msg_12345",  // 消息唯一ID，用于去重/ACK
  "type": "notification",
  "event": "judgment_result",
  "version": "1.0",  // 协议版本号
  "data": {
    "soul_id": "550e8400-e29b-41d4-a716-446655440001",
    "judgment_id": "12345",
    "verdict": "PASSED",
    "message": "审判结果已出"
  },
  "timestamp": "2026-05-27T10:30:00Z"
}
```

### 3.4 通知类型（完整）

| 类型 | 触发时机 | 接收方 |
|------|----------|--------|
| `judgment_started` | 审判开始 | 涉案灵魂 |
| `judgment_result` | 审判完成 | 涉案灵魂 |
| `application_approved` | 申请通过 | 申请人 |
| `application_rejected` | 申请被拒 | 申请人 |
| `reincarnation_ready` | 可以投胎 | 灵魂 |
| `spot_released` | 名额释放 | 所有等待中的灵魂 |
| `chat_message` | 新消息 | 接收方 |
| `moment_like` | 朋友圈点赞 | 发布者 |
| `moment_comment` | 朋友圈评论 | 发布者 |
| `friend_request` | 好友申请 | 被申请方 |
| `friend_request_status` | 好友申请状态变更 | 申请方 |
| `system_announcement` | 系统公告 | 所有灵魂 |

---

## 四、数据隔离规则

### 4.1 查看权限

| 资源 | 自己 | 好友（同文明） | 其他人 |
|------|------|------|--------|
| 个人信息（karma、审判结果等） | ✅ 详细 | ❌ | ❌ |
| 基础信息（姓名、状态） | ✅ | ✅ 简单 | ❌ |
| 聊天记录 | ✅ 私聊双方 | ❌ | ❌ |
| 朋友圈动态 | ✅ | ✅ 可见/评论/点赞 | ❌ |
| 朋友圈评论 | ✅ 作者可见 | ✅ 回复可见 | ❌ |

### 4.2 好友关系

- 灵魂可以添加好友
- 好友关系需要双方确认
- **好友上限：500 人**
- **强制同一文明**：不同文明灵魂不能互加好友
- 好友状态：PENDING → ACTIVE / REJECTED / BLOCKED

### 4.3 跨文明规则

| 功能 | 当前版本 | 后期版本 |
|------|----------|----------|
| 好友 | 仅同文明 | 跨文明（待开发） |
| 聊天 | 仅同文明 | 跨文明（待开发） |
| 朋友圈 | 仅同文明 | 跨文明（待开发） |
| 名额抢购 | 各抢各文明的 | - |

### 4.3 朋友圈隐私设置

| 设置 | 说明 |
|------|------|
| 公开 | 所有好友可见 |
| 仅自己可见 | 只有自己能看 |
| 部分可见 | 选择特定好友 |
| 不给谁看 | 排除特定好友 |

**参照微信朋友圈设计**

### 4.4 好友状态机

```
申请 ──→ PENDING ──┬──→ ACTIVE ──→ BLOCKED（拉黑）
                    │
                    └──→ REJECTED
```

**拉黑后：**
- 双向阻断好友关系
- 隐藏朋友圈评论和点赞
- 聊天消息不可见

### 4.5 朋友圈功能

**动态发布：**
- 支持文字 + 图片
- 位置信息（可选）
- @提及好友

**互动：**
- 评论（支持回复）
- 点赞
- 转发

### 4.3 API 示例

```
GET /api/v1/souls/me/                 # 自己的详细信息
GET /api/v1/souls/{id}/               # 别人的详细信息（按权限过滤）
GET /api/v1/souls/{id}/simple/         # 简单信息（好友可见）
GET /api/v1/moments/                   # 朋友圈（好友动态）
POST /api/v1/friends/request/           # 申请好友
```

---

## 五、抢购系统架构

### 5.1 架构决策

**最终方案：Redis 在前，数据库在后**

```
┌─────────┐    ┌─────────┐    ┌─────────┐
│  用户   │ → │  Redis  │ → │   DB    │
│  请求   │    │  库存   │    │  最终   │
│         │    │  原子   │    │  数据   │
└─────────┘    └─────────┘    └─────────┘
```

**理由：**
- Redis 原子操作保证不超卖
- 数据库作为最终数据一致性保障
- 适合常规秒杀场景

### 5.2 实现流程

```
1. 检查 Redis 库存 > 0
2. Redis DECR 原子扣减
3. 扣减成功 → 写入数据库（rush_order）
4. 扣减失败 → 返回"已售罄"
5. 后台 job 定期同步 Redis 和 DB 库存
```

### 5.3 Redis Lua 脚本（保证原子性）

```lua
-- rush_stock.lua
-- 保证检查库存和扣减的原子性
local key = KEYS[1]          -- 库存 key: spot:{id}:stock
local user_key = KEYS[2]     -- 用户已抢购记录: spot:{id}:users
local user_id = ARGV[1]      -- 用户ID
local spot_id = ARGV[2]     -- 名额ID

-- 检查用户是否已抢购
if redis.call('SISMEMBER', user_key, user_id) == 1 then
    return {-2, 'ALREADY_RUSHED'}
end

-- 检查并扣减库存
local stock = redis.call('GET', key)
if not stock or tonumber(stock) <= 0 then
    return {-1, 'SOLD_OUT'}
end

redis.call('DECR', key)
redis.call('SADD', user_key, user_id)
return {1, 'SUCCESS'}
```

### 5.4 异常处理

| 异常场景 | 处理方式 |
|----------|----------|
| Redis 扣减成功但 DB 写入失败 | Celery 回滚 Redis 库存 |
| 抢购后超时未确认 | 15分钟内未确认，释放库存 |
| Redis 与 DB 数据不一致 | 定时对账 + 告警 |

### 5.5 限流与防刷

| 防护 | 实现 |
|------|------|
| 同一用户重复抢购 | Redis Set `spot:{id}:users` 去重 |
| 脚本刷接口 | 图形验证码（后期） |
| API 限流 | 每个用户 1次/秒 |

---

## 六、支付系统（预留）

### 6.1 菜单预留

前端预留支付菜单入口，暂不实现支付功能：

```
我的钱包
├── 充值（暂不可用）
├── 余额（显示 0）
├── 充值记录（暂不可用）
└── 设置（暂不可用）
```

### 6.2 后期扩展

支付系统后期可扩展：
- 功德币充值
- 名额优先权购买
- 特殊服务购买

---

## 七、迁移计划

### 7.1 原则

**保留现有系统，在后面添加新功能**

- 现有数据库表保持不变
- 新功能通过新增表实现
- API 向后兼容

### 7.2 新增表结构

```sql
-- 灵魂账号（独立于现有 User）
-- 注意：Soul 模型主键是 UUID，不是 INT
CREATE TABLE soul_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id INT NOT NULL REFERENCES django_tenants_tenant(id) ON DELETE CASCADE,
    soul_id UUID UNIQUE NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    user_id INT UNIQUE NOT NULL REFERENCES authentication_user(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);

-- 索引
CREATE INDEX idx_soul_accounts_tenant_id ON soul_accounts(tenant_id);
CREATE INDEX idx_soul_accounts_soul_id ON soul_accounts(soul_id);

-- 好友关系
-- 注意：Soul 主键是 UUID，civilization 直接存储字符串值
CREATE TABLE soul_friends (
    id SERIAL PRIMARY KEY,
    soul_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    friend_soul_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    civilization VARCHAR(20) NOT NULL  -- CHINESE/EUROPEAN/EGYPTIAN
        CHECK (civilization IN ('CHINESE', 'EUROPEAN', 'EGYPTIAN')),
    status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'BLOCKED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(soul_id, friend_soul_id)
);

-- 索引
CREATE INDEX idx_soul_friends_soul_id ON soul_friends(soul_id);
CREATE INDEX idx_soul_friends_status ON soul_friends(status);

-- 朋友圈动态
CREATE TABLE soul_moments (
    id BIGSERIAL PRIMARY KEY,
    soul_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    civilization VARCHAR(20) NOT NULL  -- CHINESE/EUROPEAN/EGYPTIAN
        CHECK (civilization IN ('CHINESE', 'EUROPEAN', 'EGYPTIAN')),
    content TEXT,
    images JSONB DEFAULT '[]',
    visibility VARCHAR(20) DEFAULT 'FRIENDS'  -- PUBLIC/SELF_ONLY/FRIENDS/PARTIAL/EXCLUDE
        CHECK (visibility IN ('PUBLIC', 'SELF_ONLY', 'FRIENDS', 'PARTIAL', 'EXCLUDE')),
    visible_to JSONB DEFAULT '[]',  -- 部分可见的好友ID列表
    excluded_from JSONB DEFAULT '[]',  -- 排除的好友ID列表
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,  -- 软删除
    deleted_by UUID REFERENCES souls(id)  -- 删除者
);

-- 索引
CREATE INDEX idx_soul_moments_soul_id ON soul_moments(soul_id);
CREATE INDEX idx_soul_moments_created_at ON soul_moments(created_at DESC);
CREATE INDEX idx_soul_moments_civilization ON soul_moments(civilization);

-- 朋友圈评论
CREATE TABLE soul_moment_comments (
    id BIGSERIAL PRIMARY KEY,
    moment_id BIGINT NOT NULL REFERENCES soul_moments(id) ON DELETE CASCADE,
    soul_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    parent_comment_id BIGINT REFERENCES soul_moment_comments(id) ON DELETE CASCADE,
    root_comment_id BIGINT,  -- 根评论ID，用于快速查询二级回复
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES souls(id)
);

-- 索引
CREATE INDEX idx_soul_moment_comments_moment_id ON soul_moment_comments(moment_id);
CREATE INDEX idx_soul_moment_comments_root_comment_id ON soul_moment_comments(root_comment_id);

-- 聊天消息
CREATE TABLE chat_messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    sender_civilization VARCHAR(20) NOT NULL,
    receiver_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    receiver_civilization VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ  -- 软删除
);

-- 索引
CREATE INDEX idx_chat_messages_sender_id ON chat_messages(sender_id);
CREATE INDEX idx_chat_messages_receiver_id ON chat_messages(receiver_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at DESC);

-- 转生名额（按文明隔离）
-- 注意：Realm 主键是 UUID，civilization 使用完整值
CREATE TABLE reincarnation_spots (
    id SERIAL PRIMARY KEY,
    civilization VARCHAR(20) NOT NULL  -- CHINESE/EUROPEAN/EGYPTIAN
        CHECK (civilization IN ('CHINESE', 'EUROPEAN', 'EGYPTIAN')),
    realm_id UUID NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
    quantity INT NOT NULL CHECK (quantity >= 0),
    released_at TIMESTAMPTZ NOT NULL,
    deadline TIMESTAMPTZ NOT NULL,
    conditions JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'SOLD_OUT', 'EXPIRED')),
    version INT DEFAULT 0  -- 乐观锁版本号
);

-- 索引
CREATE INDEX idx_reincarnation_spots_civilization_status ON reincarnation_spots(civilization, status);
CREATE INDEX idx_reincarnation_spots_deadline ON reincarnation_spots(deadline);

-- 抢购订单
CREATE TABLE rush_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    soul_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    spot_id INT NOT NULL REFERENCES reincarnation_spots(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED')),
    position INT CHECK (position > 0),  -- 排队位置，必须为正
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,  -- 超时过期时间
    UNIQUE(soul_id, spot_id)  -- 防止重复抢购
);

-- 索引
CREATE INDEX idx_rush_orders_soul_id ON rush_orders(soul_id);
CREATE INDEX idx_rush_orders_status ON rush_orders(status);

-- 外部系统 API Key（死亡同步用）
CREATE TABLE external_api_keys (
    id SERIAL PRIMARY KEY,
    system_name VARCHAR(100) NOT NULL,
    api_key VARCHAR(64) NOT NULL UNIQUE,
    allowed_ips JSONB DEFAULT '[]',  -- IP白名单
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 通知偏好设置
CREATE TABLE notification_preferences (
    id SERIAL PRIMARY KEY,
    soul_id UUID NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
    civilization VARCHAR(20) NOT NULL
        CHECK (civilization IN ('CHINESE', 'EUROPEAN', 'EGYPTIAN')),
    judgment_started BOOLEAN DEFAULT TRUE,
    judgment_result BOOLEAN DEFAULT TRUE,
    application_approved BOOLEAN DEFAULT TRUE,
    application_rejected BOOLEAN DEFAULT TRUE,
    reincarnation_ready BOOLEAN DEFAULT TRUE,
    spot_released BOOLEAN DEFAULT TRUE,
    chat_message BOOLEAN DEFAULT TRUE,
    moment_like BOOLEAN DEFAULT TRUE,
    moment_comment BOOLEAN DEFAULT TRUE,
    friend_request BOOLEAN DEFAULT TRUE,
    system_announcement BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(soul_id)
);

-- 索引
CREATE INDEX idx_notification_preferences_soul_id ON notification_preferences(soul_id);
```

### 7.3 好友上限实现

```python
# 好友上限强制执行
class Soul:
    MAX_FRIENDS = 500
    
    def add_friend(self, friend_soul_id: UUID) -> None:
        # 检查好友数量
        active_friends = SoulFriends.objects.filter(
            soul_id=self.id,
            status='ACTIVE'
        ).count()
        
        if active_friends >= self.MAX_FRIENDS:
            raise FriendLimitExceeded(
                code='FRIEND_LIMIT_EXCEEDED',
                message=f'好友数量已达上限({self.MAX_FRIENDS})',
                current_count=active_friends
            )
        
        # 创建好友关系...
```

### 7.4 朋友圈可见性判断

```python
def is_moment_visible(moment: SoulMoment, viewer_soul_id: UUID) -> bool:
    """判断动态对某用户是否可见"""
    # 自己永远可见
    if viewer_soul_id == moment.soul_id:
        return True

    # 仅自己可见
    if moment.visibility == 'SELF_ONLY':
        return False

    # 公开：所有好友可见
    if moment.visibility == 'PUBLIC':
        return is_friend(moment.soul_id, viewer_soul_id)

    # 好友可见（默认）：所有好友可见
    if moment.visibility == 'FRIENDS':
        return is_friend(moment.soul_id, viewer_soul_id)

    # 部分可见：必须在 visible_to 中且不在 excluded_from 中
    if moment.visibility == 'PARTIAL':
        visible_ids = moment.visible_to or []
        excluded_ids = moment.excluded_from or []
        return (viewer_soul_id in visible_ids
                and viewer_soul_id not in excluded_ids)

    # 不给谁看：不能在 excluded_from 中
    if moment.visibility == 'EXCLUDE':
        excluded_ids = moment.excluded_from or []
        return viewer_soul_id not in excluded_ids

    return False
```

### 7.5 朋友圈评论可见性规则

```
评论可见性规则：
1. 根评论（parent_comment_id = NULL）：
   - 作者本人、所有好友可见
   
2. 二级回复（parent_comment_id != NULL, root_comment_id = NULL）：
   - 评论者本人 + 被回复者 + 动态作者可见
   
3. 三级及以上（root_comment_id != NULL）：
   - 评论者本人 + 被回复者（root_comment 的作者）可见

示例：
- A 发根评论 → C（好友）可见，B（好友）可见
- B 回复 A 的根评论 → A 和 B 可见，C 不可见
- D 回复 B 的评论 → B 和 D 可见，A 和 C 不可见
```

### 7.6 软删除处理规则

```python
# 评论软删除逻辑
class SoulMomentComment:
    def soft_delete(self, deleted_by: Soul) -> None:
        """
        删除规则：
        1. 如果有子回复，标记为"[评论已删除]"而非真的删除
        2. 如果没有子回复，直接软删除
        """
        has_replies = SoulMomentComment.objects.filter(
            parent_comment_id=self.id
        ).exists()
        
        if has_replies:
            self.content = '[评论已删除]'
            self.deleted_at = now()
            self.deleted_by = deleted_by.id
            self.save()
        else:
            self.deleted_at = now()
            self.deleted_by = deleted_by.id
            self.save()

# 朋友圈软删除
class SoulMoment:
    def soft_delete(self, deleted_by: Soul) -> None:
        # 保留评论，标记动态已删除
        # 评论查询时显示"该动态已删除"
        self.deleted_at = now()
        self.deleted_by = deleted_by.id
        self.save()
```

### 7.7 好友申请流程

```python
# API: POST /api/v1/friends/request/
class FriendRequestAPI:
    """
    好友申请流程：
    1. A 申请加 B 为好友
    2. B 收到 WebSocket 通知 (friend_request)
    3. B 接受/拒绝
    4. A 收到 WebSocket 通知 (friend_request_status)
    """
    
    def create_request(self, request):
        body = {
            "target_soul_id": "uuid",
            "message": "想认识你"  # 可选申请留言
        }
        
        # 检查是否已在 PENDING 状态
        existing = SoulFriends.objects.filter(
            soul_id=self.soul.id,
            friend_soul_id=body.target_soul_id,
            status='PENDING'
        ).first()
        
        if existing:
            raise AlreadyPendingError()
        
        # 检查目标用户是否已达到上限
        target_count = SoulFriends.objects.filter(
            soul_id=body.target_soul_id,
            status='ACTIVE'
        ).count()
        
        if target_count >= 500:
            raise FriendLimitExceeded()
        
        # 创建申请
        friendship = SoulFriends.objects.create(
            soul_id=self.soul.id,
            friend_soul_id=body.target_soul_id,
            civilization=self.soul.civilization,
            status='PENDING'
        )
        
        # 发送 WebSocket 通知
        send_websocket_notification(
            target_soul_id=body.target_soul_id,
            event='friend_request',
            data={'friendship_id': friendship.id}
        )
        
        return {
            "status": "PENDING",
            "expires_at": now() + timedelta(days=3),  # 3天过期
            "can_resend_after": None
        }
```

### 7.8 Civilization 值参考

```python
# 现有模型定义（必须保持一致）
class Civilization(models.TextChoices):
    CHINESE = "CHINESE", "Chinese Diyu"
    EUROPEAN = "EUROPEAN", "European Heaven/Hell"
    EGYPTIAN = "EGYPTIAN", "Egyptian Duat"

# 所有表中的 civilization 字段必须使用上述值
# 不要使用短代码：CN/EU/EG ❌
# 必须使用完整值：CHINESE/EUROPEAN/EGYPTIAN ✓
```

---

## 七、灵魂客户端设计

### 7.1 账号体系

```
灵魂生命周期：
┌──────────────┐    死亡    ┌──────────────┐   审判   ┌──────────────┐
│   存活状态    │ ────────→ │   待审状态    │ ───────→ │  已判决状态   │
│ (无账号)     │            │  (自动建账)   │          │              │
└──────────────┘            └──────────────┘          └──────────────┘
                                                           │
                                                           ▼
                                                      ┌──────────────┐
                                                      │  转世/惩罚   │
                                                      └──────────────┘
```

**账号创建流程：**
1. 外部系统同步死亡信息 或 地府职员手动标记死亡
2. 自动创建 User 账号（username = soul_id）
3. 发送初始密码到预留联系方式（后期扩展）
4. Soul 状态变为 JUDGING

### 7.2 灵魂客户端功能

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 登录/注册 | P0 | JWT 认证，支持手机号/邮箱 |
| 查看 karma | P0 | 功德/业力详情，衰减预览 |
| 审判结果 | P0 | 查看审判结果、判决书 |
| 申请转世 | P0 | 选择目标realm、时间段 |
| 抢购转生名额 | P1 | 秒杀倒计时、库存显示 |
| 审批进度 | P1 | 查看申请处理进度 |
| 聊天 | P2 | 灵魂间私聊 |
| 朋友圈 | P3 | 动态发布 |

### 7.3 灵魂客户端技术选型

**移动端方案：**
| 方案 | 优点 | 缺点 |
|------|------|------|
| React Native | 代码复用，生态成熟 | 性能一般 |
| Flutter | 性能好，跨平台 | 生态较弱 |
| Tauri + React | Web技术，原生体验 | 包较大 |
| Next.js PWA | 开发最快，可离线 | 体验最差 |

**推荐：Flutter 或 React Native**

**API 设计：**
```
GET    /api/v1/souls/me/              # 获取当前灵魂信息
GET    /api/v1/souls/me/karma/        # 获取karma详情
GET    /api/v1/souls/me/judgment/     # 获取审判结果
POST   /api/v1/souls/me/rebirth-apply/    # 申请转世
GET    /api/v1/reincarnation/spots/       # 可抢购名额
POST   /api/v1/reincarnation/rush/         # 抢购名额
GET    /api/v1/chat/messages/          # 消息列表
POST   /api/v1/chat/messages/          # 发送消息
```

---

## 八、转生名额抢购系统

### 3.1 名额管理

```python
class ReincarnationSpot:
    civilization: str      # CHINESE/EUROPEAN/EGYPTIAN
    realm_type: str         # HELL/PURGATORY/BLISS/NEUTRAL
    target_realm: FK       # 具体目标领域
    quantity: int           # 名额数量
    release_time: datetime # 开放时间
    deadline: datetime      # 截止时间
    conditions: JSON       # 准入条件 {min_karma: 100, max_sins: 5}
    status: str            # PENDING/ACTIVE/SOLD_OUT/EXPIRED
```

### 3.2 抢购流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  查看名额   │ →  │  条件校验   │ →  │   抢购     │ →  │   确认     │
│  (倒计时)   │    │  (karma等)  │    │  (库存扣减) │    │  (占坑)    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                        ↓                              ↓
                   不满足条件                       抢购失败
                   (提示原因)                    (名额已满)
```

### 3.3 关键技术问题

| 问题 | 解决方案 |
|------|----------|
| 库存超卖 | Redis 原子操作 + 乐观锁 |
| 高并发 | Celery 异步处理 + 消息队列 |
| 公平性 | 排队队列 + 先到先得 |
| 黄牛党 | 实名绑定 + 人脸识别（后期） |
| 限流 | API 限流 + 验证码 |

### 3.4 API 设计

```
GET    /api/v1/reincarnation/spots/
       ?civilization=CHINESE&date=2026-06-01
       Response: {spots: [{id, realm, quantity, release_time, conditions}]}

POST   /api/v1/reincarnation/rush/
       Body: {spot_id, target_realm_id}
       Response: {success, position, wait_time}
```

---

## 九、审批流程扩展

### 9.1 审批类型

| 类型 | 发起方 | 说明 |
|------|--------|------|
| 转世申请 | 灵魂 | 需要满足条件 |
| 惩罚减免 | 灵魂 | 申请减少惩罚 |
| 特殊转世 | 职员 | 特批转世 |
| 跨文明派遣 | 职员 | 跨租户转移 |
| 名额申诉 | 灵魂 | 抢购失败申诉 |

### 9.2 审批状态

```
PENDING → APPROVED → EXECUTED
   ↓         ↓
 REJECTED   CANCELLED
```

### 9.3 灵魂查看进度

```
GET /api/v1/souls/me/applications/
Response: [{
  id, type, status, created_at,
  current_node: {name, approver},
  timeline: [{node, status, decided_at, notes}]
}]
```

---

## 十、实施路线图

### Phase 1: 基础建设
- [ ] 审判等待室/排队系统
- [ ] 死亡自动创建账号
- [ ] 基础 API 扩展

### Phase 2: 灵魂客户端 MVP
- [ ] Flutter/RN 项目搭建
- [ ] 登录/注册
- [ ] 查看 karma、审判结果
- [ ] 申请转世

### Phase 3: 抢购系统
- [ ] 名额管理后台
- [ ] 抢购 API
- [ ] 库存管理
- [ ] 条件校验

### Phase 4: 高级功能
- [ ] 聊天系统
- [ ] 朋友圈
- [ ] 实时通知

---

## 十一、技术债务

### 11.1 需要重构

- [ ] 统一错误处理
- [ ] API 版本管理
- [ ] 缓存策略优化
- [ ] 单元测试覆盖率

### 11.2 安全加固

- [ ] Rate Limiting
- [ ] 输入验证加强
- [ ] SQL 注入防护
- [ ] CORS 细化配置

### 11.3 性能优化

- [ ] 数据库索引优化
- [ ] Redis 缓存
- [ ] CDN 静态资源
- [ ] 分页优化

---

## 十二、辩论议题

### 议题1: 客户端技术选型
- **正方**: Flutter - 性能好，原生体验
- **反方**: React Native - 开发效率，代码复用

### 议题2: 抢购系统架构
- **正方**: Redis 原子操作 - 性能优先
- **反方**: 数据库事务 - 数据一致性优先

### 议题3: 账号体系
- **正方**: 独立 soul_accounts 表 - 隔离性好
- **反方**: 复用现有 User 模型 - 简单直接

---

*最后更新: 2026-05-27*
*审查更新: 2026-05-27 - 修复数据库表结构问题（UUID类型、Civilization值、CHECK约束、索引）*
*审查更新: 2026-05-27 - 补充好友上限实现、朋友圈可见性算法、评论可见性规则、软删除处理*
