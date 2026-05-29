"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { karmaApi, type KarmaStatsOverview } from "@/lib/api";
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
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useTenant();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) {
      router.replace("/login");
    }
  }, [user, router]);

  // Don't render anything while checking auth
  if (!user) return null;
  const [stats, setStats] = useState<KarmaStatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [agents, setAgents] = useState<AgentStatus[]>([]);

  useEffect(() => {
    // Load dashboard stats
    karmaApi.statsOverview()
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
          { name: "karma-decay", status: "idle" },
          { name: "judgment-assistant", status: "active", task: "辅助审判" },
        ]);
      } catch {
        // Silently fail if MCP tools unavailable
      }
    };
    fetchAgentStatus();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return { text: t("nav.greeting_night") || "夜深了", icon: "🌙" };
    if (hour < 12) return { text: t("nav.greeting_morning") || "上午好", icon: "☀️" };
    if (hour < 18) return { text: t("nav.greeting_afternoon") || "下午好", icon: "🌤️" };
    return { text: t("nav.greeting_evening") || "晚上好", icon: "🌙" };
  };

  const greeting = getGreeting();

  const quickStats: QuickStat[] = [
    {
      label: t("dashboard.total_souls"),
      value: stats?.total_souls ?? "-",
      icon: <Users className="w-5 h-5" />,
      color: "text-[hsl(var(--color-accent))]",
    },
    {
      label: t("dashboard.under_judgment"),
      value: stats?.state_distribution.find(s => s.state === "JUDGING")?.count ?? "-",
      icon: <Scale className="w-5 h-5" />,
      color: "text-amber-400",
    },
    {
      label: t("dashboard.alive"),
      value: stats?.state_distribution.find(s => s.state === "ALIVE")?.count ?? "-",
      icon: <Activity className="w-5 h-5" />,
      color: "text-emerald-400",
    },
    {
      label: t("dashboard.disposed"),
      value: stats?.state_distribution.find(s => s.state === "DISPOSED")?.count ?? "-",
      icon: <ScrollText className="w-5 h-5" />,
      color: "text-blue-400",
    },
  ];

  const quickActions = [
    { label: t("souls.create"), href: "/souls", icon: <Users className="w-5 h-5" />, color: "bg-blue-500/20 text-blue-400" },
    { label: t("workflow.title"), href: "/workflow", icon: <ScrollText className="w-5 h-5" />, color: "bg-purple-500/20 text-purple-400" },
    { label: t("judgment.title"), href: "/judgment", icon: <Scale className="w-5 h-5" />, color: "bg-amber-500/20 text-amber-400" },
    { label: t("karma.title"), href: "/karma", icon: <TrendingUp className="w-5 h-5" />, color: "bg-emerald-500/20 text-emerald-400" },
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
    return date.toLocaleDateString("zh-CN");
  };

  return (
    <div className="min-h-screen bg-canvas text-[hsl(var(--color-ink))] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Welcome Header */}
        <header className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(var(--color-surface-1))] to-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] p-6 md:p-8">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">{greeting.icon}</span>
              <h1 className="text-2xl md:text-3xl font-bold text-[hsl(var(--color-accent))]">
                {greeting.text}, {user?.display_name || user?.username || "Admin"}
              </h1>
            </div>
            <p className="text-[hsl(var(--color-ink-muted))]">
              {t("home.hero_subtitle")} · {new Date().toLocaleDateString("zh-CN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          {/* Decorative background */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-[hsl(var(--color-accent))] opacity-5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-1/2 w-48 h-48 bg-[hsl(var(--color-accent))] opacity-5 rounded-full translate-y-1/2 -translate-x-1/2" />
        </header>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickStats.map((stat, i) => (
            <div
              key={i}
              className="bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))] hover:border-[hsl(var(--color-accent))]/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`${stat.color}`}>{stat.icon}</span>
                {stat.trend && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> {stat.trend}
                  </span>
                )}
              </div>
              <div className="text-2xl md:text-3xl font-bold text-[hsl(var(--color-ink))] mb-1">
                {loading ? "..." : stat.value}
              </div>
              <div className="text-xs text-[hsl(var(--color-ink-muted))]">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions */}
          <div className="lg:col-span-2 bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-5">
            <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))] mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-[hsl(var(--color-accent))]" />
              {t("welcome.quick_actions")}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {quickActions.map((action, i) => (
                <Link
                  key={i}
                  href={action.href}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg ${action.color} hover:opacity-80 transition-opacity group`}
                >
                  {action.icon}
                  <span className="text-sm font-medium">{action.label}</span>
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </div>
          </div>

          {/* Agent Status */}
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-5">
            <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))] mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-[hsl(var(--color-accent))]" />
              {t("welcome.agent_status")}
            </h2>
            <div className="space-y-3">
              {agents.map((agent, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 bg-[hsl(var(--color-surface-2))] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      agent.status === "active" ? "bg-emerald-400 animate-pulse" :
                      agent.status === "busy" ? "bg-amber-400" : "bg-gray-400"
                    }`} />
                    <div>
                      <div className="text-sm font-medium text-[hsl(var(--color-ink))]">{agent.name}</div>
                      {agent.task && (
                        <div className="text-xs text-[hsl(var(--color-ink-muted))]">{agent.task}</div>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    agent.status === "active" ? "bg-emerald-400/20 text-emerald-400" :
                    agent.status === "busy" ? "bg-amber-400/20 text-amber-400" : "bg-gray-400/20 text-gray-400"
                  }`}>
                    {agent.status === "active" ? t("welcome.running") : agent.status === "busy" ? t("welcome.working") : t("welcome.idle")}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-[hsl(var(--color-hairline))]">
              <Link
                href="/settings"
                className="text-sm text-[hsl(var(--color-accent))] hover:underline flex items-center gap-1"
              >
                <Sparkles className="w-4 h-4" />
                {t("welcome.manage_agents")}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-5">
          <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))] mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-[hsl(var(--color-accent))]" />
            {t("welcome.recent_activity")}
          </h2>
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-3 bg-[hsl(var(--color-surface-2))] rounded-lg hover:bg-[hsl(var(--color-surface-3))] transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-[hsl(var(--color-accent))]/10 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-5 h-5 text-[hsl(var(--color-accent))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-[hsl(var(--color-surface-1))] text-[hsl(var(--color-ink-muted))]">
                      {activity.action}
                    </span>
                    <span className="text-xs text-[hsl(var(--color-ink-subtle))]">
                      {formatTimestamp(activity.timestamp)}
                    </span>
                  </div>
                  <div className="text-sm text-[hsl(var(--color-ink))]">{activity.description}</div>
                  <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">by {activity.user}</div>
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/audit"
            className="mt-4 text-sm text-[hsl(var(--color-accent))] hover:underline flex items-center gap-1"
          >
            {t("welcome.view_all_activity")}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* System Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Globe className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <div className="text-sm text-[hsl(var(--color-ink-muted))]">{t("welcome.current_civilization")}</div>
              <div className="text-lg font-semibold text-[hsl(var(--color-ink))]">{user?.tenant?.display_name || "SoulLedger"}</div>
            </div>
          </div>
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="text-sm text-[hsl(var(--color-ink-muted))]">{t("welcome.user_role")}</div>
              <div className="text-lg font-semibold text-[hsl(var(--color-ink))]">{user?.role || "ADMIN"}</div>
            </div>
          </div>
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <div className="text-sm text-[hsl(var(--color-ink-muted))]">{t("welcome.system_version")}</div>
              <div className="text-lg font-semibold text-[hsl(var(--color-ink))]">v0.1</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
