"""评测专用的两个身份(用户 2026-09-29 定:灵魂一个、测评官员一个)。

只有 `ensure()` 会写 `AssistConfig.eval_soul_account` / `eval_officer`:PATCH 不认这两个字段,
所以「评测身份」只可能是本模块造的 —— 管理员不能把真灵魂或 ADMIN 指成评测身份。
两个身份都是**不可用密码**(从不登录);官员是 MODERATOR(有收件箱与派发权限,四个官员工具都能演练),绝不是 ADMIN。
"""
from django.db import transaction

from apps.soul_assist import config
from apps.soul_assist.models import AssistConfig

SOUL_NAME = "问一问评测灵魂"
OFFICER_USERNAME = "assist-eval-officer"
OFFICER_ROLE = "MODERATOR"


def live_account(account_id):
    """配置里的评测灵魂账号还在用就返回它;被删 / 停用 / 转世退役就是 None。"""
    from apps.soul_accounts.models import SoulAccount

    if account_id is None:
        return None
    return (SoulAccount.objects.select_related("soul", "user")
            .filter(pk=account_id, retired_at__isnull=True, user__is_active=True).first())


def live_officer(user_id):
    from apps.authentication.models import User

    if user_id is None:
        return None
    return User.objects.select_related("tenant").filter(pk=user_id, is_active=True).exclude(role="SOUL").first()


def _tenant():
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.filter(code="CN_DIYU", is_active=True).first()
    if tenant is not None:
        return tenant, ""
    tenant = Tenant.objects.filter(is_active=True).order_by("pk").first()
    if tenant is None:
        raise RuntimeError("没有可用的殿(租户),造不出评测身份。")
    return tenant, f"没有 CN_DIYU,改用第一个在用的殿 {tenant.code}。"


def _make_soul(tenant):
    from django.utils import timezone

    from apps.sentence_plan.models import SentencePlan, SentencePlanStatus
    from apps.soul_accounts import services
    from apps.soul_accounts.models import AccountOrigin, InitialCredential
    from apps.souls.models import Soul, SoulState

    soul = Soul.objects.create(name=SOUL_NAME, tenant=tenant, current_state=SoulState.REINCARNATING)
    account, _ = services.provision_account(soul, AccountOrigin.OFFICER)
    # 开号会签一个初始密码与凭据:评测灵魂从不登录,把它们都废掉。
    account.user.set_unusable_password()
    account.user.save(update_fields=["password"])
    account.must_change_password = False
    account.initial_password_expires_at = None
    account.save(update_fields=["must_change_password", "initial_password_expires_at"])
    InitialCredential.objects.filter(account=account).delete()
    # 受刑计划已完成、在轮回中(与 tests/soul_account_support.py::sentence_served 一致)。
    SentencePlan.all_objects.create(soul=soul, tenant_id=soul.home_tenant_id or soul.tenant_id, cycle=account.cycle,
                                    status=SentencePlanStatus.COMPLETED, completed_at=timezone.now())
    return account


def _make_officer(tenant):
    from apps.authentication.models import User

    user = User.objects.filter(username=OFFICER_USERNAME).first()
    if user is None:
        user = User(username=OFFICER_USERNAME, role=OFFICER_ROLE, tenant=tenant, display_name="问一问评测官员")
    user.role, user.is_active = OFFICER_ROLE, True  # 复活时也不许留在更高的角色上
    user.set_unusable_password()
    user.save()
    return user


def ensure(admin, request=None):
    """幂等:缺哪个补哪个,存在的原样保留。返回 `(account, officer, note)`。"""
    with transaction.atomic():
        AssistConfig.objects.get_or_create(pk=1)
        row = AssistConfig.objects.select_for_update().get(pk=1)
        account, officer, note = live_account(row.eval_soul_account_id), live_officer(row.eval_officer_id), ""
        refs = {}
        if account is None or officer is None:
            tenant, note = _tenant()
            if account is None:
                account = _make_soul(tenant)
                refs["eval_soul_account_id"] = account.pk
            if officer is None:
                officer = _make_officer(tenant)
                refs["eval_officer_id"] = officer.pk
        if refs:
            config.save_changes(row, user=admin, description="assistant eval identities created", request=request,
                                refs=refs)
    return account, officer, note
