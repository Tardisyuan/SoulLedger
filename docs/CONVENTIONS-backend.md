# 后端开发准则 — SoulLedger

> **成文日期 2026-09-06。** 这份文件汇总当天散在 `CLAUDE.md`、根 `AGENTS.md`、
> `backend/AGENTS.md`、`CONTRIBUTING.md`、`docs/CONVENTIONS.md`、`docs/ARCHITECTURE.md`、
> `docs/API.md` 与代码本身里的后端约定，并**逐条标注它有没有执法机制**。
>
> 它取代 `docs/CONVENTIONS.md` 的 `# Backend Conventions` 一节。前端见
> [`CONVENTIONS-frontend.md`](CONVENTIONS-frontend.md)。

## 怎么读这份文件

每条规则后面的方括号是**执法机制**，这是本文件唯一重要的信息：

- `[ruff]` / `[test:xxx]` / `[hook]` / `[CI]` — 违反会红，可以信赖
- `[settings]` — Django 启动时抛异常
- `[文字]` — **没有任何东西检查它**。它是一句愿望，不是一道门
- `[多数派 n/m]` — 不是规则，是现状统计；照它写不会有人拦你，不照也不会

带【实跑】的数字是 2026-09-06 在本机执行得到的，命令在文末第 11 节。其余为 grep 计数。

**三件影响全部读法的前提：**

1. **CI 不自动跑。** `.github/workflows/ci.yml:7-8` 与 `security.yml:7-8` 都只剩
   `workflow_dispatch`。凡标 `[CI]` 的都是"有人手动点了才跑"。
2. **真正每次都跑的是 `.git/hooks/pre-push`**，且仅在跑过 `scripts/install-hooks.sh`
   的机器上，`SKIP_PREPUSH=1` 可绕过（`.git/hooks/pre-push:18-27`）。
3. **`.pre-commit-config.yaml` 整份是死的。** `pre-commit` 框架不在 PATH，
   `.git/hooks/pre-commit` 是 `install-hooks.sh` 写的手写 bash。它声明的
   `ruff --fix` + `ruff-format`（`.pre-commit-config.yaml:12-19`）**从未执行过** ——
   【实跑】`ruff format --check .` → **622 files would be reformatted, 78 already
   formatted**，exit 1。

---

## 1. 环境（先读这节，否则下面的命令都跑不了）

`CLAUDE.md` 里的后端命令写的 `python` / `ruff` / `pip-audit` **在这台机器上不是你要的那个**。
`python` 若解析到 anaconda base，`python -m pytest` 会 exit 4 报
`ModuleNotFoundError: No module named 'django'` —— 那句话指向"缺依赖"，真实原因是
"解释器选错了"。

本机正确值在 gitignored 的 `.prepush.env`：

```
PYTHON_BIN="/opt/anaconda3/envs/vision/bin/python"
RUFF_BIN="/opt/anaconda3/bin/ruff"
```

pre-push 从这里读，复制粘贴的命令没有这一层。跑任何后端命令前先问一句：

```bash
/opt/anaconda3/envs/vision/bin/python -c "import django; print(django.VERSION)"
```

**不要 `source .prepush.env`** 去查 115 上的残留库：它会把 `DATABASE_URL` 覆写成
SQLite，探针于是连本地 socket，失败在"连不上"而不是"查不到"。

---

## 2. 分层与目录

| 规则 | 出处 | 执法 |
|---|---|---|
| 19 个本地 app 在 `INSTALLED_APPS` | `config/settings.py:64-82` | — |
| `apps.core` **不在** `INSTALLED_APPS`，只装 mixin / middleware / permission | `settings.py:64-82` | — |
| 一个 app 必有 `models.py` / `serializers.py` / `views.py` / `urls.py` | 20/20 app 实况 | `[多数派 20/20]` |
| `services.py` 装被两处以上调用的业务规则 | `apps/judgment/services.py:20-28` 写了理由 | `[多数派 11/19]`，`[文字]` |
| 业务逻辑不放 ViewSet、不放胖 serializer | `docs/CONVENTIONS.md:9-10,21-23`；`CONTRIBUTING.md:31-32` | **`[文字]`**。`apps/authentication/views.py` 730 行 |
| 领域逻辑归属：CONTRIBUTING 说 Model，CONVENTIONS 说 Service | 见 §9 矛盾 #1 | `[文字]` |
| 文件 ≤500 行**代码**（注释不计），拆分需要缺陷理由 | `CLAUDE.md:11-26` | **`[文字]`**，CLAUDE.md 自述"applied by eye"。范本是 `apps/actors/mythology/realms.py:16-29`（844 行，**拒绝拆分**并写明理由） |

