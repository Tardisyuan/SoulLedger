"""「已执行」这个标记,只在事情真的发生之后才写下。

两条缺陷,同一个形状 —— **先记录,后做事,而做事失败了没人接住**:

  `DispositionService.execute` 先写 `is_executed`/`executed_at` 并 `save()`,再调
    `transition_to` 且**丢弃返回值**,最后无条件 `return True`。没有 `atomic()`,
    所以处置行已经落盘。实测:一个 ALIVE 的灵魂 + 一条 Disposition,
    `execute(d)` 返回 True、`is_executed=True`,而 `current_state` 仍是 ALIVE ——
    **处置记录说「已执行」,而灵魂从未被处置**,接口返回 200。

  `ReincarnationService.execute` 同样丢弃返回值,并在转换成功与否确定之前就写下
    `REINCARNATION_TRIGGERED`。于是每一个被执行的埃及/欧洲处置,时间线上都留下
    一条「已触发轮回」—— **正是 `SoulState.SETTLED` 的注释说这个状态存在就是为了
    不再说的那种谎**。

**为什么没人发现,值得单独记:** `apps/disposition/tests.py::_execute_for` 只调
`DispositionService.execute`,**从不调视图紧接着调用的
`ReincarnationService.execute`** —— 测试装置比生产路径少一步。而全仓没有任何测试
断言过 `REINCARNATION_TRIGGERED` 对终局宇宙观**不该出现**。

所以下面每一条都走**接口**,不走服务方法:少一步的装置正是这两条缺陷藏身的地方。
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.fixture
def client(api_client, admin_user):
    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


def tenant_for(code, name):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": name})[0]


def make(tenant, state):
    soul = Soul.objects.create(name=f"probe-{state}", tenant=tenant, current_state=state)
    disposition = Disposition.objects.create(soul=soul, tenant=tenant)
    return soul, disposition


def event_types(soul):
    return list(SoulEvent.objects.filter(soul=soul).values_list("event_type", flat=True))


@pytest.mark.django_db
def test_a_disposition_that_cannot_move_the_soul_is_not_marked_executed(client, cn_tenant):
    """核心的那一条。ALIVE → DISPOSED 这条边不存在。"""
    soul, disposition = make(cn_tenant, SoulState.ALIVE)

    response = client.post(f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json")

    assert response.status_code == 409, response.data
    disposition.refresh_from_db()
    soul.refresh_from_db()
    # 三样都要断言:标记、时间戳、灵魂状态。只查其中一样的话,一个「写了标记
    # 但没写时间戳」的实现看起来也像修好了。
    assert disposition.is_executed is False
    assert disposition.executed_at is None
    assert soul.current_state == SoulState.ALIVE


@pytest.mark.django_db
def test_a_disposition_that_can_move_the_soul_is_marked_executed(client, cn_tenant):
    """正对照。没有它,一个「永远拒绝执行」的实现同样满足上面那条,
    而那会让处置功能整个停摆。"""
    soul, disposition = make(cn_tenant, SoulState.DISPOSED)

    response = client.post(f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json")

    assert response.status_code == 200, response.data
    disposition.refresh_from_db()
    soul.refresh_from_db()
    assert disposition.is_executed is True
    assert disposition.executed_at is not None
    assert soul.current_state == SoulState.REINCARNATING


@pytest.mark.django_db
def test_a_terminal_cosmology_gets_no_reincarnation_event(client):
    """埃及的灵魂进入 Aaru,时间线上不该出现「已触发轮回」。

    断言的是**缺席**,而这正是全仓此前一条都没有的那种断言。配一条在场断言
    (下一条)才有意义 —— 单独一条「不该有 X」在事件流整个坏掉时也成立。
    """
    duat = tenant_for("EG_DUAT", "Egyptian Duat")
    soul, disposition = make(duat, SoulState.DISPOSED)

    response = client.post(f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json")
    assert response.status_code == 200, response.data

    soul.refresh_from_db()
    assert soul.current_state == SoulState.SETTLED, "埃及没有下一世,应当落在 SETTLED"
    assert "REINCARNATION_TRIGGERED" not in event_types(soul), (
        f"进入 Aaru 的灵魂被记了「已触发轮回」:{event_types(soul)}"
    )
    # 事件流本身是活的 —— 否则上面那句「不该有」是因为什么都没有才成立的。
    assert "STATE_CHANGED" in event_types(soul)


@pytest.mark.django_db
def test_a_rebirth_capable_cosmology_does_get_the_event(client, cn_tenant):
    """在场那一半。中国的灵魂有下一世,这条事件应当出现。"""
    soul, disposition = make(cn_tenant, SoulState.DISPOSED)

    response = client.post(f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json")
    assert response.status_code == 200, response.data

    soul.refresh_from_db()
    assert soul.current_state == SoulState.REINCARNATING
    assert "REINCARNATION_TRIGGERED" in event_types(soul)


@pytest.mark.django_db
def test_the_view_calls_both_services_the_way_production_does(client, cn_tenant):
    """钉住那条「装置比生产路径少一步」。

    `apps/disposition/tests.py::_execute_for` 只调 `DispositionService.execute`。
    这条从接口打进去,于是两个服务都被走到 —— 只要哪天视图里那一步被删掉,
    上面 `test_a_rebirth_capable_cosmology_does_get_the_event` 就会红。
    这一条把这件事写出来,免得下一个人看不出那条断言在守什么。
    """
    import ast
    import inspect
    import textwrap

    from apps.disposition import views

    # 用 AST 找**调用**,不是在源码里找字符串。第一版是后者,而它一次也没红过:
    # 我写在这段代码上方的注释里就有 `ReincarnationService.execute` 这几个字,
    # 于是守卫匹配到了它自己的文档。把那一行调用整个删掉,它照样绿。
    # 这与 `suiteShape.test.ts` 那条规则第一版把说明自己的两份文件报成违规者
    # 是同一件事的两个方向 —— 注释与代码在同一段文本里,而扫描器分不出来。
    # `dedent`,不是 `lstrip`:后者只去掉整串的首行缩进,剩下几行仍然缩进,
    # `ast.parse` 当场抛 IndentationError。
    tree = ast.parse(
        textwrap.dedent(inspect.getsource(views.DispositionViewSet.execute))
    )
    called = {
        f"{node.func.value.id}.{node.func.attr}"
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
    }
    assert "ReincarnationService.execute" in called, (
        f"视图不再调用 ReincarnationService(实际调用:{sorted(called)}) —— "
        f"若这是有意的,上面两条事件断言要一起改"
    )
    assert "DispositionService.execute" in called
