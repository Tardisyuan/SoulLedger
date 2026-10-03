import { useState } from "react";
import { FilterChipToggle } from "soulledger";

// 定时任务页(app/scheduler)的单选筛选:同一时间只按下一个。
export const SchedulerFilters = () => {
  const [filter, setFilter] = useState("overdue");
  const items = [
    ["disabled", "只看已停用"],
    ["overdue", "超时未跑"],
    ["failing", "连续失败"],
  ];
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {items.map(([v, label]) => (
        <FilterChipToggle key={v} pressed={filter === v} onPressedChange={(p) => setFilter(p ? v : "all")}>
          {label}
        </FilterChipToggle>
      ))}
    </div>
  );
};

// 灵魂名册的「仅看有问题的」,带计数(app/souls)。
export const WithCount = () => {
  const [on, setOn] = useState(false);
  return (
    <FilterChipToggle pressed={on} onPressedChange={setOn}>
      仅看有问题的
      <span className="font-mono text-[oklch(var(--color-ink-subtle))]">7</span>
    </FilterChipToggle>
  );
};

export const Pressed = () => {
  const [on, setOn] = useState(true);
  return (
    <FilterChipToggle pressed={on} onPressedChange={setOn}>
      仅显示存在差异的行
    </FilterChipToggle>
  );
};

export const Disabled = () => (
  <FilterChipToggle pressed={false} onPressedChange={() => {}} disabled>
    连续失败
  </FilterChipToggle>
);
