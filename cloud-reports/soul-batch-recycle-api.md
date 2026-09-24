# 灵魂批量移入回收站:接口与 core hook

分支 `feat/soul-batch-recycle-api`,基于 `main` @ `4e0b778`。前端操作栏不在本次范围内。

## 接口

`POST /api/v1/souls/batch-recycle/`(`SoulViewSet.batch_recycle`,`backend/apps/souls/views.py`)

**请求**

```json
{ "ids": ["<uuid>", "..."], "reason": "可选,≤500 字" }
```

**成功:200**,按请求顺序返回,每个灵魂有自己的 cascade id(与逐个单删完全一样,回收站里是 N 条可以分别恢复的条目):

```json
{ "recycled": 2, "results": [{ "id": "<uuid>", "cascade_id": "<uuid>" }, ...] }
```

**失败**(任何失败都表示**什么都没有删**):

| 状态码 | 何时 | 响应体 |
|---|---|---|
| 400 | `ids` 缺失 / 空列表 / 超过 100 个 / 含非 UUID / 有重复 id;`reason` 超过 500 字 | DRF 的字段错误,如 `{"ids": ["Duplicate ids: …"]}` |
| 401 | 未认证 | DRF 默认 |
| 403 | 没有 `soul.delete`(与单删同一个 codename) | DRF 默认 |
| 404 | 有 id 访问不到:属于别的租户、在数据范围之外、已删除、已归档或不存在,这几种情况**无法区分**,与单删的 404 一致 | `{"code": "not_found", "error": "…", "ids": [所有访问不到的 id]}` |
| 409 | 有灵魂存在已结案的审判,不能删,只能归档 | `{"code": "not_deletable", "error": "…", "ids": [所有被拦下的 id], "archivable": true}` |

- `error` 与单删 409 用的是同一个键。新增 `code` 字段,让客户端不用解析文案就能分支。
- `code` 的枚举在 schema 里钉为 `SoulBatchRecycleErrorCodeEnum`(`ENUM_NAME_OVERRIDES`),以免叫成通用的 `CodeEnum`,日后被改成带哈希的名字。

## 每个灵魂走的路径(复用,不是复制)

对每个 id,单删 `destroy()` 做的事,这里原样做一遍:

1. **找到灵魂**:用 `get_queryset()`,即 `scope_to_tenant` 加 DataScope,排除已删和已归档。单删的 `get_object()` 用的也是它。另外显式加了 `is_deleted=False`,因为 `?show_deleted=true` 不能让批量接口把已删的灵魂再删一次。
2. **对象权限**:`check_object_permissions(request, soul)`,这是 `get_object()` 的另一半。
3. **删除**:`soul.delete_with_cascade(user=request.user, reason=reason)`。它负责级联到善恶记录和未结案的审判、写共享 cascade id;审计行由 post_save 信号写。

**原子性**:整批在一个 `transaction.atomic()` 里。行先经 `Soul.all_objects.select_for_update()` 加锁,之后才开始删。之所以不对 `get_queryset()` 本身加锁:它带着可空外键的 `select_related`,还可能带 DataScope 加上的 DISTINCT,PostgreSQL 对这两种都拒绝 `FOR UPDATE`。两次读取之间如果有灵魂被别人删除或归档,同样返回 404。只要有一个被拦下,就 `set_rollback(True)`,已经写下的软删和它们登记的 `on_commit` 审计回调一起撤销。

## 全部拒绝,还是逐 id 返回结果:选了全部拒绝

单删除了成功只有两种结果:404(访问不到)和 409(有已结案审判,可归档)。批量接口对整个请求报告同样这两种,状态码也相同:

- 404 在**任何写入之前**检查。响应列出的 id 都是调用方自己提交的,所以它透露的信息不超过单删的 404:别的租户的 id 和不存在的 id 看起来一样。
- 409 则在事务**内**把每个灵魂都试一遍,这样能报出**全部**被拦下的 id,报完再回滚。一次往返就能修正整个选择。

没有选逐 id 结果(207 式)的理由:那样「5 个里挪了 3 个」也算成功,操作栏还得自己发现并解释;而且一个跨租户的 id 会变成真实删除旁边的「部分成功」。用户对一批选择下达的是一个操作,要么完成,要么说明选择有问题,响应体会指出是哪些 id。上述理由也写进了视图的 docstring,因而出现在 OpenAPI 描述里。

