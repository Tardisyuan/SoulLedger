"""Deleted workflow templates go to the recycle bin (maintainer decision, 2026-09-25).

Listed, restorable, and a restore that would bring back a step naming a role
that no longer exists is refused (`template_role_missing`) — all driven by the
ids the bin's own list hands out, as the page does. Plus: every registered bin
type has a label in all three language packs.
"""
import json
from pathlib import Path

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.core.recycle_bin import list_bin_entries, registered_types
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Role
from apps.tenants.models import Tenant
from apps.workflow.models import WorkflowTemplate

BIN = "/api/v1/recycle-bin/"
TEMPLATES = "/api/v1/workflow/templates/"
PACKS = Path(__file__).resolve().parents[2] / "packages" / "core" / "messages"


def _client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    admin = User.objects.create_user(username="tplbin_admin", password="x", role="ADMIN", tenant=tenant)
    yield {"tenant": tenant, "client": _client(admin)}
    invalidate_all_permissions()


def _template(tenant, name, role="JUDGE", civilization="CHINESE"):
    return WorkflowTemplate.objects.create(
        name=name, civilization=civilization, tenant=tenant,
        nodes_json=[{"node_name": "审", "node_order": 1, "approver_type": "ROLE", "approver_role": role}],
    )


def _bin_rows(client):
    res = client.get(BIN)
    assert res.status_code == 200, res.content
    return {r["id"]: r for r in res.json()["results"] if r["entity_type"] == "workflow_template"}


def test_a_deleted_template_is_listed_and_restores_through_the_list(world):
    client = world["client"]
    tpl = _template(world["tenant"], "十殿审判流程")
    assert client.delete(f"{TEMPLATES}{tpl.pk}/").status_code == 204

    row = _bin_rows(client)[str(tpl.pk)]
    assert (row["kind"], row["label"], row["location"]) == (
        "reference", "十殿审判流程", {"kind": "civilization", "value": "CHINESE"}
    )
    res = client.post(f"{BIN}restore/", {"cascade_id": row["cascade_id"]}, format="json")
    assert res.status_code == 200 and res.json() == {"restored": 1}, res.content
    assert WorkflowTemplate.objects.filter(pk=tpl.pk).exists()
    assert str(tpl.pk) not in _bin_rows(client)


def test_restoring_a_template_whose_role_is_gone_is_refused_through_the_list(world):
    client = world["client"]
    auditor = Role.objects.create(name="AUDITOR", display_name="稽核")
    tpl = _template(world["tenant"], "稽核流", role="AUDITOR")
    assert client.delete(f"{TEMPLATES}{tpl.pk}/").status_code == 204
    assert client.delete(f"/api/v1/perm/roles/{auditor.pk}/").status_code == 204

    row = _bin_rows(client)[str(tpl.pk)]
    refused = client.post(f"{BIN}restore/", {"cascade_id": row["cascade_id"]}, format="json")
    assert refused.status_code == 400, refused.content
    assert (refused.json()["code"], refused.json()["missing_roles"]) == ("template_role_missing", ["AUDITOR"])
    assert str(tpl.pk) in _bin_rows(client)  # still in the bin, nothing restored
    assert not WorkflowTemplate.objects.filter(pk=tpl.pk).exists()


def test_a_tenant_sees_only_its_own_deleted_templates(world):
    other, _ = Tenant.objects.get_or_create(code="EU_INFERNO", defaults={"display_name": "Inferno"})
    mine = _template(world["tenant"], "本殿流程")
    theirs = _template(other, "他殿流程", civilization="EUROPEAN")
    mine.soft_delete()
    theirs.soft_delete()

    def ids(tenant, is_admin=False):
        return {
            e["id"] for e in list_bin_entries(tenant=tenant, is_admin=is_admin)
            if e["entity_type"] == "workflow_template"
        }

    assert ids(world["tenant"]) == {mine.pk}
    assert ids(other) == {theirs.pk}
    assert ids(None, is_admin=True) == {mine.pk, theirs.pk}


@pytest.mark.parametrize("pack", ["zh-Hans", "en", "egy"])
def test_every_registered_bin_type_has_a_label(pack):
    labels = json.loads((PACKS / f"{pack}.json").read_text(encoding="utf-8"))["recycle_bin"]["entity_types"]
    registered = {t.entity_type for t in registered_types()}
    assert registered, "the registry is empty: the check would pass vacuously"
    assert sorted(registered - {k for k, v in labels.items() if v.strip()}) == []