**命名空间包陷阱（会造成静默假绿）：** `apps/authentication`、`apps/core`、
`apps/death_sync` **没有 `__init__.py`**，`pkgutil.iter_modules` 会静默跳过它们。
`apps/perm/test_codename_coverage.py:18-23` 记录了因此漏掉 `UserViewSet` 的事故。
**所有元测试因此都改成走 URLconf 而不是遍历模块** —— 新写元测试照此办理。

**已跟踪的产物文件**（与 `CLAUDE.md:8` 矛盾，`.gitignore:10` 只挡 `*.sqlite3`）：
`backend/coverage.json`（816KB）、`backend/coverage_summary.json`（646KB）、
`backend/test.db`（0 字节）。【实跑】`git ls-files backend | grep -E 'coverage.*json|\.db$'` 三条命中。

---

## 3. 多租户与权限 —— 这是本仓库唯一有全量守卫的领域

### 3.1 核心事实：ORM 层没有兜底

`TenantManager.get_queryset()` **只加 `is_deleted=False`，不按租户过滤**
（`apps/tenants/managers.py:35-53`）。隔离**全部**在视图层通过
`apps/core/tenant.py::scope_to_tenant` 完成（`tenant.py:12-16` 写明"The call sites
are the whole of the isolation"）。

四份文档仍在说"TenantManager 自动过滤"（见 §9 矛盾 #2）。**以代码为准。**

### 3.2 五道执法

| 层 | 实现 | 执法 |
|---|---|---|
| 1. 请求 | `TenantMiddleware` 从 JWT `tenant_code` claim 解析并 `set_current_tenant`（`apps/tenants/middleware.py:23-34,58-81`）；中间件顺序 `settings.py:95-96` | `[test:test_tenant_middleware]`、`[test:test_request_context_middleware]` |
| 2. HTTP | `TenantPermission`：非 ADMIN 必须有 `request.tenant` 且 `== user.tenant_id`；对象层**区分"模型无 tenant 列"与"列为 NULL"**（`apps/core/permissions.py:86-168`） | `[test:test_object_permission_tells_the_two_nulls_apart]`。**无**"每个 viewset 都挂 TenantPermission"的全量守卫 |
| 3. 码名 | `CodenamePermission` → `CodenameViewSetMixin.get_required_permissions()`（`apps/core/viewsets.py:42-61`）→ `apps/perm/checker.py:18-84` | 三道：`[test:test_codename_coverage]`、`[test:test_declared_codenames_are_enforced]`、`[test:test_every_codename_family_is_claimed]` |
| 4. queryset | `scope_to_tenant`（`apps/core/tenant.py:48-106`）：未认证 → `qs.none()`、ADMIN 直通、无 tenant → `qs.none()` | **`[test:test_tenant_scoping_contract]`** — 走真实 URLconf，静态检查每个 `get_queryset` 源码里是否调了 helper |
| 5. 行/字段 | `DataScopeFilter`（`apps/perm/filters.py:8-63`）；`FieldPermissionMixin`（`apps/core/field_permissions.py:53-101`） | 逐端点测试 |

**硬规则：fail closed。** 没有租户就是 `qs.none()`，不是"返回全部"。
**ADMIN 是唯一全局角色**（`apps/core/tenant.py:19-27`）。

### 3.3 已知缺口（不是待办，是读这份文件时要知道的）

- `test_tenant_scoping_contract` 自述只检查 `get_queryset` 源码里调了 helper，
  **不覆盖 `@action` 与写路径**（`:24-30`）。写侧一致性靠 serializer 手写
  （`apps/social/serializers.py:276-283`）。
- `permission_codename = None` 的视图**不在任何码名守卫内**。
  【实跑】`grep -rn "permission_codename = None" apps | wc -l` → **10**。
  （同一件事此前有三个数字：`test_tenant_scoping_contract.py` 的注释写"nine"，
  一次审计数到 8，实跑是 10。**2026-09-06 把那条注释里的计数整个删掉，改成让人去 grep**
  —— 没有任何东西断言这个数，手写的计数就会漂移，而漂移后的读起来和新鲜的一模一样。
  同样的处理也用在了 `eslint.config.mjs` 的基线条目数上。）
- `AllowAny` 覆写 5 处，全在 `apps/authentication/views.py:440,503,544,639,687`，
  **无 allowlist 守卫**。
- 跨租户返回 404 而非 403（根 `AGENTS.md:199`）—— `[test:test_tenant_isolation:77-96]`
  只覆盖 souls 与 ledger 两个端点。
- `perform_create` 必须设 tenant（根 `AGENTS.md:198`）—— **无全量守卫**。

### 3.4 ADMIN 判定有两种写法

