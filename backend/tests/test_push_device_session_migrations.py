"""officer_app/0002 与 soul_push/0004:推送登记加可空的 `session` 外键。纯加列,往返后已有的登记一行不丢。"""
import pytest
from django.utils import timezone

pytestmark = pytest.mark.django_db(transaction=True)


def _columns(model):
    return sorted(f.name for f in model._meta.get_fields() if hasattr(f, "column"))


def test_officer_push_device_session_round_trip(migration_round_trip):
    def seed(state):
        user = state.get_model("authentication", "User")._base_manager.create(username="rt-officer", role="MODERATOR")
        state.get_model("officer_app", "OfficerPushDevice")._base_manager.create(
            user=user, token="ExponentPushToken[rt-officer]", platform="IOS", last_seen_at=timezone.now())

    def snapshot(state):
        model = state.get_model("officer_app", "OfficerPushDevice")
        return {"columns": _columns(model), "tokens": sorted(model._base_manager.values_list("token", flat=True))}

    migration_round_trip(
        before=("officer_app", "0001_initial"), after=("officer_app", "0002_push_device_session"),
        seed=seed, snapshot=snapshot,
        check_forward=lambda state: state.get_model("officer_app", "OfficerPushDevice")._base_manager.get().session_id is None,
    )


def test_soul_push_device_session_round_trip(migration_round_trip, cn_tenant):
    def seed(state):
        soul = state.get_model("souls", "Soul")._base_manager.create(name="rt", tenant_id=cn_tenant.pk)
        user = state.get_model("authentication", "User")._base_manager.create(username="rt-soul", role="SOUL")
        account = state.get_model("soul_accounts", "SoulAccount")._base_manager.create(
            soul=soul, user=user, cycle=0, origin="OFFICER")
        state.get_model("soul_push", "PushDevice")._base_manager.create(
            account=account, soul=soul, token="ExponentPushToken[rt-soul]", platform="IOS", last_seen_at=timezone.now())

    def snapshot(state):
        model = state.get_model("soul_push", "PushDevice")
        return {"columns": _columns(model), "tokens": sorted(model._base_manager.values_list("token", flat=True))}

    migration_round_trip(
        before=("soul_push", "0003_delivery_without_device"), after=("soul_push", "0004_push_device_session"),
        seed=seed, snapshot=snapshot,
        check_forward=lambda state: state.get_model("soul_push", "PushDevice")._base_manager.get().session_id is None,
    )
