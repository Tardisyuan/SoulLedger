# SoulLedger 系统设计任务清单

## Milestone 3: 多文明工作流

### 数据补充 (8 tasks)

- [ ] task: european_realms_data
  标题：补充 European realms 数据
  描述：添加 Heaven, 7层 Purgatory, 9层 Hell (Dante体系) 共17个地域
  文件：backend/scripts/seed_european_data.py
  验收标准：API GET /api/v1/realms/?civilization=EUROPEAN 返回 ≥17 条

- [ ] task: egyptian_realms_data
  标题：补充 Egyptian realms 数据
  描述：添加 Duat Center (审判厅), Aaru (芦苇之地), W-erets (冥界深层), Ammit 深渊
  文件：backend/scripts/seed_egyptian_data.py
  验收标准：API GET /api/v1/realms/?civilization=EGYPTIAN 返回 ≥5 条

- [ ] task: european_actors_data
  标题：补充 European actors 数据
  描述：St. Peter, Hades, Satan/Lucifer, Michael, Gabriel, 7层炼狱守护天使
  文件：backend/scripts/seed_european_data.py
  验收标准：API GET /api/v1/actors/?civilization=EUROPEAN 返回 ≥8 条

- [ ] task: egyptian_actors_data
  标题：补充 Egyptian actors 数据
  描述：Osiris (裁决者), Anubis (心脏称重), Thoth (记录), Ammit (吞噬者), Horus (继承审判)
  文件：backend/scripts/seed_egyptian_data.py
  验收标准：API GET /api/v1/actors/?civilization=EGYPTIAN 返回 ≥5 条

- [ ] task: seed_european_script
  标题：创建 seed_european_data.py 脚本
  描述：可独立运行，创建 European realms 和 actors
  文件：backend/scripts/seed_european_data.py
  验收标准：python scripts/seed_european_data.py 运行无错误

- [ ] task: seed_egyptian_script
  标题：创建 seed_egyptian_data.py 脚本
  描述：可独立运行，创建 Egyptian realms 和 actors
  文件：backend/scripts/seed_egyptian_data.py
  验收标准：python scripts/seed_egyptian_data.py 运行无错误

- [ ] task: realm_model_judgment_flag
  标题：Realm 模型增加 is_judgment_required 字段
  描述：Egyptian Duat 需要特殊审判流程（非标准十殿体系）
  文件：backend/apps/realms/models.py, 迁移文件
  验收标准：Realm.is_judgment_required 字段存在且默认为 True

- [ ] task: judgment_model_method
  标题：Judgment 模型增加 judgment_method 字段
  描述：STANDARD (中式/欧式) vs HEART_WEIGHING (Egyptian)
  文件：backend/apps/judgment/models.py, 迁移文件
  验收标准：Judgment.judgment_method 字段存在且默认为 STANDARD

### 路由逻辑 (3 tasks)

- [ ] task: disposition_service_civilization_routing
  标题：DispositionService 分文明路由逻辑
  描述：完善 create_from_judgment() 中的分文明路由：
    - CHINESE: karma ≥ 0 → DY_01_HEAVEN, karma < 0 → tier = min(10, abs(karma)/10+1)
    - EUROPEAN: karma ≥ 0 → EU_HEAVEN, karma < 0 → circle = min(9, abs(karma)/15+1)
    - EGYPTIAN: judgment_method=HEART_WEIGHING → Anubis审判路由
  文件：backend/apps/disposition/services.py
  验收标准：三个文明的 PASSED 判决均路由到正确的 BLISS realm

- [ ] task: egyptian_heart_weighing
  标题：Egyptian 心脏称重特殊路由
  描述：Anubis 审判后：
    - 平衡 → Aaru (EG_AARU)
    - 失衡 → Ammit 吞噬 或 Duat 深层
  文件：backend/apps/disposition/services.py
  验收标准：Egyptian 文明的 DISPOSED 灵魂正确路由到对应地域

- [ ] task: disposition_tests_civilization
  标题：处置路由单元测试（三大文明）
  描述：为 CHINESE / EUROPEAN / EGYPTIAN 各写 PASSED 和 FAILED 路由测试
  文件：backend/tests/test_disposition_civilization.py (新建)
  验收标准：6个测试用例全部通过

### 前端页面 (4 tasks)

- [ ] task: frontend_realms_page
  标题：地域列表页
  描述：/realms/page.tsx，支持文明筛选 (CHINESE/EUROPEAN/EGYPTIAN)，多语言展示
  文件：frontend/app/realms/page.tsx
  验收标准：页面可访问，文明筛选正常，语言切换正常

