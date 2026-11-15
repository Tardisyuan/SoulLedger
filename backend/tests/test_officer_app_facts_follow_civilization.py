"""Officer-app facts name another hall's people only to readers who reach that hall (§7.5, stage 1A review).

`workflow_facts` gives a flow's requester and the start of its history by name. "Reading with no hall" used to mean
"sees every hall's names", so a civilization ADMIN opening a cross-civilization flow read the other civilization's
requester. Now: SYSTEM_ADMIN every hall; a civilization ADMIN its civilization's halls; a hall's reader its hall;
a hall-less reader who is not an administrator nobody's.
"""
import pytest

from apps.authentication.models import User, UserRole
from apps.officer_app.facts import workflow_facts
from apps.souls.models import Soul
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalWorkflow

pytestmark = pytest.mark.django_db


def test_the_requesters_name_reaches_only_readers_of_its_hall():
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "EG"})
    asker = User.objects.create_user(username="eg-asker", password="x", role=UserRole.JUDGE, tenant=eg,
                                     display_name="Asker of the Duat")
    wf = ApprovalWorkflow.objects.create(number="WF-FACTS-1", workflow_name="flow", tenant=eg, create_user=asker,
                                         soul=Soul.objects.create(name="s", tenant=eg))

    def user(name, **kw):
        return User.objects.create_user(username=name, password="x", **kw)

    readers = {  # (user, the hall it reads as) -> sees the name?
        "SYSTEM_ADMIN": (user("f-sys", role=UserRole.SYSTEM_ADMIN, tenant=None), None, True),
        "EGYPTIAN ADMIN": (user("f-eg", role=UserRole.ADMIN, tenant=None, civilization="EGYPTIAN"), None, True),
        "CHINESE ADMIN": (user("f-cn", role=UserRole.ADMIN, tenant=None, civilization="CHINESE"), None, False),
        "ADMIN of no civilization": (user("f-blank", role=UserRole.ADMIN, tenant=None), None, False),
        "Duat judge": (user("f-egj", role=UserRole.JUDGE, tenant=eg), eg, True),
        "Diyu judge": (user("f-cnj", role=UserRole.JUDGE, tenant=cn), cn, False),
        "hall-less JUDGE": (user("f-none", role=UserRole.JUDGE, tenant=None), None, False),
    }
    got = {}
    for label, (reader, hall, _sees) in readers.items():
        facts = workflow_facts(wf, reader, hall, reason="")
        got[label] = (facts["requester"], facts["history"][0]["actor"])
    expected = {label: ("Asker of the Duat",) * 2 if sees else (None, None)
                for label, (_u, _h, sees) in readers.items()}
    assert got == expected