## Core

- `soulsApi.batchRecycle(data: SoulBatchRecycleRequest)` → `api.post<SoulBatchRecycleResult>("/souls/batch-recycle/", data)`(`packages/core/src/api/souls.ts`)
- 类型直接取自生成的 schema:`SoulBatchRecycleRequest`、`SoulBatchRecycleResult`、`SoulBatchRecycleError`。其中 `SoulBatchRecycleRequest` 把 `reason` 放宽为可选:openapi-typescript 会把带 `default` 的字段当成必填,但在线路上它是可选的。
- 错误码词表:`SOUL_BATCH_RECYCLE_ERROR_CODES = ["not_found", "not_deletable"]`,两个方向都在编译期与生成的枚举对照:`satisfies` 查一个方向,一个穷举的 `Record` 查另一个方向。这里没有扩充 `SOUL_ERROR_CODES`,因为那是灵魂端 App(`/soul-auth`、`/me`)的词表,不属于官员端 `/souls/`。
- `soulBatchRecycleErrorOf(error: unknown): SoulBatchRecycleError | null`:取出被拒的 id,供操作栏显示。它按 `code` 判断而不看状态码,所以代理返回的 404 不会被误读。
- 新增 `recycleBinKeys.all = ["recycle-bin"]`(`query_keys.ts`)。它和 `app/recycle-bin/page.tsx` 一直在用的字面量相同,所以不用改页面就能触发失效。
- **Hook**:`useBatchRecycleSouls()`(`packages/core/src/hooks/useSouls.ts`)
  - 签名:`useMutation<AxiosResponse<SoulBatchRecycleResult>, Error, SoulBatchRecycleRequest>`,调用方式为 `mutate({ ids, reason? })`
  - 成功:让 `soulKeys.all`(列表和详情)与 `recycleBinKeys.all` 失效,并弹出 toast `souls.detail.delete_to_recycle_bin`
  - 失败:什么都不失效(本来就什么都没删),弹出 toast `souls.detail.error_delete`。toast 的键沿用 `useDeleteSoul` 的,没有新增文案。

## 测试

**后端** `backend/tests/test_soul_batch_recycle.py`,17 条。跨租户的调用方用的是持有 `soul.delete` 的自建角色,而不是 ADMIN:ADMIN 豁免租户隔离,用它测不出租户检查是否生效。

- 正常路径:三个灵魂全部删除,各自有独立的 cascade id 和 reason,附属记录与未结案审判随之级联,也从列表里消失
- 审计:批量产生的 DELETE 审计行(灵魂 + 记录 + 审判)与对一个同样的灵魂执行单删时逐项对照,作者也要与单删一致
- 跨租户 id → 404,只列出该 id,同一请求里可访问的灵魂**没有被删**,它们的附属记录也没动
- 原子性:第 3 个灵魂有已结案审判 → 409,前两个已经写下的软删被回滚,附属行也未删除;被拒的批量不写任何审计行
- 已删除的 id → 404(单删也是 404);带 `?show_deleted=true` 时同样是 404
- 未知 id → 404;没有 `soul.delete` → 403,且什么都没删;匿名 → 401
- ADMIN 可以跨租户(单删也可以)
- 400:缺少 ids、空列表、非列表、非 UUID、reason 超长、超过 100 个(恰好 100 个能通过校验)、重复 id

**变异验证**(改动后跑本文件,看是否变红,再还原):

| 变异 | 结果 |
|---|---|
| 可达性查询从 `self.get_queryset()` 换成 `Soul.all_objects`(去掉租户范围) | **红**:`test_a_cross_tenant_id_is_404_like_the_single_delete_and_nothing_moves`(1 failed / 16 passed) |
| 删掉 `transaction.set_rollback(True)` | **红**:`test_a_refusal_after_writes_began_rolls_all_of_them_back` 与 `test_a_refused_batch_writes_no_audit_rows`(2 failed / 15 passed) |
| hook 里删掉 `recycleBinKeys` 的失效调用 | **红**:jest `useSouls.test.ts` 1 failed / 19 passed |
| 删掉 `check_object_permissions` | **未变红**(17 passed)。这是预期的:能到达这一步的灵魂已经过了限定范围的 queryset,对象检查必然通过,和它在 `get_object()` 里一样是纵深防御。保留它是为了让两条路径一致,**没有测试单独守着它**。 |

