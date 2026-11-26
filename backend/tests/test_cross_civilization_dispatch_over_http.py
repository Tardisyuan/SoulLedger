"""A dispatch between two civilizations, driven only through the URLconf's routes, signed in the way production does
(`sign_in`: a JWT naming the officer's hall, so the request's hall is the hall the officer acts for), in each write cut
of the two: none, the source's, the target's, both (sharding stage 4).

The target hall decides (approve / reject / withdraw approval) in ITS context, while the soul and the record are the
source hall's rows, on the source's master. Each decision ran its transaction and its soul lock on the request's hall's
master: `Soul.DoesNotExist` with the target cut (the target shard has no row for the soul), a lock and a record write
outside the transaction with only the source cut (2026-11-19). The source hall may not decide its own proposal (403).

Also: a target realm of a civilization read from its shard but written on control (read-cut, not write-cut) is
accepted at proposal, though the shard has not seen the realm yet (control holds it; the write request reads there).

Random worlds (which two civilizations, a target realm or not): `DISPATCH_SEED=<n>` replays one; the seed is printed
and in every failure message.

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true DATABASE_URL=sqlite:///:memory: \\
      REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest --ds=config.settings_sharded -m sharded \\
      --no-cov tests/test_cross_civilization_dispatch_over_http.py
"""
import os
import random

import pytest

from tests.shard_support import CIVS, sharded
from tests.test_cross_civilization_saga import _ownership, _realm, _walk
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

CUTS = ("both",)  # sharded: every civilization on its shard (the partial cut-overs are gone, 2026-11-21)


def _seed():
    seed = int(os.environ["DISPATCH_SEED"]) if os.environ.get("DISPATCH_SEED") else random.randrange(10**6)
    print(f"dispatch world seed {seed} (replay: DISPATCH_SEED={seed})")
    return seed


def _routes():
    from django.urls import get_resolver

    from apps.dispatch.views import DispatchRecordViewSet

    routes = {}
    for callback, name in _walk(get_resolver().url_patterns):
        if getattr(callback, "cls", None) is DispatchRecordViewSet:
            routes[(callback.actions or {}).get("post")] = name
    assert {"create", "approve", "reject", "withdraw_approval", "execute"} <= set(routes), routes
    return routes


@pytest.fixture(params=CUTS)
def world(request):
    seed = _seed()
    rng = random.Random(seed)
    src, tgt = rng.sample(CIVS, 2)
    halls = _halls()
    _assign(*CIVS)
    with cut():
        yield {"seed": seed, "cut": request.param, "src": src, "tgt": tgt, "realm": rng.random() < 0.5}, halls


def _officers(halls, w):
    from rest_framework.test import APIClient

    from apps.authentication.models import User
    from tests.conftest import sign_in

    def officer(civ):
        user = User.objects.create_user(username=f"dsp_{civ[:3].lower()}_{w['seed']}", password="x", role="ADMIN",
                                        tenant=halls[civ])
        return sign_in(APIClient(), user)
    return officer(w["src"]), officer(w["tgt"])


def _proposal(w, halls, home, routes, n=0):
    """A soul of the source hall standing in a realm there, proposed over HTTP to the target hall."""
    from django.urls import reverse

    from apps.realms.path import SoulPathService
    from apps.souls.models import Soul

    src, tgt = halls[w["src"]], halls[w["tgt"]]
    here = _realm(src, f"DSP_{w['src'][:2]}{n}")
    there = _realm(tgt, f"DSP_{w['tgt'][:2]}{n}") if w["realm"] else None
    with _in_hall(src):
        soul = Soul.objects.create(name=f"客魂{w['seed']}_{n}", tenant=src, current_state="DISPOSED")
        SoulPathService.enter(soul, here, tenant_id=src.pk)
    body = {"source_tenant": str(src.pk), "target_tenant": str(tgt.pk), "soul": str(soul.pk),
            "reason": "跨文明调拨:该灵魂须往目标文明之界域受审,依律移交"}
    if there is not None:
        body["target_realm"] = str(there.pk)
    r = home.post(reverse(routes["create"]), body, format="json", HTTP_IDEMPOTENCY_KEY=f"dsp-{w['seed']}-{n}")
    assert r.status_code == 201, (w, r.status_code, r.content)
    return soul, r.json()["id"]


def _status(pk):
    """Read where a command reads (every master): the authoritative row, not a shadow that lags."""
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.dispatch.models import DispatchRecord

    with read_context(CONTROL_ALIAS):
        return DispatchRecord.all_objects.get(pk=pk).status


@sharded
def test_the_target_hall_approves_and_executes_a_cross_civilization_dispatch_over_http(world):
    from django.urls import reverse

    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.dispatch.models import DispatchStatus
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import relay_until_quiet

    w, halls = world
    routes = _routes()
    home, there = _officers(halls, w)
    soul, pk = _proposal(w, halls, home, routes)

    # The source hall may not decide its own proposal.
    r = home.post(reverse(routes["approve"], kwargs={"pk": pk}), {}, format="json", HTTP_IDEMPOTENCY_KEY=f"a0-{pk}")
    assert r.status_code == 403, (w, r.status_code, r.content)
    assert _status(pk) == DispatchStatus.PROPOSED, w

    r = there.post(reverse(routes["approve"], kwargs={"pk": pk}), {}, format="json", HTTP_IDEMPOTENCY_KEY=f"a-{pk}")
    assert r.status_code == 200, (w, r.status_code, r.content)
    assert _status(pk) == DispatchStatus.APPROVED, w

    r = there.post(reverse(routes["execute"], kwargs={"pk": pk}), {}, format="json", HTTP_IDEMPOTENCY_KEY=f"e-{pk}")
    assert r.status_code == 200, (w, r.status_code, r.content)
    relay_until_quiet()
    assert _status(pk) == DispatchStatus.EXECUTED, w
    with read_context(CONTROL_ALIAS):
        assert str(Soul.all_objects.get(pk=soul.pk).tenant_id) == str(halls[w["tgt"]].pk), w
    _ownership()