- [ ] task: frontend_actors_page
  标题：角色列表页
  描述：/actors/page.tsx，支持文明和角色类型筛选，多语言展示
  文件：frontend/app/actors/page.tsx
  验收标准：页面可访问，筛选正常，语言切换正常

- [ ] task: frontend_localized_api_display
  标题：前端多语言地域/角色展示
  描述：灵魂详情页的地域和角色显示根据 Accept-Language 返回对应名称
  文件：frontend/app/souls/[id]/page.tsx, frontend/lib/api.ts
  验收标准：切换语言后地域和角色名称同步切换

- [ ] task: frontend_nav_bar
  标题：完善导航栏
  描述：导航栏包含：SoulLedger Logo, 灵魂, 地域, 角色, 仪表板
  文件：frontend/components/NavBar.tsx
  验收标准：首页和各子页面均有导航栏入口

### API 扩展 (4 tasks)

- [ ] task: api_realms_civilization_filter
  标题：地域 API 文明筛选
  描述：GET /api/v1/realms/?civilization=EUROPEAN|EGYPTIAN
  文件：backend/apps/realms/views.py (已有 filterset_fields)
  验收标准：curl 测试返回正确筛选结果

- [ ] task: api_actors_civilization_filter
  标题：角色 API 文明筛选
  描述：GET /api/v1/actors/?civilization=EUROPEAN|EGYPTIAN
  文件：backend/apps/actors/views.py
  验收标准：curl 测试返回正确筛选结果

- [ ] task: api_localized_response
  标题：API 多语言响应
  描述：GET /api/v1/realms/?localized=true -H "Accept-Language: zh-Hans"
  文件：backend/apps/realms/serializers.py (已有实现，需测试)
  验收标准：Accept-Language header 正确影响 display_name

- [ ] task: api_actors_localized_response
  标题：角色 API 多语言响应
  描述：GET /api/v1/actors/?localized=true -H "Accept-Language: en"
  文件：backend/apps/actors/serializers.py
  验收标准：Accept-Language header 正确影响 display_name

### E2E 测试 (2 tasks)

- [ ] task: e2e_european_workflow
  标题：European 工作流端到端测试
  描述：创建 European 灵魂 → 死亡 → St. Peter 审判 → PASSED → Heaven
  文件：backend/tests/test_european_workflow.py (新建)
  验收标准：完整流程测试通过

- [ ] task: e2e_egyptian_workflow
  标题：Egyptian 工作流端到端测试
  描述：创建 Egyptian 灵魂 → 死亡 → Anubis 心脏称重 → 平衡 → Aaru
  文件：backend/tests/test_egyptian_workflow.py (新建)
  验收标准：完整流程测试通过

---

## Milestone 4: 业力系统与事件驱动

### 数据模型 (3 tasks)

- [ ] task: soulrecord_event_date
  标题：SoulRecord 增加 event_date 字段
  描述：记录事件发生时间（用于时间衰减计算）
  文件：backend/apps/souls/models.py, 迁移文件
  验收标准：SoulRecord 有 event_date 字段，默认为创建时间

- [ ] task: soulrecord_is_milestone
  标题：SoulRecord 增加 is_milestone 字段
  描述：标记重大事件，权重自动放大 2x
  文件：backend/apps/souls/models.py, 迁移文件
  验收标准：SoulRecord 有 is_milestone 布尔字段

- [ ] task: soulrecord_category_standardization
  标题：SoulRecord category 标准化
  描述：CHARITY, COMPASSION, HONESTY, CRUELTY, DECEPTION 等标准化类别
  文件：backend/apps/souls/models.py
  验收标准：categorychoices 枚举包含所有标准类别

### KarmaService 增强 (4 tasks)

- [ ] task: karma_time_decay
  标题：业力时间衰减
  描述：effective_score = original_score * e^(-0.01 * years_since_event)
  文件：backend/apps/karma/services.py
  验收标准：10年前的事件分数衰减约9%

- [ ] task: karma_milestone_boost
  标题：重大事件权重放大
  描述：is_milestone=True 的记录权重 × 2
  文件：backend/apps/karma/services.py
  验收标准：同一 category，milestone 事件的分数是普通事件的 2x

- [ ] task: karma_timeline_api
  标题：业力时间轴 API
  描述：GET /api/v1/souls/{id}/karma/timeline/
  文件：backend/apps/souls/views.py, serializers.py, urls.py
  验收标准：返回按时间排序的业力变化记录

- [ ] task: karma_redis_cache
  标题：Karma 汇总 Redis 缓存
  描述：Karma 汇总结果缓存 5 分钟（TTL=300）
  文件：backend/apps/karma/services.py
  验收标准：重复查询 karma 在 5 分钟内从缓存返回

