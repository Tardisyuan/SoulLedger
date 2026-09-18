"""自动回归被未结案审判拦下 → 两边持有 `dispatch.read` 的官员收到站内通知。

收件人规则写在 `DispatchService.return_blocked_recipients`。这里每条都同时断言
**不该收到的人不在场**:只断言「该收的收到了」,在「所有人都收到」时照样是绿的。
"""
import pytest

from apps.authentication.models import User
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.judgment.models import Judgment
from apps.notifications.models import UserNotification
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

KIND = "DISPATCH_RETURN_BLOCKED"


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": f"{code} 名"})[0]


def _user(username, role, tenant, **extra):
    return User.objects.create_user(username=username, password="x", role=role, tenant=tenant, **extra)


@pytest.fixture
def world():
    home, away, third = _tenant("CN_DIYU"), _tenant("EG_DUAT"), _tenant("EU_HEAVEN_HELL")
    soul = Soul.objects.create(name="客魂", tenant=home, current_state=SoulState.DISPOSED)
    record = DispatchRecord.objects.create(
        source_tenant=home, target_tenant=away, soul=soul, status=DispatchStatus.APPROVED,
        reason="先在彼处受罚", tenant=home,
    )
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    people = {
        "home_mod": _user("home_mod", "MODERATOR", home),
        "home_guardian": _user("home_guardian", "GUARDIAN", home),
        "home_admin": _user("home_admin", "ADMIN", home),
        "away_mod": _user("away_mod", "MODERATOR", away),
        "away_guardian": _user("away_guardian", "GUARDIAN", away),
        # 不该收的:
        "home_judge": _user("home_judge", "JUDGE", home),
        "away_viewer": _user("away_viewer", "VIEWER", away),
        "away_retired_mod": _user("away_retired_mod", "MODERATOR", away, is_active=False),
        "third_mod": _user("third_mod", "MODERATOR", third),
        "third_admin": _user("third_admin", "ADMIN", third),
        "soul_user": _user("soul_user", "SOUL", home),
    }
    return {"home": home, "away": away, "soul": soul, "record": record, "people": people}


SHOULD = {"home_mod", "home_guardian", "home_admin", "away_mod", "away_guardian"}


def _block(world, n_cases=2):
    for _ in range(n_cases):
        Judgment.objects.create(soul=world["soul"], tenant=world["away"], civilization=world["soul"].civilization)
    disposition = Disposition.objects.create(soul=world["soul"], tenant=world["away"])
    assert DispositionService.execute(disposition) is True


def _recipients(world):
    names = {u.pk: name for name, u in world["people"].items()}
    return sorted(names[n.user_id] for n in UserNotification.objects.filter(notification_type=KIND))


def test_both_tenants_dispatch_readers_are_told_and_nobody_else(world):
    _block(world)
    assert _recipients(world) == sorted(SHOULD)


def test_the_notice_names_the_soul_and_the_count_but_no_case_detail(world):
    _block(world, n_cases=2)
    note = UserNotification.objects.filter(notification_type=KIND).first()
    assert note.params == {"soul": "客魂", "count": 2}
    assert "客魂" in note.message and "2" in note.message
    assert note.related_resource == "DispatchRecord" and note.related_id == str(world["record"].pk)
    for case in Judgment.all_objects.filter(soul=world["soul"]):
        assert str(case.pk) not in note.message and str(case.pk) not in note.title


def test_the_soul_is_not_told(world):
    _block(world)
    assert not UserNotification.objects.filter(user=world["people"]["soul_user"]).exists()


def test_being_blocked_again_in_the_same_residence_does_not_notify_twice(world):
    _block(world)
    _block(world)  # 同一暂居里又一份处置执行,又被拦
    from apps.events.models import SoulEvent
    blocked = [e for e in SoulEvent.all_objects.filter(soul=world["soul"])
               if e.payload.get("action") == KIND]
    assert len(blocked) == 2  # 事件照写
    assert len(_recipients(world)) == len(SHOULD)  # 通知只发一次


def test_a_manual_return_refused_with_409_sends_no_notice(world):
    Judgment.objects.create(soul=world["soul"], tenant=world["away"], civilization=world["soul"].civilization)
    response = officer_client(world["people"]["home_mod"]).post(
        f"/api/v1/dispatch/records/{world['record'].pk}/return-home/", {"reason": "x"}, format="json")
    assert response.status_code == 409, response.data
    assert _recipients(world) == []


def test_a_rolled_back_block_leaves_no_notice(world):
    from django.db import transaction
    Judgment.objects.create(soul=world["soul"], tenant=world["away"], civilization=world["soul"].civilization)
    disposition = Disposition.objects.create(soul=world["soul"], tenant=world["away"])
    with pytest.raises(RuntimeError), transaction.atomic():
        DispositionService.execute(disposition)
        raise RuntimeError
    assert _recipients(world) == []


@pytest.mark.parametrize("locale,needle", [("en", "cannot return home"), ("egy", "Khesef"), ("zh-Hans", "拦下")])
def test_the_inbox_renders_it_in_the_readers_language(world, locale, needle):
    _block(world, n_cases=3)
    response = officer_client(world["people"]["away_mod"]).get("/api/v1/notifications/", HTTP_ACCEPT_LANGUAGE=locale)
    assert response.status_code == 200
    rows = response.data["results"] if isinstance(response.data, dict) else response.data
    [row] = [r for r in rows if r["notification_type"] == KIND]
    assert needle in row["message"] and "客魂" in row["message"] and "3" in row["message"]
    assert "{{" not in row["message"]
