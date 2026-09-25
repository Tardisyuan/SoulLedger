"""`GET /judgment/assignable-officers/` —— 改派弹层的名单(apps/judgment/claims.py)。

改派属于持 `judgment.assign` 的 ADMIN 与殿主(MODERATOR),而弹层此前读 `/users/`,
那要 ADMIN 的 `user.manage` —— 殿主一打开就是 403。这个端点只给改派要的那四样。

名单与改派用同一个 `claims.is_assignable`:`TestSameRuleAsReassign` 对夹具里的每一个人
真的发一次改派,断言「改派收下的人」与「名单里的人」是同一个集合。
"""
import pytest

from apps.authentication.models import User
from tests.test_judgment_claim import _case, _client, _fresh, _post, world  # noqa: F401

URL = "/api/v1/judgment/assignable-officers/"


def _officers(client, *cases):
    return client.get(URL, {"judgment": [str(c.pk) for c in cases]})


def _ids(response):
    assert response.status_code == 200, response.data
    return {row["id"] for row in response.data}


@pytest.fixture
def crowd(world):  # noqa: F811
    """`world` 加上不该出现在名单里的每一类人。"""
    def user(name, role, tenant, **extra):
        return User.objects.create_user(username=name, password="x", role=role, tenant=tenant, **extra)

    world.users.update(
        soul=user("assign_soul", "SOUL", world.cn),
        inactive=user("assign_inactive_judge", "JUDGE", world.cn, is_active=False),
        deleted=user("assign_deleted_judge", "JUDGE", world.cn, is_deleted=True),
        global_admin=user("assign_global_admin", "ADMIN", None),
    )
    world.clients["global_admin"] = _client(world.users["global_admin"])
    return world


@pytest.mark.django_db
class TestAssignableOfficers:
    def test_a_moderator_gets_the_tenants_officers_who_can_work_judgments(self, crowd):
        case = _case(crowd.cn)
        u = crowd.users
        assert _ids(_officers(crowd.clients["mod"], case)) == {u["a"].pk, u["b"].pk, u["mod"].pk}

    def test_each_row_carries_exactly_five_fields(self, crowd):
        crowd.users["a"].display_name = "秦广王"
        crowd.users["a"].email = "qin@example.com"
        crowd.users["a"].save()
        rows = _officers(crowd.clients["mod"], _case(crowd.cn)).data
        row = next(r for r in rows if r["id"] == crowd.users["a"].pk)
        assert row == {
            "id": crowd.users["a"].pk, "display_name": "秦广王", "username": "claim_judge_a", "role": "JUDGE", "in_hand": 0,
        }
        assert "email" not in row and "phone" not in row

    def test_in_hand_counts_each_officers_claimed_pending_cases_only(self, crowd):
        u = crowd.users
        mine = [_case(crowd.cn, name=f"在手{i}") for i in range(3)]
        for case in mine[:2]:
            case.claimed_by = u["a"]
            case.save(update_fields=["claimed_by"])
        mine[2].claimed_by = u["b"]
        mine[2].verdict = "PASSED"  # 已结案:不算在手
        mine[2].save(update_fields=["claimed_by", "verdict"])
        other_tenant = _case(crowd.eu, name="别殿")
        other_tenant.claimed_by = u["a"]  # 别的租户的案子不算进本殿的在手
        other_tenant.save(update_fields=["claimed_by"])
        rows = {r["id"]: r["in_hand"] for r in _officers(crowd.clients["mod"], _case(crowd.cn)).data}
        assert rows == {u["a"].pk: 2, u["b"].pk: 0, u["mod"].pk: 0}

    def test_a_judge_without_judgment_assign_is_403(self, crowd):
        response = _officers(crowd.clients["a"], _case(crowd.cn))
        assert response.status_code == 403

    def test_another_tenants_officers_are_never_listed(self, crowd):
        ids = _ids(_officers(crowd.clients["mod"], _case(crowd.cn)))
        assert crowd.users["eu_judge"].pk not in ids
        assert crowd.users["eu_mod"].pk not in ids

    def test_souls_inactive_and_deleted_users_are_never_listed(self, crowd):
        ids = _ids(_officers(crowd.clients["mod"], _case(crowd.cn)))
        for key in ("soul", "inactive", "deleted", "guardian", "viewer", "global_admin"):
            assert crowd.users[key].pk not in ids, key

    def test_another_tenants_case_is_404_not_its_officers(self, crowd):
        eu_case = _case(crowd.eu)
        response = _officers(crowd.clients["mod"], eu_case)
        assert response.status_code == 404
        assert response.data["missing"] == [str(eu_case.pk)]

    def test_admin_gets_the_officers_of_the_cases_tenant(self, crowd):
        u = crowd.users
        admin = crowd.clients["global_admin"]
        assert _ids(_officers(admin, _case(crowd.eu))) == {u["eu_judge"].pk, u["eu_mod"].pk}
        assert _ids(_officers(admin, _case(crowd.cn))) == {u["a"].pk, u["b"].pk, u["mod"].pk}

    def test_a_batch_across_tenants_has_nobody_who_can_take_all_of_it(self, crowd):
        response = _officers(crowd.clients["global_admin"], _case(crowd.cn), _case(crowd.eu))
        assert response.status_code == 200
        assert response.data == []

    def test_the_input_is_validated(self, crowd):
        client = crowd.clients["mod"]
        assert client.get(URL).status_code == 400
        assert client.get(URL, {"judgment": "not-a-uuid"}).status_code == 400


@pytest.mark.django_db
class TestSameRuleAsReassign:
    def test_the_listed_set_is_exactly_the_set_reassign_accepts(self, crowd):
        """Property over the whole fixture: for every user that exists, reassign says
        200 iff the list names them. Both directions — a listed officer reassign refuses
        and an accepted officer the list hides are each a failure."""
        case = _case(crowd.cn)
        mod = crowd.clients["mod"]
        listed = _ids(_officers(mod, case))
        accepted = set()
        for user in User.all_objects.all():
            response = _post(mod, case, "reassign", {"to": user.pk})
            assert response.status_code in (200, 400), (user.username, response.data)
            if response.status_code == 200:
                assert _fresh(case).claimed_by_id == user.pk
                accepted.add(user.pk)
        assert listed, "an empty list would make the equality vacuous"
        assert listed == accepted