正规写法 `is_tenant_exempt(user)`（`apps/core/tenant.py:37-45`）只用了 4 处；
字面比较 `getattr(user, 'role', None) == 'ADMIN'` 有 ≥12 处
（`apps/core/permissions.py:100,129,179`、`apps/dispatch/permissions.py:67,86`、
`apps/ledger/views.py:243`、`apps/reincarnation/views.py:192,206`）。`[文字]`

---

## 4. 模型

| 规则 | 出处 | 执法 |
|---|---|---|
| 继承 `AuditUserFields`（自带 create/update user+time、`version`、软删五字段） | `apps/core/models.py:11-75`；`soft_delete.py:32-51` | `[多数派]`【实跑】**38 个**继承；裸 `models.Model` 5 处，其中 2 个是 mixin，真正的例外是 `perm.RowLevelDataScope:412`、`perm.FieldPermission:467`、`social.UserProfile:288` |
| 参与审判流程的再叠 `ArchivableMixin` | `apps/core/archive.py:32`；souls / judgment / disposition | `[多数派 3/3]` |
| tenant FK 写法 `ForeignKey("tenants.Tenant", on_delete=CASCADE, related_name=...)` | `apps/souls/models.py:254-259` | `[多数派]`。`null=True` 18/25；非空的是 social 4 表 + death_sync 3 表 |
| 声明 `all_objects` 在前、`objects = TenantManager()` 在后（前者要当 `_base_manager`） | `apps/judgment/models.py:89-90` | `[多数派 13]`，注释即理由 |
| **软删模型的唯一约束必须带 `condition=Q(is_deleted=False)`** | `apps/judgment/models.py:446-459` | **`[test:test_soft_delete_frees_unique_keys]`** — 枚举所有可软删模型 |
| `__str__` 单行 f-string | 40/40 模型 | `[多数派 40/40]` |
| choices 用 `TextChoices`，模块级定义 | `apps/souls/models.py:19,121` | `[多数派 30]`；少数派：内联元组 5 处、类属性 `*_CHOICES` 2 处 |
| 主键 UUID | 27 处显式 | `[多数派]`；audit/authentication/menus/notifications/tenants/perm 三表走 `BigAutoField` |
| 迁移与模型必须同步 | — | **`[hook]` + `[CI]`** `makemigrations --check --dry-run`。注释（`pre-push:136-138`）说明它能抓 `choices` 少一项这类测试抓不到的变化 |
| 数据迁移可逆，且逆向只撤自己写的 | `tests/migration_roundtrip.py:1-15` | `[test:test_migration_reverse_scope]` —— **只覆盖 4 个点名的迁移**，无"每个 RunPython 都可逆"的枚举 |

**时间戳双轨（现存不一致）：** 基类给了 `create_time/update_time`，但 11 处模型又自加
`created_at`，于是 `ordering` 分裂成 `-create_time`（12 处）与 `-created_at`（5 处）。

---

## 5. Serializer

| 规则 | 出处 | 执法 |
|---|---|---|
| `fields` 永远显式列表 | 90 处 `fields = [...]`，**0 处 `"__all__"`，0 处 `exclude`** | `[多数派 90/90]` |
| 读 / 写 / 列表拆成不同类，view 里 `get_serializer_class()` 按 `self.action` 切 | `apps/social/serializers.py:12,47,56`；`apps/souls/views.py:126-129` | `[多数派]` |
| 动作载荷用裸 `serializers.Serializer` | `apps/judgment/serializers.py:121` | `[多数派]` |
| `SerializerMethodField` 必配 `@extend_schema_field` 或返回类型标注 | 17 处 | `[test:test_schema_has_no_warnings]`（间接） |
| **doc-only serializer 只用具型字段，不用裸 `SerializerMethodField`** | `apps/core/schema.py:1-20` | `[test:test_schema_has_no_warnings]` |
| 写逻辑不放 serializer | `create()` 仅 2 处、`update()` **0 处** | `[多数派]` |

**校验三层并存，各有其位：**
- 字段级 `validate_<x>`（17 处）—— 格式与存在性
- 对象级 `validate(attrs)`（13 处）—— 跨字段 + **写侧租户一致性**
  （`apps/social/serializers.py:276-283`，且明确**不给 ADMIN 开口子**`:261`）
- service —— 被两处以上调用的规则（`apps/judgment/services.py:20-28` 写了理由）

---

## 6. ViewSet 与 API

### 6.1 骨架

```python
class XViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    queryset = X.objects.select_related(...).all()
    serializer_class = XSerializer
    permission_classes = [TenantPermission, CodenamePermission]   # 多数派 19 处
    permission_codename = "x"
    extra_permissions = {"approve": ["x.approve"]}
    filterset_class = XFilter
    search_fields = XFilter.search_fields
    ordering_fields = XFilter.ordering_fields
```

