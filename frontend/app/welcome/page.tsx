"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { ledgerApi, type LedgerStatsOverview } from "@/lib/api";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import {
  Users,
  Scale,
  ScrollText,
  Activity,
  Sparkles,
  ArrowRight,
  Bot,
  Zap,
  Clock,
  TrendingUp,
  Shield,
  Globe
} from "lucide-react";

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  trend?: string;
}

interface Activity {
  id: number;
  action: string;
  description: string;
  user: string;
  timestamp: string;
}

interface AgentStatus {
  name: string;
  status: "active" | "idle" | "busy";
  task?: string;
}

export default function WelcomePage() {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();

  // No auth guard here on purpose. middleware.ts lists /welcome as a public
  // path, and route protection is its job everywhere else in the app. The
  // guard this replaced redirected on `!user`, which is also the state during
  // the first render — `user` hydrates from localStorage in an effect — so a
  // signed-in visitor got bounced to /login before hydration ever ran. Every
  // read of `user` below is optional-chained with a fallback.
  const [stats, setStats] = useState<LedgerStatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [agents, setAgents] = useState<AgentStatus[]>([]);

  useEffect(() => {
    // Load dashboard stats
    ledgerApi.statsOverview()
      .then((res) => {
        setStats(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Load recent activity
    // Mock activities for now - integrate with audit API
    setActivities([
      { id: 1, action: "SOUL_CREATE", description: "新灵魂 张三 入库", user: "admin", timestamp: new Date().toISOString() },
      { id: 2, action: "JUDGMENT_COMPLETE", description: "灵魂 李四 完成审判", user: "admin", timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: 3, action: "WORKFLOW_ADVANCE", description: "审批流程 #12 推进", user: "guardian", timestamp: new Date(Date.now() - 7200000).toISOString() },
    ]);
  }, []);

  // Fetch agent statuses via MCP tools (if available)
  useEffect(() => {
    const fetchAgentStatus = async () => {
      try {
        // Placeholder for Ruflo agent status integration
        // In production, this would call the MCP tools
        setAgents([
          { name: "soul-indexer", status: "active", task: "索引新灵魂" },
          { name: "ledger-decay", status: "idle" },
          { name: "judgment-assistant", status: "active", task: "辅助审判" },
        ]);
      } catch {
        // Silently fail if MCP tools unavailable
      }
    };
    fetchAgentStatus();
  }, []);

  // 三个 emoji(🌙 ☀️ 🌤️)去掉了,不是因为「不严肃」,是因为它们是这一页
  // 唯一一处字形不由本仓库的三支字族决定的内容 —— emoji 由操作系统的字体
  // 提供,苹果、Windows、Android 各画各的,而它现在要坐在 PageShell 那个
  // `text-07`(32px,字距 -0.02em)的标题里。一个 32px 的彩色系统字形挨着
  // 32px 的排版字,两者的基线、字重、色彩都不受这套设计系统管辖。
  // 时段本身没有信息量 —— 问候语已经说了「上午好」。
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return t("nav.greeting_night") || "夜深了";
    if (hour < 12) return t("nav.greeting_morning") || "上午好";
    if (hour < 18) return t("nav.greeting_afternoon") || "下午好";
    return t("nav.greeting_evening") || "晚上好";
  };

  const greeting = getGreeting();

  // 四个图标的颜色现在**就是它们各自计数的那个状态的 token**,而不是四个
  // 挑出来还算好看的裸调色板值。迁移前它们是 accent / amber-400 /
  // emerald-400 / blue-400 —— 后三个在浅色下过淡(整条 400 档是给深底用的),
  // 而 `text-[hsl(var(--color-accent))]` 作为**文字**在浅色下是 2.14:1,
  // globals.css 的 --color-accent-ink 就是为这件事存在的。
  //
  // DISPOSED 那处 `text-blue-400` 值得单说:globals.css:235 写着
  // `--color-status-disposed: 285 55% 66%`,注释是「was a second blue」——
  // 蓝是 DISPOSED **被移走**的那个值,让位给 PURGATORY。这一处是那次搬迁
  // 漏下的最后一个蓝,它一直在渲染一个已经改判给别人的颜色。
  const quickStats: QuickStat[] = [
    {
      label: t("dashboard.total_souls"),
      value: stats?.total_souls ?? "-",
      icon: <Users className="w-5 h-5" />,
      color: "text-[hsl(var(--color-accent-ink))]",
    },
    {
      label: t("dashboard.under_judgment"),
      value: stats?.state_distribution?.find(s => s.state === "JUDGING")?.count ?? "-",
      icon: <Scale className="w-5 h-5" />,
      color: "text-[hsl(var(--color-status-judging))]",
    },
    {
      label: t("dashboard.alive"),
      value: stats?.state_distribution?.find(s => s.state === "ALIVE")?.count ?? "-",
      icon: <Activity className="w-5 h-5" />,
      color: "text-[hsl(var(--color-status-alive))]",
    },
    {
      label: t("dashboard.disposed"),
      value: stats?.state_distribution?.find(s => s.state === "DISPOSED")?.count ?? "-",
      icon: <ScrollText className="w-5 h-5" />,
      color: "text-[hsl(var(--color-status-disposed))]",
    },
  ];

  // `color` 没了,四块砖现在长得一样。蓝/紫/琥珀/绿这四种色不编码任何东西
  // ——「灵魂」不是蓝的,「审批流」不是紫的 —— 但它们和这一页别处**确实**在
  // 编码状态的琥珀与绿是同一批色相,于是读者要先学会「这四块的颜色不算数,
  // 那四个图标的算数」。区分这四个动作的是图标和标签,那两样已经够了。
  const quickActions = [
    { label: t("souls.create"), href: "/souls", icon: <Users className="w-5 h-5" /> },
    { label: t("workflow.title"), href: "/workflow", icon: <ScrollText className="w-5 h-5" /> },
    { label: t("judgment.title"), href: "/judgment", icon: <Scale className="w-5 h-5" /> },
    { label: t("ledger.title"), href: "/ledger", icon: <TrendingUp className="w-5 h-5" /> },
  ];

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("welcome.just_now");
    if (minutes < 60) return t("welcome.minutes_ago", { n: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("welcome.hours_ago", { n: String(hours) });
    return formatDate(date);
  };

  return (
    <PageShell
      variant="page"
      // 迁移前这一页的标题住在一张 `rounded-xl` 的英雄卡里(见下面关于渐变的
      // 那段),卡片本身就是 PageShell 页头要做的事,所以卡片整个没了。
      title={`${greeting}, ${user?.display_name || user?.username || "Admin"}`}
      subtitle={`${t("home.hero_subtitle")} · ${formatDate(new Date(), { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}
    >
      <div className="space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickStats.map((stat, i) => (
            <div
              key={i}
              className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className={stat.color}>{stat.icon}</span>
                {stat.trend && (
                  <span className="text-02 text-[hsl(var(--color-status-success))] flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> {stat.trend}
                  </span>
                )}
              </div>
              {/* `text-07`(32px),不是 dashboard 那档 `text-08`(56px)。同样
                  四个数字,两个页面给两档,是因为两页在说不同的话:dashboard
                  是读数页,这四个数就是那一页的主体;这里它们是问候语旁边的
                  一行近况,和标题平级。`tabular-nums` 让四张卡的数字对齐 ——
                  这里不做千位分隔,`stat.value` 是 `number | string` 联合,
                  非数字那一支是字面量 "-"。 */}
              <div data-kpi="" className="text-07 tabular-nums text-[hsl(var(--color-ink))]">
                {loading ? "..." : stat.value}
              </div>
              <div className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions */}
          <div className="lg:col-span-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
            <h2 className="text-05 font-semibold text-[hsl(var(--color-ink))] mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-[hsl(var(--color-accent-ink))]" />
              {t("welcome.quick_actions")}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {quickActions.map((action, i) => (
                <Link
                  key={i}
                  href={action.href}
                  className="flex flex-col items-center justify-center gap-2 p-4 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink))] hover:bg-[hsl(var(--color-surface-3))] transition-colors group"
                >
                  {action.icon}
                  <span className="text-03 font-medium">{action.label}</span>
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </div>
          </div>

          {/* Agent Status */}
          <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
            <h2 className="text-05 font-semibold text-[hsl(var(--color-ink))] mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-[hsl(var(--color-accent-ink))]" />
              {t("welcome.agent_status")}
            </h2>
            <div className="space-y-3">
              {agents.map((agent, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 bg-[hsl(var(--color-surface-2))]"
                >
                  <div className="flex items-center gap-3">
                    {/* 系统层的 success/warning,不是域层的 status-alive /
                        status-judging。globals.css 把这两层分开写着,即使某些
                        值当下相同 —— 一个后台 agent 在跑,不是一个灵魂活着。
                        rounded-full 在这里是留着的:2px 的点,方的会看不出是点。 */}
                    <div className={`w-2 h-2 rounded-full ${
                      agent.status === "active" ? "bg-[hsl(var(--color-status-success))] animate-pulse" :
                      agent.status === "busy" ? "bg-[hsl(var(--color-status-warning))]" : "bg-[hsl(var(--color-ink-tertiary))]"
                    }`} />
                    <div>
                      <div className="text-03 font-medium text-[hsl(var(--color-ink))]">{agent.name}</div>
                      {agent.task && (
                        <div className="text-02 text-[hsl(var(--color-ink-muted))]">{agent.task}</div>
                      )}
                    </div>
                  </div>
                  <span className={`text-02 px-2 py-1 ${
                    agent.status === "active" ? "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))]" :
                    agent.status === "busy" ? "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))]" : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"
                  }`}>
                    {agent.status === "active" ? t("welcome.running") : agent.status === "busy" ? t("welcome.working") : t("welcome.idle")}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-[hsl(var(--color-hairline))]">
              <Link
                href="/settings"
                className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline flex items-center gap-1"
              >
                <Sparkles className="w-4 h-4" />
                {t("welcome.manage_agents")}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
          <h2 className="text-05 font-semibold text-[hsl(var(--color-ink))] mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-[hsl(var(--color-accent-ink))]" />
            {t("welcome.recent_activity")}
          </h2>
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-3 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] transition-colors"
              >
                <div className="w-10 h-10 bg-[hsl(var(--color-accent)/0.1)] flex items-center justify-center flex-shrink-0">
                  <Activity className="w-5 h-5 text-[hsl(var(--color-accent-ink))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-02 px-2 py-1 bg-[hsl(var(--color-surface-1))] text-[hsl(var(--color-ink-muted))]">
                      <DomainEnum namespace="audit.actions" value={activity.action} />
                    </span>
                    <span className="text-02 text-[hsl(var(--color-ink-subtle))]">
                      {formatTimestamp(activity.timestamp)}
                    </span>
                  </div>
                  <div className="text-03 text-[hsl(var(--color-ink))]">{activity.description}</div>
                  <div className="text-02 text-[hsl(var(--color-ink-muted))] mt-1">by {activity.user}</div>
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/audit"
            className="mt-4 text-03 text-[hsl(var(--color-accent-ink))] hover:underline flex items-center gap-1"
          >
            {t("welcome.view_all_activity")}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* System Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 三块图标砖原来是 blue-500/20 + blue-400、emerald、purple。文明、
              角色、版本号三样里没有一样是状态,所以三种色相编码的是「这是第
              一块、第二块、第三块」—— 那已经由位置说了。 */}
          <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-[hsl(var(--color-surface-2))] flex items-center justify-center">
              <Globe className="w-6 h-6 text-[hsl(var(--color-ink-subtle))]" />
            </div>
            <div>
              <div className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("welcome.current_civilization")}</div>
              <div className="text-05 font-semibold text-[hsl(var(--color-ink))] mt-1">{user?.tenant?.display_name || "SoulLedger"}</div>
            </div>
          </div>
          <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-[hsl(var(--color-surface-2))] flex items-center justify-center">
              <Shield className="w-6 h-6 text-[hsl(var(--color-ink-subtle))]" />
            </div>
            <div>
              <div className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("welcome.user_role")}</div>
              <div className="text-05 font-semibold text-[hsl(var(--color-ink))] mt-1">{user?.role || "ADMIN"}</div>
            </div>
          </div>
          <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-[hsl(var(--color-surface-2))] flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-[hsl(var(--color-ink-subtle))]" />
            </div>
            <div>
              <div className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("welcome.system_version")}</div>
              <div className="text-05 font-semibold text-[hsl(var(--color-ink))] mt-1">v0.1</div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
