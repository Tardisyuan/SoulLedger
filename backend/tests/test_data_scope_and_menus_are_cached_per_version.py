"""Data scope rules, the org tree and the menu tree: read once per version, not once per request (review 2026-11-16,
ADVICE-redis-cache 2.2 #5 / #7; apps/core/versioned.py).

Before: every officer request under a configured data scope paid one RoleDataScope query (+1 for DEFINE orgs) and one
query for its hall's whole (id, parent_id) org table; every sidebar load re-read the menu tree. Now a version key in the
state cache says whether this process's copy is current; any save / delete of the rows behind it bumps the version.
These tests assert the saving AND that a change is seen on the very next request (the stale answer is absent), and
that one hall's org ids never appear in another hall's answer.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.souls.models import Soul
from apps.tenants.models import Tenant
from tests.data_scope_support import org, scope
from tests.soul_account_support import officer_client

SOULS = "/api/v1/souls/"
MENUS = "/api/v1/menus/"


def _hits(ctx, *tables):
    return [q["sql"] for q in ctx.captured_queries if any(f'FROM "{t}"' in q["sql"] for t in tables)]


def _scope_queries(ctx):
    rules = _hits(ctx, "perm_role_data_scope", "perm_role_data_scope_orgs")
    tree = [q["sql"] for q in ctx.captured_queries
            if '"organizations"."parent_id" AS "parent_id" FROM "organizations"' in q["sql"]]
    return rules + tree


def _ids(response):
    assert response.status_code == 200, response.content[:300]
    body = response.json()
    return {row["id"] for row in (body["results"] if isinstance(body, dict) else body)}


@pytest.fixture
def world(db, django_user_model):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    eu = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})[0]
    a = org(cn, "甲")
    a_child = org(cn, "甲下", parent=a)
    b = org(cn, "乙")
    eu_org = org(eu, "欧")
    judge = django_user_model.objects.create_user(username="ds_cache_judge", password="x", role="JUDGE", tenant=cn,
                                                  organization=a)
    eu_judge = django_user_model.objects.create_user(username="ds_cache_eu", password="x", role="JUDGE", tenant=eu,
                                                     organization=eu_org)
    souls = {k: Soul.objects.create(name=f"ds-{k}", tenant=cn, owner_org=o)
             for k, o in {"a": a, "a_child": a_child, "b": b}.items()}
    souls["eu"] = Soul.objects.create(name="ds-eu", tenant=eu, owner_org=eu_org)
    rule = scope("JUDGE", "ORG_CHILD")
    return {"judge": judge, "eu_judge": eu_judge, "souls": souls, "rule": rule, "orgs": {"a": a, "b": b, "eu": eu_org},
            "cn": cn}


def _sid(world, *keys):
    return {str(world["souls"][k].pk) for k in keys} | {world["souls"][k].pk for k in keys}


def test_a_warm_request_reads_no_scope_rule_and_no_org_tree(world):
    client = officer_client(world["judge"])
    assert _ids(client.get(SOULS)) & _sid(world, "a", "a_child")
    with CaptureQueriesContext(connection) as ctx:
        visible = _ids(client.get(SOULS))
    assert _scope_queries(ctx) == []
    assert visible & _sid(world, "a", "a_child") and not visible & _sid(world, "b", "eu")


def test_narrowing_the_scope_is_seen_on_the_next_request(world):
    client = officer_client(world["judge"])
    assert _ids(client.get(SOULS)) & _sid(world, "a_child")  # warm, child org visible
    world["rule"].scope = "ORG"
    world["rule"].save()
    visible = _ids(client.get(SOULS))
    assert not visible & _sid(world, "a_child"), "the cached ORG_CHILD answer was served after the change"
    assert visible & _sid(world, "a")


def test_a_new_child_org_is_seen_on_the_next_request(world):
    client = officer_client(world["judge"])
    _ids(client.get(SOULS))
    deeper = org(world["cn"], "甲下下", parent=world["souls"]["a_child"].owner_org)
    late = Soul.objects.create(name="ds-late", tenant=world["cn"], owner_org=deeper)
    assert _ids(client.get(SOULS)) & {late.pk, str(late.pk)}


def test_moving_an_org_out_removes_it_from_the_former_parents_scope(world):
    client = officer_client(world["judge"])
    assert _ids(client.get(SOULS)) & _sid(world, "a_child")
    child = world["souls"]["a_child"].owner_org
    child.parent = world["orgs"]["b"]
    child.save()
    assert not _ids(client.get(SOULS)) & _sid(world, "a_child")


def test_one_halls_warm_cache_never_answers_another_hall(world):
    cn_client, eu_client = officer_client(world["judge"]), officer_client(world["eu_judge"])
    cn_seen = _ids(cn_client.get(SOULS))
    eu_seen = _ids(eu_client.get(SOULS))
    assert eu_seen & _sid(world, "eu")
    assert not eu_seen & _sid(world, "a", "a_child", "b"), "a CN soul in the EU judge's answer"
    assert not cn_seen & _sid(world, "eu")
    from apps.perm import data_scope

    cn_ids = data_scope.org_ids(world["judge"], "soul")
    eu_ids = data_scope.org_ids(world["eu_judge"], "soul")
    assert world["orgs"]["eu"].pk not in cn_ids and not eu_ids & {world["orgs"]["a"].pk, world["orgs"]["b"].pk}


#: Product-code writes to a cached model that send no signal, so they cannot bump the version. Each entry says why it
#: is harmless; anything new must bump (`data_scope._bump` / `menus.views.bump_menus`) or be listed with a reason.
SIGNAL_LESS_WRITES = {
    ("apps/org/management/commands/init_organizations.py", "update(level=depth)"):
        "`level` is not read by the org tree (id, parent_id) or the scope rules",
}


def test_no_product_code_writes_a_cached_model_past_its_signals():
    import re
    from pathlib import Path

    from django.apps import apps as django_apps

    pattern = re.compile(r"\b(RoleDataScope|Role|Organization|Menu|MenuButton)\.(objects|all_objects|_base_manager|"
                         r"_default_manager)\b.*\.(update|bulk_create|bulk_update)\((.*)")
    found = set()
    paths = [(cfg, p) for cfg in django_apps.get_app_configs() if cfg.name.startswith("apps.")
             for p in Path(cfg.path).rglob("*.py")]
    for cfg, path in paths:
        rel = "apps/" + cfg.name.split(".", 1)[1] + "/" + path.relative_to(cfg.path).as_posix()
        if "/migrations/" in rel or "/tests" in rel or path.name.startswith("test_") or path.name == "tests.py":
            continue
        for line in path.read_text().splitlines():
            m = pattern.search(line)
            if m:
                found.add((rel, f"{m.group(3)}({m.group(4).strip()}"))
    assert found == set(SIGNAL_LESS_WRITES), found ^ set(SIGNAL_LESS_WRITES)


# -- the menu tree ----------------------------------------------------------------------------------------------------

@pytest.fixture
def menus(db, django_user_model):
    from apps.menus.models import Menu, MenuButton

    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    parent = Menu.objects.create(name="mc-父", path="/mc", order=0, is_active=True, roles=[])
    child = Menu.objects.create(name="mc-子", path="/mc/c", order=0, parent=parent, is_active=True,
                                roles=["JUDGE", "ADMIN"])
    MenuButton.objects.create(menu=child, name="mc-btn", code="mc-btn", order=0, is_active=True)
    judge = django_user_model.objects.create_user(username="mc_judge", password="x", role="JUDGE", tenant=cn)
    return {"parent": parent, "child": child, "judge": judge}


def _menu_names(response):
    assert response.status_code == 200, response.content[:300]
    body = response.json()
    rows = body["results"] if isinstance(body, dict) else body
    names = set()

    def walk(items):
        for item in items:
            names.add(item["name"])
            walk(item.get("children") or [])
    walk(rows)
    return names


def test_a_warm_sidebar_reads_no_menu_row(menus):
    client = officer_client(menus["judge"])
    assert "mc-子" in _menu_names(client.get(MENUS))
    with CaptureQueriesContext(connection) as ctx:
        assert "mc-子" in _menu_names(client.get(MENUS))
    assert _hits(ctx, "menus_menu", "menus_menubutton", "menus") == []


def test_taking_a_role_off_a_menu_hides_it_on_the_next_request(menus):
    client = officer_client(menus["judge"])
    assert "mc-子" in _menu_names(client.get(MENUS))
    menus["child"].roles = ["ADMIN"]
    menus["child"].save()
    assert "mc-子" not in _menu_names(client.get(MENUS))


def test_soft_deleting_a_parent_hides_its_children_on_the_next_request(menus):
    client = officer_client(menus["judge"])
    assert {"mc-父", "mc-子"} <= _menu_names(client.get(MENUS))
    menus["child"].soft_delete()
    menus["parent"].soft_delete()
    assert not {"mc-父", "mc-子"} & _menu_names(client.get(MENUS))