`AuditUserViewSetMixin` 20 个可写 ViewSet **全挂**，且有全量守卫
`[test:test_every_writable_audit_viewset_sets_the_user]`（EXEMPT 为空）。

### 6.2 API 约定

| 规则 | 出处 | 执法 |
|---|---|---|
| 版本前缀 `/api/v1/`，health 在前缀外 | `config/urls.py:27-43` | `[文字]`（无"所有路由都在 v1 下"的断言） |
| 默认 `JWTAuthentication` + `IsAuthenticated` | `settings.py:212-217` | `[settings]`（DRF 全局默认） |
| 分页 `PageNumberPagination`，`PAGE_SIZE = 20` | `settings.py:201-202` | **`[test:test_frontend_page_size]`** — 读前端 `client.ts` 的字面量与 settings 比对 |
| 码名格式 `<resource>.<action>`；未知 `@action` 默认**拒绝** | `apps/core/viewsets.py:8-15,56-58` | `[test]` 三道（见 §3.2） |
| 限流：anon 60/min、register 5/h、login 10/min、password_reset 3/5min | `settings.py:218-226` | `[test:test_rate_limiting]`、`[test:test_api_key_rate_limit_is_enforced]` |
| `@extend_schema` 叠在 `@action` 之上 | 63 处分布在 12/19 个 views.py | `[test:test_schema_has_no_warnings]`（间接） |

### 6.3 OpenAPI 是前端类型的来源 —— 四道门

1. `[test:test_schema_has_no_warnings]` —— **warning 与 error 都必须为 0**。
   注意这是两个通道，`grep -i warning` 看不见 error。
2. `[test:test_committed_schema_matches_the_backend]` —— `packages/core/openapi/schema.yml`
   必须逐字节等于生成结果。
3. `[test:test_the_schema_does_not_record_its_own_database]` + `settings.py:376-379`
   的 `drop_engine_dependent_integer_bounds`。
4. `[test:test_declared_response_shapes_match_the_views]` —— 声明的响应体必须与
   `return Response(...)` 一致，**读不懂的返回算失败**。

### 6.4 错误响应：没有统一形状，且这是明知的

**没有自定义 `EXCEPTION_HANDLER`。** `apps/core/schema.py:24-38` 记录了两种形状并存
并**决定不统一**。【实跑】计数：

- `{"error": "<句子>"}` — **79** 处（多数派）
- `{"detail": "..."}` — **13** 处
- `{"error": "<CODE>", "message": ...}` — 8 处（ledger 6、reincarnation 2）

状态码语义是有共识的：状态机拒绝 **409**、输入问题 **400**、跨租户/不存在统一 **404**（不给 403）。

**异常翻译在 view**：service 抛领域异常（`CitationRefusedError` 等），view `try/except`
转 `Response`（`apps/judgment/views.py:361-372`）。view 层 `raise ValidationError` 仅 1 处。

---

## 7. Celery

```python
@shared_task(name="ledger.recalculate_all")          # name 显式，它是数据（beat 表里存的）
def recalculate_all():
    for (tenant_id,) in Tenant.objects.filter(is_active=True).values_list("id"):
        recalculate_for_tenant.delay(str(tenant_id))
    return {"tenants_dispatched": n, "timestamp": ...}

@shared_task(name="ledger.recalculate_for_tenant")
def recalculate_for_tenant(tenant_id):
    from apps.ledger.models import X                  # import 在函数体内（20/20 处）
    tenant = Tenant.objects.get(id=tenant_id)
    set_current_tenant(tenant)
    try:
        ... X.objects.filter(tenant_id=tenant_id) ... # 查询靠显式 filter，不靠 contextvar
    finally:
        clear_current_tenant()
```

**两级扇出**是硬约定（`apps/ledger/tasks.py:15-35`、`apps/judgment/tasks.py:10-29`、
`apps/death_sync/tasks.py:60-74`）。contextvar **只为** `apps/audit/signals.py:153,335,486`
的归因服务 —— `apps/judgment/tasks.py:44-49` 的注释写明了这点。`[文字]`（无全量守卫）

`apps/events/tasks.py` 不设 contextvar，重试走 `bind=True, max_retries` +
`raise self.retry(countdown=2 ** attempt)`，放弃走状态字段 `ABANDONED`。

**celery beat 没有部署** —— 五个定时任务没有调用点是因为还没有生产，不是缺陷。

---

## 8. 测试

### 8.1 怎么跑

**用 `pytest`，不是 `manage.py test`** —— Django runner 收不到 774 条模块级函数
（根 `AGENTS.md:225-229`）。配置在**仓库根** `pytest.ini`（`:2-3` `pythonpath = backend`）。

