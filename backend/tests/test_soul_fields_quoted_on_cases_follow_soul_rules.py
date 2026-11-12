"""审判 / 处置 / 调拨 / 受刑计划里引自灵魂的字段跟 Soul 的字段规则走(用户 2026-11-11 拍板,P-11 的续)。

`soul_name` 是灵魂的 `name` 抄在案子上。一条「JUDGE 看不到 Soul.name」的规则此前只管灵魂详情与列表,
审判队列、处置列表照样把名字印在案子旁边。口径与灵魂列表相同:被藏就删键(`SoulFieldRulesMixin`)。

两层:接口上审判列表真的删了键(规则生效前有、生效后无、没有规则的角色照有);
声明上,这几个模块里每个 `source="soul.<字段>"` 的序列化器字段都登记在 `soul_field_keys` 里 ——
新加一个引自灵魂的字段而忘了登记，这里会点名。
"""
import inspect

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.core.field_permissions import SoulFieldRulesMixin
from apps.judgment.models import Judgment
from apps.perm.models import FieldPermission, Role
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


def _client(user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _case_row(client, case):
    response = client.get("/api/v1/judgment/")
    assert response.status_code == 200, response.content
    return next(r for r in response.json()["results"] if r["id"] == str(case.pk))


@pytest.mark.django_db
def test_the_judgment_list_drops_the_soul_name_the_soul_rule_hides():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    soul = Soul.objects.create(name="Quoted Soul", current_state=SoulState.JUDGING, tenant=tenant)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant)
    judge = _client(User.objects.create_user(username="sq_judge", password="x", role="JUDGE", tenant=tenant))
    admin = _client(User.objects.create_user(username="sq_admin", password="x", role="ADMIN", tenant=tenant))

    assert _case_row(judge, case)["soul_name"] == "Quoted Soul"
    role = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "判官"})[0]
    FieldPermission.objects.create(role=role, model_name="Soul", field_name="name", visible=False)

    row = _case_row(judge, case)
    assert "soul_name" not in row
    assert row["court"] == "第一殿" and row["soul"] == str(soul.pk)  # 别的照给
    assert _case_row(admin, case)["soul_name"] == "Quoted Soul"  # ADMIN 不受字段规则收窄


def _serializers_quoting_the_soul():
    from apps.dispatch import serializers as dispatch
    from apps.disposition import serializers as disposition
    from apps.judgment import serializers as judgment
    from apps.sentence_plan import serializers as sentence_plan
    from apps.souls.models import Soul

    soul_fields = {f.name for f in Soul._meta.get_fields()}
    found = {}
    for module in (judgment, disposition, dispatch, sentence_plan):
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if cls.__module__ != module.__name__ or not hasattr(cls, "_declared_fields"):
                continue
            for key, field in cls._declared_fields.items():
                source = field.source or ""
                head, _, attr = source.partition(".")
                if head == "soul" and attr in soul_fields:
                    found.setdefault(cls, {})[key] = attr
    return found


def test_every_field_quoted_from_the_soul_follows_the_soul_rule():
    found = _serializers_quoting_the_soul()
    # 不空转：审判、处置、两个调拨、受刑计划、先例,至少六个。
    assert len(found) >= 6, sorted(c.__name__ for c in found)
    missing = [
        f"{cls.__module__}.{cls.__name__}.{key} (soul.{attr})"
        for cls, keys in found.items()
        for key, attr in keys.items()
        if not issubclass(cls, SoulFieldRulesMixin) or getattr(cls, "soul_field_keys", {}).get(key) != attr
    ]
    assert missing == [], "Register these in soul_field_keys (SoulFieldRulesMixin):\n" + "\n".join(missing)
