"""殿司展示名(`Tenant.hall_name*`)与回信官员的职位:收件箱列表、消息署名、官员后台都返回它们。"""
import importlib

import pytest
from django.apps import apps as live_apps

from apps.authentication.models import User
from apps.tenants.models import Tenant
from tests.chat_support import matrix, room_of  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"
INBOX = "/api/v1/chat/inbox/"


def _hall(tenant, zh="第五殿", en="The Fifth Court", egy="Yanluo Qedi"):
    tenant.hall_name, tenant.hall_name_en, tenant.hall_name_egy = zh, en, egy
    tenant.save()
    return tenant


def _officer(tenant, **fields):
    return User.objects.create_user(username=fields.pop("username", "cn_mod"), password="x", role="ADMIN",
                                    tenant=tenant, **fields)


def test_the_inbox_row_names_the_hall_in_three_languages(cn_tenant, matrix):  # noqa: F811
    """变异:`get_hall` 改回 `tenant.display_name` → 列表里是管理名「Chinese Diyu」,红。"""
    _hall(cn_tenant)
    _, client = ready_soul(cn_tenant, name="甲")
    row = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    assert row["hall"] == "第五殿"
    assert row["hall_names"] == {"zh-Hans": "第五殿", "en": "The Fifth Court", "egy": "Yanluo Qedi"}
    assert "Chinese Diyu" not in str(row)  # 管理名不出现在灵魂看到的地方
    me = client.get("/api/v1/me/").data
    assert me["tenant"]["hall_names"]["zh-Hans"] == "第五殿"


def test_a_blank_hall_name_falls_back_to_zh_then_to_the_tenant_name(cn_tenant, matrix):  # noqa: F811
    """变异:`hall_names` 的 en 不退回 zh → en 为空串,红。"""
    _hall(cn_tenant, en="", egy="")
    assert cn_tenant.hall_names == {"zh-Hans": "第五殿", "en": "第五殿", "egy": "第五殿"}
    _hall(cn_tenant, zh="", en="", egy="")
    assert set(cn_tenant.hall_names.values()) == {cn_tenant.display_name}


def test_direct_rows_carry_no_hall(cn_tenant, matrix):  # noqa: F811
    from tests.chat_support import mutual

    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    row = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
    assert row["hall"] == "" and row["hall_names"] is None


def test_a_reply_is_signed_with_the_officers_position(cn_tenant, matrix):  # noqa: F811
    """职位随 Matrix 事件走(App 直接读 Matrix),官员后台的消息列表也返回它;灵魂的信没有职位。
    变异:`officer_reply` 不写 `io.soulledger.officer_title` → 事件里没有职位,红。
    变异:`officer_title` 不看 `position`(只看 actor)→ 职位为空,红。"""
    _hall(cn_tenant)
    _, client = ready_soul(cn_tenant, name="甲")
    inbox = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    assert client.post(f"{CONVERSATIONS}{inbox['id']}/messages/", {"body": "我要申诉"}, format="json").status_code == 201
    officer = officer_client(_officer(cn_tenant, first_name="崔珏", position="判官"))
    assert officer.post(f"{INBOX}{inbox['id']}/reply/", {"body": "已收"}, format="json").status_code == 201

    event = matrix.rooms[inbox["room_id"]]["messages"][-1]
    assert (event["officer"], event["officer_title"]) == ("崔珏", "判官")
    rows = officer.get(f"{INBOX}{inbox['id']}/messages/").data
    by_body = {row["body"]: row for row in rows}
    assert (by_body["已收"]["sender_name"], by_body["已收"]["officer_title"]) == ("崔珏", "判官")
    assert by_body["我要申诉"]["officer_title"] == ""

    listed = officer.get(INBOX).data
    listed = listed["results"] if isinstance(listed, dict) else listed
    assert listed[0]["hall_names"]["zh-Hans"] == "第五殿"


def test_without_a_position_the_linked_actor_title_is_used(cn_tenant, matrix):  # noqa: F811
    """变异:`officer_title` 不退回 actor 头衔 → 空串,红。"""
    from apps.actors.models import Actor
    from apps.chat.services import officer_title

    actor = Actor.all_objects.create(name="Cui Jue", civilization="CHINESE", role="JUDGE", title="Judge",
                                     title_zh="判官", tenant=cn_tenant)
    assert officer_title(_officer(cn_tenant, username="a1", actor=actor)) == "判官"
    assert officer_title(_officer(cn_tenant, username="a2", actor=actor, position="第五殿殿主")) == "第五殿殿主"
    assert officer_title(_officer(cn_tenant, username="a3")) == ""


def test_the_default_hall_names_fill_only_blanks(cn_tenant, eu_tenant):
    """tenants/0012:四文明各有默认值;已经填了的不覆盖;重跑无害。
    变异:去掉 `hall_name=""` 条件 → 运维改过的名字被覆盖,红。"""
    fill = importlib.import_module("apps.tenants.migrations.0012_default_hall_names").fill
    eu_tenant.hall_name = "运维改过的名字"
    eu_tenant.save()
    fill(live_apps, None)
    fill(live_apps, None)
    cn, eu = Tenant.objects.get(pk=cn_tenant.pk), Tenant.objects.get(pk=eu_tenant.pk)
    assert (cn.hall_name, cn.hall_name_en, cn.hall_name_egy) == ("第五殿", "The Fifth Court", "Yanluo Qedi")
    assert (eu.hall_name, eu.hall_name_en) == ("运维改过的名字", "Purgatory")
