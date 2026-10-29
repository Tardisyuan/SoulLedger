"""rbac-scope(2026-10-29)第 9、13、14、15 条的修复,各一道守卫。

* 跨殿联审列表过 RowLevelDataScope(同文件 DispatchRecord 早就过了)。
* 审计行记在被改那一行的殿,不是操作人的租户上下文;按殿的到期检查在请求里同步调用后还原上下文。
* WS 消费者的首帧鉴权与 JWTAuthMiddleware 同一套规则。
* TenantQuerySetMixin 套在没有 `tenant` 列的模型上是配置错,直接报出来。
"""
import pytest
from rest_framework_simplejwt.tokens import AccessToken

from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus
from apps.tenants.managers import get_current_tenant, set_current_tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


# ── 第 9 条:跨殿联审列表过数据范围 ─────────────────────────────────────────


def test_the_cross_judgment_list_honours_the_data_scope(judge_user, cn_tenant):
    from apps.perm.models import Role, RowLevelDataScope

    active = CrossTenantJudgment.objects.create(title="进行中的联审", description="d", initiating_tenant=cn_tenant,
                                                tenant=cn_tenant, status=JudgmentStatus.ACTIVE)
    proposed = CrossTenantJudgment.objects.create(title="提议中的联审", description="d", initiating_tenant=cn_tenant,
                                                  tenant=cn_tenant, status=JudgmentStatus.PROPOSED)
    client = officer_client(judge_user)
    url = "/api/v1/dispatch/cross-tenant-judgments/"

    def ids():
        return {row["id"] for row in client.get(url).data["results"]}

    assert {str(active.pk), str(proposed.pk)} <= ids()  # 没有规则时两条都在
    RowLevelDataScope.objects.create(
        role=Role.objects.get_or_create(name="JUDGE")[0], model_name="crosstenantjudgment", scope_type="READ",
        filter_conditions={"status": JudgmentStatus.ACTIVE}, is_active=True,
    )
    seen = ids()
    assert str(active.pk) in seen and str(proposed.pk) not in seen
    assert client.get(f"{url}{proposed.pk}/").status_code == 404


# ── 第 13 条:审计行的殿 ────────────────────────────────────────────────────


def test_an_audit_row_belongs_to_the_hall_of_the_row_it_describes(cn_tenant, eu_tenant,
                                                                 django_capture_on_commit_callbacks):
    """操作人的上下文是欧洲(或没有,如无殿 ADMIN / Celery 全局任务),改的是中国的行 → 审计记中国。"""
    from apps.audit.models import AuditLog
    from apps.souls.models import Soul, SoulState

    for context in (eu_tenant, None):
        set_current_tenant(context)
        try:
            with django_capture_on_commit_callbacks(execute=True):
                soul = Soul.objects.create(name=f"审计归属{context}", tenant=cn_tenant, current_state=SoulState.ALIVE)
        finally:
            set_current_tenant(None)
        rows = AuditLog._base_manager.filter(resource_id=str(soul.pk))
        assert rows.exists()
        assert set(rows.values_list("tenant_id", flat=True)) == {cn_tenant.pk}, context


def test_a_model_without_a_tenant_column_still_takes_the_context(cn_tenant):
    from apps.audit.signals import _row_tenant_id
    from apps.perm.models import Role

    assert _row_tenant_id(Role(name="x"), cn_tenant) == cn_tenant.pk
    assert _row_tenant_id(Role(name="x"), None) is None


def test_the_expiry_check_restores_the_callers_tenant_context(cn_tenant, eu_tenant):
    """Django admin 的「立即检查到期」在请求里同步调按殿的任务;任务结束时清成 None 会让这次请求之后的审计丢殿。"""
    from apps.disposition.tasks import expire_due_dispositions_for_tenant

    set_current_tenant(cn_tenant)
    try:
        expire_due_dispositions_for_tenant(tenant_id=str(eu_tenant.pk))
        assert get_current_tenant() == cn_tenant
    finally:
        set_current_tenant(None)
    expire_due_dispositions_for_tenant(tenant_id=str(eu_tenant.pk))
    assert get_current_tenant() is None  # Celery 里调用前是 None,之后仍是 None


# ── 第 14 条:WS 首帧鉴权 ───────────────────────────────────────────────────


def _consumer_auth(raw):
    from apps.notifications.consumers import NotificationConsumer

    return NotificationConsumer.__dict__["_authenticate_token"].func(NotificationConsumer(), raw)


def test_the_consumers_first_frame_auth_uses_the_middlewares_rules(django_user_model, cn_tenant, eu_tenant):
    user = django_user_model.objects.create_user(username="ws_rules", password="x", role="JUDGE", tenant=cn_tenant)
    good = AccessToken.for_user(user)
    good["tenant_code"] = cn_tenant.code
    assert _consumer_auth(str(good)).pk == user.pk  # control: a sound token still passes

    wrong_hall = AccessToken.for_user(user)
    wrong_hall["tenant_code"] = eu_tenant.code
    assert _consumer_auth(str(wrong_hall)) is None

    django_user_model.objects.filter(pk=user.pk).update(session_version=5)
    assert _consumer_auth(str(good)) is None  # 改密码 / 退出全部设备之后签发更早的令牌
    django_user_model.objects.filter(pk=user.pk).update(session_version=0, is_active=False)
    assert _consumer_auth(str(good)) is None

    soul_user = django_user_model.objects.create_user(username="ws_soul", password="x", role="SOUL", tenant=cn_tenant)
    assert _consumer_auth(str(AccessToken.for_user(soul_user))) is None


# ── 第 15 条:TenantQuerySetMixin 默认 "error" ──────────────────────────────


def test_tenant_scoping_a_model_without_a_tenant_column_is_a_configuration_error(judge_user):
    from django.core.exceptions import ImproperlyConfigured
    from rest_framework import viewsets
    from rest_framework.test import APIRequestFactory

    from apps.core.mixins import TenantQuerySetMixin
    from apps.perm.models import Role

    class _Global(TenantQuerySetMixin, viewsets.ReadOnlyModelViewSet):
        queryset = Role.objects.all()

    request = APIRequestFactory().get("/")
    request.user = judge_user
    view = _Global(request=request, action="list")
    with pytest.raises(ImproperlyConfigured):
        view.get_queryset()

    _Global.tenant_missing_field = "allow"
    request.tenant = judge_user.tenant
    assert view.get_queryset().model is Role  # explicit opt-in: unscoped, no error
