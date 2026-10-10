import { StatusCard, Button } from "soulledger";

const retry = <Button variant="secondary" size="sm">回到首页</Button>;

// 403:缺少权限,细节行写缺的权限码。
export const Forbidden = () => (
  <div style={{ width: 460 }}>
    <StatusCard code="403" title="无权访问" message="你的角色不能查看酆都判决库。" detail="perm: judgment.review" action={retry} />
  </div>
);

// 404:细节行写没找到的路径。
export const NotFound = () => (
  <div style={{ width: 460 }}>
    <StatusCard code="404" title="页面不存在" message="这一页不在生死簿里。" detail="/souls/9999" action={retry} />
  </div>
);

// 500:红色代码,role=alert。
export const Fault = () => (
  <div style={{ width: 460 }}>
    <StatusCard code="500" title="出错了" message="服务暂时无法响应,请稍后再试。" detail="trace a41f9c07" action={<Button variant="secondary" size="sm">重试</Button>} />
  </div>
);
