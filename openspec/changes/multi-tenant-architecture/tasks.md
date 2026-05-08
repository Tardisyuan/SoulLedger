# Multi-Tenant Architecture — Task List (v2)

## Phase A: Multi-Tenant Infrastructure (Milestone 3)

### A1: Tenant Model
- [ ] **task: create_tenant_model**
  标题：创建 Tenant 模型
  描述：创建 Tenant 模型（code, display_name, description, settings, is_active, dispatch_enabled, api_endpoint）
  文件：backend/apps/tenants/models.py
  验证：python manage.py check

- [ ] **task: seed_tenant_data**
  标题：插入三条租户记录
  描述：CN_DIYU / EU_HEAVEN_HELL / EG_DUAT 各一条，dispatch_enabled=True
  文件：backend/scripts/seed_tenants.py
  验证：SELECT * FROM tenants_tenant; 应有3条

### A2: All Tables + tenant_id
- [ ] **task: add_tenant_id_to_realms**
  标题：Realm 表加 tenant_id
  描述：tenant FK（可空），为现有数据填充 tenant_id
  文件：backend/apps/realms/models.py, migrations

- [ ] **task: add_tenant_id_to_actors**
  标题：Actor 表加 tenant_id
  文件：backend/apps/actors/models.py, migrations

- [ ] **task: add_tenant_id_to_souls**
  标题：Soul 表加 tenant_id
  描述：加 tenant FK，移除 civilization 字段（已被 tenant 替代）
  文件：backend/apps/souls/models.py, migrations

- [ ] **task: add_tenant_id_to_judgment**
  标题：Judgment 表加 tenant_id
  文件：backend/apps/judgment/models.py, migrations

- [ ] **task: add_tenant_id_to_disposition**
  标题：Disposition 表加 tenant_id
  文件：backend/apps/disposition/models.py, migrations

- [ ] **task: add_tenant_id_to_reincarnation**
  标题：Reincarnation 表加 tenant_id
  文件：backend/apps/reincarnation/models.py, migrations

- [ ] **task: add_tenant_id_to_events**
  标题：SoulEvent 表加 tenant_id
  文件：backend/apps/events/models.py, migrations

- [ ] **task: update_user_tenant**
  标题：User 表加 tenant_id
  描述：从关联 actor 反推 tenant，或默认 CN_DIYU
  文件：backend/apps/authentication/models.py, migrations

### A3: Middleware + QuerySet
- [ ] **task: create_tenant_middleware**
  标题：TenantMiddleware 自动注入租户上下文
  描述：从 request.user.tenant 读取，存入 thread-local
  文件：backend/apps/tenants/middleware.py

- [ ] **task: create_tenant_manager**
  标题：TenantManager 自动过滤 QuerySet
  描述：所有业务模型使用 TenantManager，自动加 tenant filter
  文件：各 app managers.py

- [ ] **task: update_viewsets_tenant_filter**
  标题：所有 ViewSet 加租户过滤逻辑
  描述：非 ADMIN 用户强制 tenant 过滤，ADMIN 可跨租户
  文件：各 app views.py

### A4: Tenant API + Auth Updates
- [ ] **task: add_tenant_endpoints**
  标题：租户管理 API（仅 ADMIN）
  描述：GET /tenants/、GET /tenants/{code}/、PATCH
  文件：backend/apps/tenants/views.py, serializers.py, urls.py

- [ ] **task: update_auth_login_response**
  标题：登录响应加 tenant 信息
  描述：/auth/login/ 返回 user.tenant.code 和 display_name
  文件：backend/apps/authentication/serializers.py

### A5: Data Migration
- [ ] **task: migrate_existing_data**
  标题：现有数据迁移到多租户
  描述：所有现有 soul/realm/actor 按 civilization 映射到对应 tenant_id
  文件：backend/scripts/migrate_to_multitenant.py

- [ ] **task: reseed_all_tenants**
  标题：重写种子数据脚本
  描述：seed_all_tenants.py，分别 seed 三个租户
  文件：backend/scripts/seed_all_tenants.py
  验证：三个租户 realms 总数 = 17+17+5=39，actors = 31+?+?

- [ ] **task: cleanup_civilization_references**
  标题：清理代码中所有 civilization 字段引用
  描述：serializer/filter/query 中的 civilization 参数全部改为 tenant
  文件：各 app serializers.py, views.py, urls.py

### A6: Tests
- [ ] **task: write_tenant_isolation_tests**
  标题：租户隔离集成测试
  描述：创建两个租户的用户，验证 A 租户看不到 B 租户数据
  文件：backend/tests/test_tenant_isolation.py
  验证：pytest -v（应全部失败或报权限错误）