```bash
# 两个后端服务都要隔离。.env 把 DATABASE_URL 和 REDIS_URL 都指向共享的 115。
# 只覆盖数据库，测试仍会把权限缓存键写进真 Redis（2026-08-27 实测）。
redis-server --port 6399 --daemonize yes --save '' --appendonly no
cd backend && DATABASE_URL="sqlite:///:memory:" REDIS_URL="redis://127.0.0.1:6399/0" \
  CELERY_BROKER_URL="redis://127.0.0.1:6399/1" CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" \
  /opt/anaconda3/envs/vision/bin/python -m pytest --tb=short -q
```

**SQLite 藏起一整类缺陷，而这套测试默认只在 SQLite 上跑。** 两条已发货的 bug 是在
第一次接触真 PostgreSQL 时（2026-08-27）暴露的，当时 2665 条测试全绿：

- 失败语句在 PG 上**中止整个事务**，在 SQLite 上不会。于是 `except Exception: pass`
  包住一条查询，在测试里是 no-op，在迁移里是杀手（`apps/perm/migrations/0017`）。
- `varchar(n)` 长度在 PG 上**强制**，SQLite 忽略。`Statute.source` 是 `CharField(500)`
  而 `INFERNO_SOURCE` 有 524 字符，从语料落地那天起就是错的。

两条都**不可能**在 SQLite 上测出来。碰事务、约束、列宽之前，先在 PG 上跑一遍：

```bash
cd backend && /opt/anaconda3/envs/vision/bin/python -m pytest -q --no-cov --create-db
```

`--create-db` 是必需的：陈旧的 `test_soulledger` 会造成上千条"环境错误"。

`tests/test_concurrency.py` 里 4 条 `skipif(SQLITE)` 是全仓唯一真正检验
`select_for_update` 的东西，SQLite 路径一条都不跑。
`test_the_postgres_only_set_is_the_set_we_think_it_is` 用 AST 钉住这个集合，
防它无声增长。

### 8.2 放哪儿、怎么写

三种形态并存，`[test:test_collection_scope]` 用 300/900/1900 三个下限守着：

- `backend/tests/test_*.py`（169 项）—— 新测试的默认去处
- `backend/apps/*/tests.py`（12 个 Django 风格模块）—— **仅因** `pytest.ini:11` 列了
  裸 `tests.py` 才被收集
- `backend/apps/*/test_*.py` 与 `apps/social/tests/` 包

fixture：全局在 `tests/conftest.py:13-152`（`api_client`、`cn_tenant`/`eu_tenant`、
四种角色用户、`auth_headers`，以及 **autouse 的 `_clear_tenant_context`**）。

**认证两种，差别是实质性的：**
- 真 JWT + `tenant_code` claim（117 处）—— 走完整中间件
- `force_authenticate`（105 处）—— **不经过 TenantMiddleware**，`request.tenant` 为 None

**租户隔离测试的样板**（`tests/test_tenant_isolation.py:11-81`）：两 tenant、两 JWT client、
各建一条数据，断言 A 的 list 含自己不含对方、**对方 detail 返回 404**。

**元测试是执法的主体形态。** 它们走 `get_resolver().url_patterns`，带 `EXEMPT` dict
且要求每条附理由字符串，并配 `_assert_not_vacuous`（`apps/perm/test_codename_coverage.py:33-35`）
—— 先钉住主体集合非空，再断缺失。**新写元测试照此办理。**

### 8.3 门禁

| 门 | 值 | 位置 |
|---|---|---|
| 覆盖率 | `--cov=apps --cov-branch --cov-fail-under=80` | `pytest.ini:33`（注释 14-27 解释 40→80 的棘轮） |
| 审计断言防空 | `-p apps.audit.oncommit_guard` | 在会回滚的事务里读 AuditLog 而表从未真写 → 测试结束报错 |
| ruff | `select = ["E","F","W","I","N","UP","B","A","SIM"]`，line-length 120 | `backend/ruff.toml:1-20`。【实跑】`ruff check .` **exit 0** |

**覆盖率门有两条关闭的路径：** `CLAUDE.md:132` 的 PG 命令和
`test_concurrency.py:344` 都带 `--no-cov`。

---

## 9. 安全

