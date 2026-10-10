import { Field } from "soulledger";

const input = { className: "w-full border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-3 py-2 text-sm text-[oklch(var(--color-ink))]" };

// 自定义控件的外壳:Field 只接 label/描述/错误,控件由 render-prop 拿到 id 与 aria 属性。
export const Default = () => (
  <div style={{ width: 340 }}>
    <Field label="审判官">{(c) => <input {...c} {...input} defaultValue="崔判官" />}</Field>
  </div>
);

// 带说明与必填标记,如灵魂登记表。
export const WithDescription = () => (
  <div style={{ width: 340 }}>
    <Field label="生辰" required description="按公历填写;公元前用负年份,如 -0399-05-07。">
      {(c) => <input {...c} {...input} defaultValue="1472-10-31" />}
    </Field>
  </div>
);

// 服务端拒绝后:整个字段进入错误态。
export const Error = () => (
  <div style={{ width: 340 }}>
    <Field label="功德值" required error="请输入 0 到 1000 之间的整数">
      {(c) => <input {...c} {...input} defaultValue="一千" />}
    </Field>
  </div>
);