## Phase B: Tenant-Aware Frontend (Milestone 4)

- [ ] **task: update_api_client_tenant**
  标题：API client 支持 tenant 上下文
  描述：请求自动带上当前 tenant，响应解析 tenant 信息
  文件：frontend/lib/api.ts

- [ ] **task: add_tenant_context**
  标题：TenantContext 前端上下文
  描述：从 JWT 解码获取 tenant_code，存储在 TenantContext
  文件：frontend/contexts/TenantContext.tsx

- [ ] **task: add_tenant_routing**
  标题：前端按租户路由
  描述：登录后跳转到 /{tenant_code}/souls/，NavBar 显示当前租户
  文件：frontend/app/[tenant]/layout.tsx, page.tsx

- [ ] **task: update_navbar_tenant_context**
  标题：NavBar 显示当前租户 + 登出
  描述：显示 tenant.display_name、user.role、logout 按钮
  文件：frontend/components/NavBar.tsx

- [ ] **task: update_login_redirect**
  标题：登录后按租户跳转
  描述：解析 JWT 中 tenant_code，跳转到 /{tenant}/souls/
  文件：frontend/app/login/page.tsx

## Phase C: Dispatch Module (Milestone 5)

### C1: Dispatch Models
- [ ] **task: create_dispatch_models**
  标题：创建 DispatchRecord + CrossTenantJudgment 模型
  描述：DispatchRecord（source_tenant, target_tenant, soul, reason, status, dispatched_at）
       CrossTenantJudgment（participants from multiple tenants, status: PROPOSED/IN_REVIEW/APPROVED/REJECTED）
  文件：backend/apps/dispatch/models.py
  验证：python manage.py check

- [ ] **task: create_dispatch_services**
  标题：DispatchService + CrossTenantJudgmentService
  描述：propose_dispatch(), approve_dispatch(), reject_dispatch(), execute_dispatch()
       create_judgment_session(), join_judgment(), approve_judgment()
  文件：backend/apps/dispatch/services.py

### C2: Dispatch API
- [ ] **task: add_dispatch_api**
  标题：Dispatch API 端点
  描述：POST /dispatch/propose/, /dispatch/{id}/approve/, /dispatch/{id}/reject/, /dispatch/{id}/execute/
  文件：backend/apps/dispatch/views.py, serializers.py, urls.py

- [ ] **task: add_cross_tenant_judgment_api**
  标题：联合审判 API 端点
  描述：GET /cross-tenant-judgments/, POST /cross-tenant-judgments/, POST /cross-tenant-judgments/{id}/participate/
  文件：backend/apps/dispatch/views.py, serializers.py, urls.py

### C3: Dispatch Frontend
- [ ] **task: add_dispatch_frontend_pages**
  标题：外派相关页面
  描述：/{tenant}/dispatch/propose/, /{tenant}/dispatch/pending/, /{tenant}/dispatch/history/
  文件：frontend/app/[tenant]/dispatch/

- [ ] **task: add_cross_judgment_frontend**
  标题：联合审判页面
  描述：/{tenant}/cross-judgments/ 显示所有跨租户审判会话
  文件：frontend/app/[tenant]/cross-judgments/

### C4: Dispatch Tests
- [ ] **task: write_dispatch_tests**
  标题：外派流程集成测试
  描述：测试 propose→approve→execute 全流程，跨租户隔离
  文件：backend/tests/test_dispatch.py
  验证：pytest -v

## Phase D: Multi-Civilization Data (Milestone 6)

- [ ] **task: seed_european_data**
  标题：European realms + actors 数据
  描述：17 realms（Heaven + Purgatory 7层 + Hell 9层），5 actors（St. Peter, Hades, Satan, Michael, Lucifer）
  文件：backend/scripts/seed_european_data.py

- [ ] **task: seed_egyptian_data**
  标题：Egyptian realms + actors 数据
  描述：5 realms（Aaru, Duat regions），4 actors（Osiris, Anubis, Thoth, Ma'at）
  文件：backend/scripts/seed_egyptian_data.py

- [ ] **task: verify_dispatch_routing_per_civilization**
  标题：三大文明 dispatch 路由验证
  描述：对每个租户测试 dispatch 路由规则
  文件：backend/tests/test_dispatch_per_civilization.py

## Phase E: Karma System (Milestone 7)

- [ ] **task: implement_karma_time_decay**
  标题：业力时间衰减
  描述：effective_score = original × e^(-0.01×years_since_event)
  文件：backend/apps/souls/services.py