| 规则 | 出处 | 执法 |
|---|---|---|
| `SECRET_KEY` 未设 → import 时 `ValueError` | `settings.py:14-16` | `[settings]` |
| 生产必设 `ALLOWED_HOSTS` | `settings.py:20-34` | `[settings]` |
| **生产禁 SQLite** | `settings.py:150-155` | `[settings]`。`tests/test_production.py:109` 明写"Could be sqlite for dev" |
| 生产安全头 | `settings.py:336-346` | `[settings]`；`test_production.py:86-104` 只 `hasattr` |
| 审计写失败必须留日志 | — | `[test:test_audit_failures_are_never_silent]` |
| webhook 投递必须在 `on_commit` 之后 | — | `[test:test_webhooks_are_not_delivered_inside_the_transaction]` |
| `X-Forwarded-For` 必须校验 | — | `[test:test_client_ip_is_validated]`（含 PG-only 的一半） |
| CSV 导出不得携带公式 | — | `[test:test_ledger_export_cannot_carry_a_formula]` |
| 依赖审计 | `pip-audit --strict --desc -r requirements.txt` | `[CI]`。**注意 `-r`**：`CLAUDE.md:81` 写的是全环境版，会报 conda `vision` 环境自带的 starlette/torch/tornado/urllib3 —— 那是环境噪音不是项目发现 |
| 密钥不入库 | `.gitignore:4-8` | `[gitignore]`。**无 secret scanner，ruff 无 `S` 规则** |
| 禁止在代码中输出 API Key / Token | 根 `AGENTS.md:270` | **`[文字]`** |
| `manage.py check --deploy` | — | **任何地方都不跑** |
| `SENTRY_DSN` 生产缺失 | `settings.py:417-424` | 只 `warnings.warn`，**不 fail closed** |

**锁：** `select_for_update` 有 10 个生产站点，分布在 model 方法、service、view 三层，
配 `transaction.atomic()`（services 里 23 处）。**日志与事件发送放在 `atomic()` 块之后**
（`apps/souls/models.py:546-547`）。

---

## 10. 提交与验证纪律

格式 `type(scope): description`，types: `feat, fix, docs, style, refactor, test, ci, chore`
（`CLAUDE.md:247-248`）。**无 commit-msg 钩子。** 实测最近 200 条里出现
`merge`(13) / `build`(3) / `perf`(1)，三份类型清单都没列过。

**pre-push 后端段顺序**（`.git/hooks/pre-push:121-268`，与 `install-hooks.sh:43-312` 逐字节一致）：
`ruff check .` → `makemigrations --check` → 探测 DB/Redis → `pytest -q --no-header`，
读 `${PIPESTATUS[0]}`。**fail closed：工具缺失即拒推。**

### 验证纪律（`CLAUDE.md:203-221`，全是 `[文字]`，但每一条都有事故背书）

- **读退出码，不读输出。** `ruff check . | tail -1` 在失败时给的是"[*] 1 fixable…"
  而不是"Found 1 error."；`cmd | tail` 的退出码永远是 0。三次事故全出在这里。
  写成 `cmd >/dev/null 2>&1; echo "exit: $?"`，或对管道用 `${PIPESTATUS[0]}`。
  （注意：`${PIPESTATUS[0]}` 在 zsh 下求值为空串。）
- 声称套件通过，要给出命令、退出码、passed 计数。
- 改动前的绿不是证据 —— 编辑后重跑。
- 新检查必须**先证明它会红**：变异它守的东西，看它变红，再信它的绿。
- 断言缺席，不只断言在场 —— "正确的值显示了"在错误的值就在旁边时仍然是绿的。
- **行为像 bug 的 test double 比没有测试更糟**：它让正确代码看起来坏、坏代码看起来好。

---

## 11. 只是文字、没有任何执法的规则（完整清单）

已 grep `ruff.toml` 的 select、测试文件、workflow、`.git/hooks` 求证：

| 规则 | 出处 |
|---|---|
| PEP8 全量 | `CONTRIBUTING.md:28`。只有 ruff E/W 子集 |
| **行宽 120** | `ruff.toml:1`。E501 被 ignore **且 formatter 从未跑过** →【实跑】622 文件待格式化 |
| Type hints required | `CONVENTIONS.md:8`。无 `ANN` 规则。【实跑】1886 个 `def` 中 **174** 个有返回注解（约 9%） |
| Services pattern / 业务逻辑不进 ViewSet / 不写胖 serializer | `CONVENTIONS.md:9-10,21-23` |
| 模型必须用 AuditUserFields / version / 软删 | `CONVENTIONS.md:14-18`。3 个模型是例外 |
| `perform_create` 必须设 tenant | 根 `AGENTS.md:198,338` |
| 跨租户 → 404 | 根 `AGENTS.md:199`。仅 souls/ledger 有测试 |
| Always select_related / prefetch_related | `CONVENTIONS.md:131-135`。只有 5 个逐端点查询计数测试 |
| Critical flows must be covered | `CONVENTIONS.md:95-102`。无映射测试 |
| 提交格式 | 2026-09-06 起唯一权威是 `CLAUDE.md` 的 `## Git`（`CONTRIBUTING.md`/`AGENTS.md` 改成了指针）。仍**无执法**：`.git/hooks/` 没有 commit-msg |
| 禁 force push / 重写历史 | 根 `AGENTS.md:266-267`。仓库内无机制 |
| 禁止输出 API Key / Token | 根 `AGENTS.md:270` |
| Validate input at system boundaries | `CLAUDE.md:27`。只有零散具体测试 |
| 500 行上限 | `CLAUDE.md:11-26`。自述无执法 |
| `except Exception: pass` 围着查询 | `CLAUDE.md:184-188`。S110 未选，SIM105 被 ignore |
| varchar 宽度 vs 语料长度 | `CLAUDE.md:189-191`。无测试，只能靠 PG 跑 |
| 每个 `RunPython` 都可逆 | 只有 4 个具名迁移 |
| docstring 规则 | **任何文档都没写**，select 无 `D` |
| 后端命名（snake_case） | **仓库文档没写**。ruff `N` 部分覆盖，N805/N806 被 ignore |
| `.pre-commit-config.yaml` 全部条目 | 框架未装 |
| 一切标 `[CI]` 的门 | workflow 只有 `workflow_dispatch` |

