# Multi-Tenant Architecture — Task List

## Phase A: 数据模型与迁移

- [ ] **task: create_tenant_model**
  标题：创建 Tenant 模型
  描述：在 apps/tenants/ 下创建 Tenant 模型（code, display_name, description, settings, is_active）
  文件：backend/apps/tenants/models.py
  验证：python manage.py check; migrate

- [ ] **task: seed_tenant_data**
  标题：插入三条租户记录
  描述：CN_DIYU / EU_HEAVEN_HELL / EG_DUAT 各一条
  文件：backend/scripts/seed_tenants.py
  验证：SELECT * FROM tenants_tenant; 应有3条

- [ ] **task: add_tenant_id_to_realms**
  标题：Realm 表加 tenant_id
  描述：加 tenant FK（可空），为 CN_DIYU 数据填充 tenant_id
  文件：backend/apps/realms/models.py, migrations
  验证：realm.tenant_id 有值

- [ ] **task: add_tenant_id_to_actors**
  标题：Actor 表加 tenant_id
  描述：同上，按 civilization 映射
  文件：backend/apps/actors/models.py, migrations
  验证：actor.tenant_id 有值

- [ ] **task: add_tenant_id_to_souls**
  标题：Soul 表加 tenant_id
  描述：同上，按 civilization 映射
  文件：backend/apps/souls/models.py, migrations
  验证：soul.tenant_id 有值

- [ ] **task: update_user_tenant**
  标题：User 表加 tenant_id
  描述：从关联 actor 反推 tenant，或默认 CN_DIYU
  文件：backend/apps/authentication/models.py, migrations
  验证：admin 用户 tenant_id = CN_DIYU

- [ ] **task: add_tenant_id_to_judgment**
  标题：Judgment 表加 tenant_id
  描述：通过 Soul 反推，cascade constraint
  文件：backend/apps/judgment/models.py, migrations

- [ ] **task: add_tenant_id_to_disposition**
  标题：Disposition 表加 tenant_id
  描述：通过 Soul 反推
  文件：backend/apps/disposition/models.py, migrations

- [ ] **task: add_tenant_id_to_reincarnation**
  标题：Reincarnation 表加 tenant_id
  描述：通过 Soul 反推
  文件：backend/apps/reincarnation/models.py, migrations

- [ ] **task: add_tenant_id_to_events**
  标题：SoulEvent 表加 tenant_id
  描述：通过 Soul 反推
  文件：backend/apps/events/models.py, migrations

- [ ] **task: remove_civilization_from_soul**
  标题：删除 Soul.civilization 字段
  描述：tenant_id 就是文明标识，不再需要 civilization 字段
  文件：backend/apps/souls/models.py, migrations

## Phase B: 中间件与 QuerySet 过滤

- [ ] **task: create_tenant_middleware**
  标题：TenantMiddleware 自动注入租户上下文
  描述：从 request.user.tenant 读取，存入 thread-local
  文件：backend/apps/tenants/middleware.py
  验证：单元测试验证 thread_local 值正确

- [ ] **task: create_tenant_manager**
  标题：TenantManager 自动过滤 QuerySet
  描述：所有业务模型使用 TenantManager，自动加 tenant filter
  文件：backend/apps/souls/managers.py 等
  验证：JUDGE 用户查 /souls/ 只能看到自己 tenant 的记录

- [ ] **task: update_viewsets_tenant_filter**
  标题：所有 ViewSet 加租户过滤逻辑
  描述：非 ADMIN 用户强制 tenant 过滤，ADMIN 可跨租户
  文件：各 app views.py

## Phase C: API 端点

- [ ] **task: add_tenant_endpoints**
  标题：租户管理 API
  描述：GET /tenants/、GET /tenants/{code}/、PATCH
  文件：backend/apps/tenants/views.py, serializers.py, urls.py
  验证：ADMIN 可访问，非 ADMIN 403

- [ ] **task: add_global_stats_endpoint**
  标题：全局统计 API（仅 ADMIN）
  描述：GET /stats/global/、GET /stats/by-tenant/
  文件：backend/apps/stats/（新建 app）
  验证：ADMIN 返回所有租户汇总数据