@sharded
def test_the_target_hall_rejects_and_withdraws_its_approval_over_http(world):
    from django.urls import reverse

    from apps.dispatch.models import DispatchStatus

    w, halls = world
    routes = _routes()
    home, there = _officers(halls, w)

    _, pk = _proposal(w, halls, home, routes, n=1)
    r = there.post(reverse(routes["reject"], kwargs={"pk": pk}), {"reason": "本殿此时不收外邦之魂,请发起殿另择他处安置"},
                   format="json")
    assert r.status_code == 200, (w, r.status_code, r.content)
    assert _status(pk) == DispatchStatus.REJECTED, w

    _, pk = _proposal(w, halls, home, routes, n=2)
    r = there.post(reverse(routes["approve"], kwargs={"pk": pk}), {}, format="json", HTTP_IDEMPOTENCY_KEY=f"a-{pk}")
    assert r.status_code == 200, (w, r.status_code, r.content)
    r = there.post(reverse(routes["withdraw_approval"], kwargs={"pk": pk}),
                   {"reason": "批准之后情况有变,本殿撤回此前的批准决定"}, format="json")
    assert r.status_code == 200, (w, r.status_code, r.content)
    assert _status(pk) == DispatchStatus.CANCELLED, w
    _ownership()


@sharded
@pytest.mark.parametrize("cut_civs", [("CHINESE",), ("EGYPTIAN",), ("CHINESE", "EGYPTIAN")])
def test_another_civilizations_hall_files_and_withdraws_a_request_on_a_plan(cut_civs):
    """The same shape off dispatch: a stop's hall (EG) files a request on a plan of the home hall (CN), in its own
    context, while the soul is home. The plan, its request and the soul are CN's rows, on CN's master."""
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.org.ownership import tenant_root
    from apps.realms.models import Realm
    from apps.sentence_plan import requests as plan_requests
    from apps.sentence_plan.models import SentencePlanRequest, SentenceRequestStatus
    from apps.souls.models import Soul
    from tests import sentence_plan_support as plan
    from tests.shard_support import _sync

    cn, eg, eu = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), plan.tenant("EU_HEAVEN_HELL")
    for hall in (cn, eg, eu):
        tenant_root(hall)
    stops = []
    for hall in (eg, eu):
        code = plan.stop_realm(hall)
        Realm.objects.filter(realm_code=code).update(tenant=hall)
        stops.append((hall, code, 5))
    soul, p = plan.planned(cn, stops)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)  # back home; stop 3 (EU) proposed
    assert Soul.all_objects.get(pk=soul.pk).tenant_id == cn.pk
    judge = plan.officer(f"judge_eg_{'_'.join(c[:2] for c in cut_civs)}", "JUDGE", eg)
    _sync()
    _assign(*CIVS)
    with cut(), _in_hall(eg):
        req = plan_requests.file_request(p, eg, kind="REOPEN", changes=None, reason="新证据", user=judge)
        plan_requests.withdraw(p, req.pk, tenant=eg, exempt=False, user=judge)
    with cut(), read_context(CONTROL_ALIAS):
        assert SentencePlanRequest.all_objects.get(pk=req.pk).status == SentenceRequestStatus.WITHDRAWN, cut_civs


@sharded
@pytest.mark.parametrize("where", ["source hall", "target hall's reads"])
def test_a_target_realm_read_from_a_lagging_shadow_is_still_found_at_proposal(where):
    """The target civilization read-cut, not write-cut: its fresh realm is on control and not yet on its shard. A
    proposal made outside a request (a script, a task) with the source hall's context, or reading the target hall's,
    was refused "not a realm of ...": the realm check ran before the transaction, on the context's read alias
    (another civilization's shard, or the target's shadow). It runs inside it now, where reads are the masters'."""
    from apps.core.shard_reads import read_context
    from apps.dispatch.services import DispatchService
    from apps.souls.models import Soul

    seed = _seed()
    src_civ, tgt_civ = random.Random(seed).sample(CIVS, 2)
    halls = _halls()
    _assign(*CIVS)
    src, tgt = halls[src_civ], halls[tgt_civ]
    with cut():
        there = _realm(tgt, "DSP_LAG")  # on control only: no sync after it
        with _in_hall(src):
            soul = Soul.objects.create(name=f"客魂{seed}", tenant=src, current_state="DISPOSED")
        with _in_hall(src) if where == "source hall" else read_context(tgt):
            record = DispatchService.propose(src, tgt, soul, None, "lag", target_realm=there)
        assert record.target_realm_id == there.pk, (seed, src_civ, tgt_civ)