---

## 12. 文档之间互相矛盾的地方

1. **领域逻辑归属。** `CONTRIBUTING.md:32`「Models for domain logic (state machines,
   validation)」 vs `CONVENTIONS.md:9`「Services pattern preferred」。两个归属，都无执法。
> **2026-09-06 修掉了其中 4 条**（下面标 ✅）。原则：只改我核实过的事实错误，
> 不改任何会影响行为的代码。

2. ✅ **TenantManager 是否过滤租户 —— 这是全表最重要的一条，因为它是安全断言。**
   - 说"自动过滤"：根 `AGENTS.md:196`、`docs/ARCHITECTURE.md:61-64`、
     `apps/tenants/managers.py:1-11` 的模块 docstring、`apps/tenants/middleware.py:15-16`
   - 说"已停止过滤"：`managers.py:38-46`、`apps/core/tenant.py:12-16`
   - **代码为准：不过滤。** 另：根 `AGENTS.md:197` 说 thread-local + try-finally，
     实为 contextvar。
   - **四处说反的地方已全部更正。** 这一条值得单独记住的不是"文档错了"，而是
     **它有四个互相印证的来源**：任何人去核对这个说法，都会找到三份文档同意它。
     一致性在这里不是可信度的证据 —— 它们抄的是同一个已经失效的前提。
     信任一个 manager 的名字而不写 `scope_to_tenant`，得到的是完全没有隔离的
     queryset，而只跑单租户的测试全部照绿。
3. ✅ **`apps/permissions` 是否存在。** `docs/ARCHITECTURE.md:46,54-55` 说它在且与 perm
   不同（还特意警告读者别混淆两者）vs `backend/AGENTS.md:51-69`「❌ 已删除(2026-09-03)，
   零读取者零写入者」。【实跑】`grep "apps.permissions" backend/config/settings.py`
   **无命中**。**ARCHITECTURE.md 已更正**，并把 `death_sync` 补进列表。
4. ✅ **`karma` 还是 `ledger`。** 根 `AGENTS.md:308` 列 `karma/` vs `docs/API.md:55-56`
   「renamed to ledger — /karma/ no longer exists」。【实跑】`settings.py:69` 是
   `apps.ledger`。**AGENTS.md 的目录树已重写**（同时修掉 `lib/api.ts`、
   `src/middleware.ts`、`tailwind.config.js` 三个不存在的路径）。
5. ✅ **`apps.core.middleware`。** `docs/ARCHITECTURE.md:52` 列它 vs `settings.py:92-95`
   注释：该模块 2026-08-28 整个删除，现存的是
   `apps/core/request_local.py::RequestContextMiddleware`。**已更正。**
6. **Type hints。** `CONVENTIONS.md:8`「required」 vs `CONTRIBUTING.md:29`「where possible」。
   实测 9%。
7. **Redis 隔离。** `CLAUDE.md:70-74`「两个服务都要隔离」 vs `.git/hooks/pre-push:171-184`
   在共享 Redis 可达时直接用（写明了撤回条件）。
8. **`SECRET_KEY` 的环境变量名。** `settings.py:14` 读 `SECRET_KEY`、`ci.yml:14` 也是；
   但 `infrastructure/docker-compose.prod.yml:43-44,64` 注入 `DJANGO_SECRET_KEY`，
   `tests/test_production.py:161` 钉的也是 `DJANGO_SECRET_KEY`。**没找到映射。**
   静态观察，未起容器验证。