### Celery 任务 (3 tasks)

- [ ] task: celery_recalculate_stale_karma
  标题：重新计算陈旧业力
  描述：每日任务，重新计算30天内有变动的灵魂业力（带时间衰减）
  文件：backend/config/celery.py (task定义)
  验收标准：Celery Beat 调度该任务，每日执行

- [ ] task: celery_check_overdue_reincarnation
  标题：检查逾期轮回
  描述：每小时检查 DISPOSED 超过30天未执行轮回的灵魂，发送警告
  文件：backend/config/celery.py
  验收标准：逾期灵魂生成 SoulEvent 警告记录

- [ ] task: celery_daily_report
  标题：每日统计报告任务
  描述：每日生成灵魂状态统计报告，写入 SoulEvent
  文件：backend/config/celery.py
  验收标准：Celery Beat 调度该任务，每日执行

### 前端业力可视化 (3 tasks)

- [ ] task: frontend_karma_chart
  标题：灵魂详情页业力图表
  描述：使用 Recharts 显示 Merit/Demerit 分类柱状图
  文件：frontend/app/souls/[id]/page.tsx
  验收标准：灵魂详情页显示可交互的业力柱状图

- [ ] task: frontend_karma_timeline_chart
  标题：业力时间轴图表
  描述：灵魂详情页底部显示时间轴形式的业力变化
  文件：frontend/app/souls/[id]/page.tsx
  验收标准：时间轴图表可交互，点击显示详情

- [ ] task: frontend_install_recharts
  标题：安装 Recharts 图表库
  描述：npm install recharts
  文件：frontend/package.json
  验收标准：Recharts 在 package.json dependencies 中

### API 扩展 (3 tasks)

- [ ] task: api_karma_timeline
  标题：业力时间轴 API
  描述：GET /api/v1/souls/{id}/karma/timeline/
  文件：backend/apps/souls/views.py
  验收标准：返回结构化的业力时间轴数据

- [ ] task: api_karma_recalculate
  标题：手动业力重算 API
  描述：POST /api/v1/souls/{id}/karma/recalculate/
  文件：backend/apps/karma/views.py (新建)
  验收标准：手动触发后返回新的业力汇总

- [ ] task: api_karma_breakdown
  标题：业力分类详情 API
  描述：GET /api/v1/souls/{id}/karma/breakdown/
  文件：backend/apps/karma/views.py
  验收标准：按 category 分组返回各分类的分数小计

---

## Milestone 5: 数据分析与可视化

### Dashboard API (5 tasks)

- [ ] task: api_stats_global
  标题：全局统计 API
  描述：GET /api/v1/stats/
  返回：{total_souls, by_state: {ALIVE: N, JUDGING: N, ...}, by_civilization: {...}}
  文件：backend/apps/stats/views.py (新建), urls.py
  验收标准：curl 测试返回正确统计数据

- [ ] task: api_stats_by_civilization
  标题：文明分布统计
  描述：GET /api/v1/stats/by-civilization/
  返回：{CHINESE: {ALIVE: N, JUDGING: N}, EUROPEAN: {...}, EGYPTIAN: {...}}
  文件：backend/apps/stats/views.py
  验收标准：三大文明分布数据正确

- [ ] task: api_stats_karma_distribution
  标题：业力分布直方图 API
  描述：GET /api/v1/stats/karma-distribution/
  返回：{buckets: [{"range": "-50~-20", "count": N}, ...]}
  文件：backend/apps/stats/views.py
  验收标准：返回6个 buckets 的分布数据

- [ ] task: api_stats_reincarnation_cycles
  标题：轮回周期统计 API
  描述：GET /api/v1/stats/reincarnation-cycles/
  返回：{avg_cycles: N, max_cycles: N, top_souls: [...]}
  文件：backend/apps/stats/views.py
  验收标准：平均和最高轮回次数正确

- [ ] task: api_stats_realm_occupancy
  标题：地域占用统计 API
  描述：GET /api/v1/stats/realm-occupancy/
  返回：{realms: [{code: "DY_01_HEAVEN", count: N}, ...]}
  文件：backend/apps/stats/views.py
  验收标准：各地域当前灵魂数量正确

### Dashboard 前端 (6 tasks)

- [ ] task: frontend_dashboard_page
  标题：Dashboard 主页面
  描述：/dashboard/page.tsx，实时统计概览
  文件：frontend/app/dashboard/page.tsx
  验收标准：页面可访问，数据实时加载