**Core / 前端**:
- `frontend/src/__tests__/useSouls.test.ts` 新增 3 条:传参正确;预先放入 `["souls","list",…]`、`["recycle-bin"]`、`["judgments",…]` 三个查询,断言前两个被标为失效、第三个**没有**;失败时不失效、只弹错误 toast。
- `packages/core/src/api/__tests__/soulsBatchRecycle.test.ts` 新增 4 条(vitest):用存根 adapter 驱动真实的 `api` 客户端,检查 URL 与请求体;`soulBatchRecycleErrorOf` 能读出 409 和 404;对 400 的字段错误、代理的 404、未知 code、非 axios 错误都返回 null。

## 门禁(都在最终的树上跑)

环境:Python 3.11 venv(`requirements.lock` + `requirements-dev.txt`);一次性的 `redis-server --port 6399`(REDIS_URL / CELERY_BROKER_URL / CELERY_RESULT_BACKEND 分别用 `/0`、`/1`、`/2`);Node **v22.22.2**(这台机器没有 nvm,装不了 20.19.5;CLAUDE.md 记录 v22.22.1 下门禁全绿);依赖用 `npx -y npm@11 ci`,再 `npm rebuild …`;`package-lock.json` 没有改动。后端命令都带前缀 `SECRET_KEY=ci-test-key-not-for-production DEBUG=true DATABASE_URL="sqlite:///:memory:"`。

| 门禁 | 退出码 | 结果 |
|---|---|---|
| `cd backend && … .venv/bin/python -m pytest --tb=short -q` | 0 | **4485 passed / 24 skipped**(37:32;含本次新增的 17 条) |
| `cd backend && .venv/bin/ruff check .` | 0 | 0 errors |
| `cd backend && … manage.py makemigrations --check --dry-run` | 0 | No changes detected(没有迁移) |
| `manage.py spectacular --file ../packages/core/openapi/schema.yml --validate` | 0 | 0 条警告 / 0 个错误;`test_schema_has_no_warnings.py` 与 `test_committed_schema_matches_the_backend.py` 也在上面的 pytest 里 |
| `npm run schema:generate --workspace @soulledger/core` | 0 | 重新生成了 `schema.ts`;`generatedSchemaIsCurrent.test.ts` 通过 |
| `npm run --workspace packages/core typecheck` | 0 | |
| `npm run --workspace packages/core lint` | 0 | 0 warnings |
| `npm run --workspace packages/core test` | 0 | 13 files / 122 tests passed |
| `cd frontend && npx tsc --noEmit` | 0 | |
| `cd frontend && npm run test:coverage` | 0 | 168 suites / 3121 tests passed;阈值门禁通过(All files 76.14 / 66.92 / 66.64 / 77.09) |

**没有跑的**:真 PostgreSQL 那一轮(云端环境连不到 115,也没有本地 PG)。这个接口用到了 `select_for_update`,SQLite 会把它当作空操作,**所以锁的行为没有被任何测试检验过**;回滚路径在 SQLite 上是验证过的。

## 顺带发现(没有修,另开任务)

**单删的审计行没有记录操作人。** `SoulViewSet.destroy()` 覆盖了 DRF 的 destroy,直接调用 `delete_with_cascade`,从不经过 `AuditUserViewSetMixin.perform_destroy`,而当前审计用户只在那里设置。实测:通过真实 JWT 请求做一次单删,写出的是 `[('soul', …, None), ('soulrecord', …, None)]`,`AuditLog.user` 为 NULL(行上的 `deleted_by` 是对的)。`archive` 同样绕过了 `perform_destroy`,推断有同样的问题,但**没有实测**。批量接口按要求**原样复用**了单删的行为,所以现在也是 NULL。测试 `test_audit_rows_are_the_single_deletes_rows` 断言「批量的审计作者等于单删的审计作者」,而不是写死 NULL:以后只修 destroy 而漏了批量,这条测试就会变红。

## 其它说明

- `backend/apps/souls/serializers.py` 的代码行数(不含注释和 docstring)在 `main` 上已经是 509,本次加到 550。按 CLAUDE.md 的规定,拆分要有缺陷作为理由,不能只因为行数超标,所以没有拆。`views.py` 是 434 行代码。
- 前端回收站页面仍用字面量 `["recycle-bin"]`。页面不在本次范围内,以后可以改用 `recycleBinKeys.all`。