9. **pip-audit 命令。** `CLAUDE.md:81` 不带 `-r`（全环境）vs CI 带 `-r requirements.txt`。
10. **`backend/AGENTS.md` 不是规范文档。** 它自述为"2026-05-12 那一次优化的记录，
    不是现状描述"（`:1,8`）。今天仍成立的只有两条：contextvar、`apps/permissions` 已删。
11. **里程碑状态。** 根 `AGENTS.md:366-377` 把 M4–M7 标"待开始"，同一文件 `:509-510`
    又把 menus/audit 标"M4新增"并画进架构图。`AGENTS.md:542` 写"最后更新 2026-05-10"，
    正文却含 2026-09-02 的追加。
12. **根目录禁放工作文件。** `CLAUDE.md:8` vs 根 `pytest.ini`/`conftest.py`
    （`pytest.ini:14-19` 解释了必须在根的原因）+ 已跟踪的 `backend/test.db`、`coverage*.json`。

---

## 13. 代码里现存的不一致（不是缺陷清单，是"你会看到两种写法"的清单）

| 事项 | 多数派 | 少数派 |
|---|---|---|
| 租户收窄入口 | `DataScopeViewSetMixin` 继承（11 个 ViewSet） | 直接调 `scope_to_tenant`（21 处）；`TenantQuerySetMixin`（5 个，且**同时**继承 DataScope → MRO 里 scope 两遍）；dispatch 手写 `Q(...)|Q(...)`（2 处，已登记 EXEMPT） |
| 继承 mixin 却整个覆盖 `get_queryset` | — | `apps/souls/views.py:65-114`、`apps/dispatch/views.py:100-132`（注释自述）、`apps/workflow/views.py:50-60` |
| 错误体 | `{"error": "<句子>"}` **79** | `{"detail"}` **13**；`{"error": "<CODE>", "message"}` 8 |
| ADMIN 判定 | `is_tenant_exempt()` 4 处 | 字面 `role == 'ADMIN'` ≥12 处 |
| tenant 写入时机 | `Model.save()` 读 contextvar（souls 1 + social 4，**四份逐字复制**） | `TenantCreateMixin`（4）；`serializer.save(tenant=)`（3）；service 参数；从父对象派生 |
| 时间戳 | 基类 `create_time`（33 模型） | 另加 `created_at`（11 处）→ ordering 分裂 12:5 |
| `CheckConstraint` | `condition=` | `check=`（`apps/social/models.py:264`） |
| 索引命名 | 匿名 65 处 | 命名 1 处 |
| `urls.py` 收尾 | `urlpatterns = router.urls`（8 个 app） | `[path("", include(router.urls))]`（7 个）；纯 `path()` 列表（3 个） |
| view 形态 | ViewSet 30 个 | `APIView` 7 个；`@api_view` 函数视图 21 个 |
| `AuditUserViewSetMixin` 位置 | Codename 之后 | 排最前（7 处） |
| 同 app 内 import | 绝对 `from apps.x.models` | 相对 `from .models`（10 处，perm/audit/authentication/menus） |
| 引号 | 双引号（souls/judgment/social ≥95%） | `apps/authentication/views.py` 单 134 : 双 127（ruff 未启用 `Q` 规则） |
| 日志格式 | `%s` 占位 | f-string（death_sync/audit/perm.cache） |
| service 方法 | `@staticmethod` 52 | `@classmethod` 27（同文件内混用） |
| 测试框架 | pytest 类 + 裸 assert（297 类 / 4780 断言） | Django `TestCase` + `self.assert*`（52 类 / 353 断言） |
| 测试认证 | 真 JWT 117 | `force_authenticate` 105（**不过中间件**） |
| docstring 语言 | 英文（69/72 抽样文件） | 中文 4 处；行内注释中英混杂普遍 |

---

## 14. 本文件数字的复核命令

```bash
cd /Users/tardis/Downloads/SoulLedger/backend
RUFF=/opt/anaconda3/bin/ruff
$RUFF check . >/dev/null 2>&1; echo "check exit: $?"
$RUFF format --check . 2>&1 | tail -1
grep -rn "class .*(.*AuditUserFields" apps --include='*.py' | grep -v migrations | wc -l
grep -rn "permission_codename = None" apps --include='*.py' | wc -l
grep -rnE '"error":\s*[f]?"' apps --include='*.py' | grep -v test | wc -l
grep -rnE "def .*\) *->" apps --include='*.py' | grep -v migrations | wc -l
git -C .. ls-files backend | grep -E 'coverage.*json|\.db$'
```

**这些数字会随代码变化。** 它们写在这里是为了让"某处 N 个"这类断言可被推翻 ——
`permission_codename = None` 同时存在 8 / 9 / 10 三个说法，就是不复核的代价。