- [ ] **task: update_auth_login_response**
  标题：登录响应加 tenant 信息
  描述：/auth/login/ 返回 user.tenant.code 和 display_name
  文件：backend/apps/authentication/serializers.py

## Phase D: 前端

- [ ] **task: update_api_client_tenant**
  标题：API client 支持 tenant 上下文
  描述：请求自动带上当前 tenant，响应解析 tenant 信息
  文件：frontend/lib/api.ts

- [ ] **task: add_tenant_routing**
  标题：前端按租户路由
  描述：登录后跳转到 /{tenant_code}/souls/，NavBar 显示当前租户
  文件：frontend/app/[tenant]/layout.tsx, page.tsx

- [ ] **task: update_navbar_tenant_context**
  标题：NavBar 显示当前租户 + 退出
  描述：显示 tenant.display_name、user.role、logout 按钮
  文件：frontend/components/NavBar.tsx

- [ ] **task: add_admin_dashboard**
  标题：ADMIN 全局统计大屏
  描述：跨租户统计图表
  文件：frontend/app/admin/dashboard/page.tsx

## Phase E: 测试

- [ ] **task: write_tenant_isolation_tests**
  标题：租户隔离集成测试
  描述：创建两个租户的用户，验证 A 租户看不到 B 租户数据
  文件：backend/tests/test_tenant_isolation.py
  验证：pytest test_tenant_isolation.py -v（应全部失败或报权限错误）

- [ ] **task: write_multi_tenant_lifecycle_tests**
  标题：多租户 E2E 测试
  描述：对三个租户分别跑完整 lifecycle（ALIVE→JUDGING→DISPOSED→REINCARNATING→ALIVE）
  文件：backend/tests/test_soul_lifecycle.py（扩展）
  验证：3个租户 × 2个测试用例 = 6个新测试

## Phase F: 数据迁移与 seed

- [ ] **task: migrate_existing_data**
  标题：现有数据迁移到多租户
  描述：所有现有 soul/realm/actor 按 civilization 映射到对应 tenant_id
  文件：backend/scripts/migrate_to_multitenant.py
  验证：SELECT tenant_id, COUNT(*) FROM souls_soul GROUP BY tenant_id; 应有3个租户数据

- [ ] **task: reseed_all_tenants**
  标题：重写种子数据脚本
  描述：seed_chinese_data.py 改为 seed_all_tenants.py，分别 seed 三个租户
  文件：backend/scripts/seed_all_tenants.py
  验证：三个租户 realms 总数 = 17+17+5=39，actors = 31+?+?

- [ ] **task: cleanup_civilization_references**
  标题：清理代码中所有 civilization 字段引用
  描述：serializer/filter/query 中的 civilization 参数全部改为 tenant
  文件：各 app serializers.py, views.py, urls.py
  验证：grep -r "civilization" backend/apps/ 应只在租户间共享数据处出现（如跨租户历史）

## Phase G: SPEC.md 更新

- [ ] **task: update_spec_multitenant**
  标题：SPEC.md 更新为多租户架构
  描述：架构图、领域模型、API、里程碑全部更新
  文件：SPEC.md, openspec/changes/multi-tenant-architecture/

---

## 依赖关系

```
create_tenant_model → seed_tenant_data
seed_tenant_data → add_tenant_id_to_realms
seed_tenant_data → add_tenant_id_to_actors
seed_tenant_data → add_tenant_id_to_souls
add_tenant_id_to_souls → add_tenant_id_to_judgment
add_tenant_id_to_souls → add_tenant_id_to_disposition
add_tenant_id_to_souls → add_tenant_id_to_reincarnation
add_tenant_id_to_souls → add_tenant_id_to_events
add_tenant_id_to_souls → update_user_tenant
create_tenant_model → create_tenant_middleware → create_tenant_manager → update_viewsets_tenant_filter
update_viewsets_tenant_filter → add_tenant_endpoints
add_tenant_endpoints → add_global_stats_endpoint
add_tenant_endpoints → update_auth_login_response
update_auth_login_response → update_api_client_tenant → update_navbar_tenant_context → add_tenant_routing
create_tenant_manager → write_tenant_isolation_tests
migrate_existing_data → reseed_all_tenants → cleanup_civilization_references
cleanup_civilization_references → update_spec_multitenant
```