- [ ] **task: implement_karma_redis_cache**
  标题：Redis 业力缓存
  描述：TTL=5min，缓存 karma 计算结果
  文件：backend/apps/souls/services.py

- [ ] **task: implement_celery_tasks**
  标题：Celery 定时任务
  描述：每日重算、逾期检查（soul in JUDGING > 30 days 提醒）
  文件：backend/config/celery.py

- [ ] **task: add_karma_frontend**
  标题：业力可视化前端
  描述：Recharts 时间线图
  文件：frontend/app/[tenant]/souls/[id]/page.tsx（加 karma chart）

## Phase F: Statistics Dashboard (Milestone 8)

- [ ] **task: add_global_stats_api**
  标题：全局统计 API（仅 ADMIN）
  描述：GET /stats/global/, GET /stats/by-tenant/, GET /stats/realm-occupancy/
  文件：backend/apps/stats/views.py, serializers.py

- [ ] **task: add_admin_dashboard_frontend**
  标题：ADMIN 统计大屏
  描述：/admin/dashboard/ 跨租户统计图表
  文件：frontend/app/admin/dashboard/page.tsx

## Phase G: Production (Milestone 9)

- [ ] **task: docker_prod_config**
  标题：docker-compose.prod.yml
  文件：docker-compose.prod.yml

- [ ] **task: multi_stage_dockerfile**
  标题：多阶段 Dockerfile（< 500MB）
  文件：backend/Dockerfile

- [ ] **task: nginx_https_config**
  标题：Nginx HTTPS 配置
  文件：infrastructure/nginx.conf

- [ ] **task: health_endpoint**
  标题：/health/ 健康检查端点
  文件：backend/config/urls.py

- [ ] **task: structured_logging**
  标题：结构化日志（structlog）
  文件：backend/config/settings.py

- [ ] **task: sentry_integration**
  标题：Sentry 集成
  文件：backend/config/settings.py

## Phase H: SPEC.md Final Update

- [ ] **task: final_spec_update**
  标题：最终 SPEC.md 确认
  描述：确认所有章节完整、一致、无遗留问题
  文件：SPEC.md

---

## Dependency Graph

```
M3: A1 → A2 → A3 → A4 → A5 → A6
                              ↓
M4: B1 → B2 → B3 → B4 → B5
                          
M5: C1 → C2 → C3 → C4

M6: D1 → D2 → D3

M7: E1 → E2 → E3 → E4

M8: F1 → F2

M9: G1 → G2 → G3 → G4 → G5 → G6

H: After all above
```

## Acceptance Criteria Per Milestone

### M3 (Multi-Tenant Infrastructure) ✅
- [ ] Tenant model created with 3 records
- [ ] All business tables have tenant_id FK
- [ ] TenantManager auto-filters queries by tenant
- [ ] Non-ADMIN users only see their tenant's data
- [ ] ADMIN can see all tenants' data
- [ ] All tests pass (12 core + 2 isolation)

### M4 (Tenant-Aware Frontend) ✅
- [ ] URL contains tenant: /{tenant}/souls/
- [ ] Login redirects to /{tenant_code}/souls/
- [ ] NavBar shows current tenant name
- [ ] Language switcher works on all pages
- [ ] ADMIN sees /admin/dashboard/ link

### M5 (Dispatch Module) ✅
- [ ] Can propose dispatch from one tenant to another
- [ ] Target tenant can approve/reject dispatch
- [ ] Dispatched soul appears in target tenant's data
- [ ] Cross-tenant judgment sessions can be created
- [ ] Participants from multiple tenants can join

### M6 (Multi-Civilization Data) ✅
- [ ] European: 17 realms + 5 actors with data
- [ ] Egyptian: 5 realms + 4 actors with data
- [ ] All dispatch routing rules work per civilization
- [ ] i18n displays correctly for all three languages

### M7 (Karma System) ✅
- [ ] Time decay formula implemented
- [ ] Redis cache reduces DB queries
- [ ] Celery tasks run on schedule
- [ ] Karma chart renders in frontend

### M8 (Statistics Dashboard) ✅
- [ ] /stats/global/ returns all-tenant data (ADMIN)
- [ ] /stats/by-tenant/ returns per-tenant breakdown (ADMIN)
- [ ] Dashboard charts render with real data

### M9 (Production) ✅
- [ ] docker-compose.prod.yml runs all services
- [ ] Dockerfile < 500MB
- [ ] /health/ returns 200
- [ ] Structured logs output JSON format
- [ ] Sentry captures exceptions