- [ ] task: frontend_state_pie_chart
  标题：状态分布饼图
  描述：使用 Recharts PieChart 显示 ALIVE/JUDGING/DISPOSED/REINCARNATING 分布
  文件：frontend/app/dashboard/page.tsx
  验收标准：饼图可交互，显示百分比

- [ ] task: frontend_civilization_bar_chart
  标题：文明分布柱状图
  描述：按文明的灵魂数量柱状图
  文件：frontend/app/dashboard/page.tsx
  验收标准：柱状图正确显示三大文明对比

- [ ] task: frontend_karma_histogram
  标题：业力分布直方图
  描述：使用 BarChart 显示6个 karma bucket 分布
  文件：frontend/app/dashboard/page.tsx
  验收标准：直方图显示业力分布

- [ ] task: frontend_top_reincarnated_souls
  标题：轮回最多灵魂列表
  描述：显示轮回次数最多的 Top 10 灵魂
  文件：frontend/app/dashboard/page.tsx
  验收标准：列表显示名称和轮回次数

- [ ] task: frontend_reincarnation_trend
  标题：轮回周期趋势
  描述：使用 LineChart 显示近30天的轮回数量趋势
  文件：frontend/app/dashboard/page.tsx
  验收标准：折线图显示每日轮回数量

---

## Milestone 6: 生产环境准备

### Docker & 部署 (5 tasks)

- [ ] task: docker_prod_compose
  标题：生产级 Docker Compose
  描述：docker-compose.prod.yml，多阶段构建，gunicorn workers
  文件：docker-compose.prod.yml
  验收标准：docker compose -f docker-compose.prod.yml up -d 成功启动

- [ ] task: docker_multistage_build
  标题：多阶段 Dockerfile 优化
  描述：builder stage (npm build) → runner stage (node start, gunicorn)
  文件：Dockerfile, Dockerfile.frontend
  验收标准：最终镜像大小 < 500MB

- [ ] task: nginx_https_config
  标题：Nginx HTTPS 配置
  描述：反向代理 + SSL 终止，HTTP → HTTPS 重定向
  文件：infrastructure/nginx.conf
  验收标准：curl -k https://localhost 返回前端

- [ ] task: env_example_documentation
  标题：环境变量完整文档
  描述：.env.example 包含所有环境变量说明（DB, Redis, Django, JWT secrets）
  文件：backend/.env.example, frontend/.env.example
  验收标准：新工程师按 .env.example 配置可正常启动服务

- [ ] task: health_check_endpoint
  标题：健康检查端点
  描述：GET /api/v1/health/ 返回 {db: "ok"|"error", redis: "ok"|"error"}
  文件：backend/config/urls.py
  验收标准：DB/Redis 断开时返回 error 状态

### 数据库 (3 tasks)

- [ ] task: db_backup_script
  标题：数据库备份脚本
  描述：每日全量 + 每小时增量备份脚本
  文件：scripts/backup_db.sh
  验收标准：脚本可执行，备份文件生成正确

- [ ] task: db_migration_strategy
  标题：Zero-downtime 迁移策略文档
  描述：如何在不停服情况下进行 Django 迁移
  文件：docs/MIGRATION_STRATEGY.md
  验收标准：文档包含具体的 migration 步骤

- [ ] task: db_pgbouncer_config
  标题：PgBouncer 连接池配置
  描述：减少 PostgreSQL 连接数，提高并发性能
  文件：infrastructure/pgbouncer.ini
  验收标准：PgBouncer 配置正确，连接池工作正常

### 监控 & 安全 (5 tasks)

- [ ] task: structlog_integration
  标题：结构化日志
  描述：Django 日志输出 JSON 格式
  文件：backend/config/settings.py
  验收标准：日志输出为有效 JSON

- [ ] task: sentry_integration
  标题：Sentry 集成
  描述：Django + Next.js 错误追踪
  文件：backend/config/settings.py, frontend/sentry.client.config.ts
  验收标准：Sentry 收到测试错误事件

- [ ] task: api_rate_limiting
  标题：API 限流
  描述：django-ratelimit，100 req/min 每 IP
  文件：backend/config/settings.py, 各 views.py
  验收标准：超出限制返回 429 状态码

- [ ] task: api_authentication
  标题：API 认证
  描述：Token 认证，DRF TokenAuthentication
  文件：backend/config/settings.py, 各 viewset
  验收标准：无 token 请求返回 401

- [ ] task: security_headers
  标题：安全响应头
  描述：CSP, HSTS, X-Frame-Options, X-Content-Type-Options
  文件：middleware/security.py (新建)
  验收标准：响应头包含所有安全配置
