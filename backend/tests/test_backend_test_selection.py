"""scripts/select-backend-tests.py — the push gate runs backend tests by app (2026-10-27, user decision).

Reads the script and the test tree as files; imports nothing from the apps.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("select_backend_tests", ROOT / "scripts" / "select-backend-tests.py")
sel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sel)


def pick(*changed):
    picked, full = sel.select(list(changed))
    return picked, full


def test_an_app_change_picks_its_own_tests_and_the_ones_that_name_it():
    picked, full = pick("backend/apps/tenants/views.py")
    assert full is None
    # names the app
    assert "tests/test_batch54_officers_and_halls.py" in picked
    # reaches it only by URL: no `apps.tenants` in its source, only `/api/v1/tenants/`
    assert "tests/test_hall_view.py" in picked
    assert "apps.tenants" not in (ROOT / "backend/tests/test_hall_view.py").read_text() and \
        "apps/tenants" not in (ROOT / "backend/tests/test_hall_view.py").read_text()


def test_it_does_not_run_the_whole_suite_for_one_app():
    picked, _ = pick("backend/apps/soul_push/messages.py")
    assert 0 < len(picked) < len(sel.all_test_files()) // 4
    # a prefix of another app's name is not that app; the apps that import soul_push bring their own dirs
    importers = sel.importers()["soul_push"]
    assert all("soul_push" in p or "soul_push" in (ROOT / "backend" / p).read_text() or
               "/api/v1/" in (ROOT / "backend" / p).read_text() or
               (p.startswith("apps/") and p.split("/")[1] in importers) for p in picked)


def test_a_url_prefix_owned_through_a_router_in_the_urlconf_counts():
    # /api/v1/users/ is `include(user_router.urls)`, a router over authentication's UserViewSet.
    assert "users" in sel.url_prefixes().get("authentication", set())


def test_changes_it_cannot_trace_run_everything():
    for path in ("backend/config/settings.py", "backend/conftest.py", "conftest.py", "pytest.ini",
                 "backend/requirements.lock", "backend/manage.py"):
        picked, full = pick(path)
        assert picked is None and full, path


def test_a_changed_test_and_a_changed_test_helper_select_their_readers():
    picked, _ = pick("backend/tests/test_hall_view.py")
    assert picked == ["tests/test_hall_view.py"]
    picked, _ = pick("backend/tests/tenancy_unscoped_sites.py")
    assert "tests/test_unscoped_query_sites_are_declared.py" in picked


def test_a_gate_script_change_runs_the_tests_that_read_it():
    picked, _ = pick("scripts/run-gates.sh")
    assert "tests/test_prepush_runs_the_gates_a_change_can_break.py" in picked
    picked, _ = pick("scripts/select-backend-tests.py")
    assert "tests/test_backend_test_selection.py" in picked


def test_nothing_backend_side_selects_nothing():
    assert pick("frontend/app/page.tsx") == ([], None)


# One layer of reverse dependency (2026-11-10). The real chain used below, read from the tree:
# apps/core imports apps.scheduler; apps/menus imports apps.core but not apps.scheduler.
def test_a_change_selects_the_own_tests_of_the_apps_that_import_it(monkeypatch):
    graph = sel.importers()
    assert "core" in graph["scheduler"] and "menus" not in graph["scheduler"]
    core_own = [t for t in sel.all_test_files() if t.startswith("apps/core/")]
    assert core_own
    with_layer, _ = pick("backend/apps/scheduler/tasks.py")
    # mutation: drop the `picked.update(... importing)` line -> red
    assert set(core_own) <= set(with_layer)
    monkeypatch.setattr(sel, "importers", lambda: {})
    without, _ = pick("backend/apps/scheduler/tasks.py")
    # the layer, not the old three rules, is what picked them. mutation: build the graph inline in
    # select() instead of through importers() (so this switch-off misses it) -> red
    assert not set(core_own) & set(without)


def test_the_reverse_layer_stops_after_one_app():
    graph = sel.importers()
    assert "menus" in graph["core"]
    picked, _ = pick("backend/apps/scheduler/tasks.py")
    # mutation: expand `importing` to a fixed point (transitive closure) -> apps/menus/tests.py comes in -> red
    assert "apps/menus/tests.py" not in picked
    # mutation: give importers all three rules instead of their directory -> hundreds of files -> red
    assert len(picked) < len(sel.all_test_files()) // 4


def test_the_import_graph_is_read_with_ast(tmp_path, monkeypatch):
    for app, body in {
        "a": "",
        "b": "def f():\n    from apps.a.models import X\n",   # lazy import inside a function
        "c": "from apps import a\n",                         # the app named in the alias
        "d": "import apps.a.services as s\n",
        "e": "# from apps.a import x\nS = 'import apps.a'\n",  # comment and string: no edge
        "f": "",
    }.items():
        (tmp_path / "apps" / app).mkdir(parents=True)
        (tmp_path / "apps" / app / "m.py").write_text(body)
    (tmp_path / "apps" / "f" / "test_x.py").write_text("from apps.a import models\n")  # test file: no edge
    (tmp_path / "apps" / "f" / "migrations").mkdir()
    (tmp_path / "apps" / "f" / "migrations" / "0001_x.py").write_text("from apps.a import x\n")  # migration: no edge
    monkeypatch.setattr(sel, "BACKEND", str(tmp_path))
    # mutations, each -> red: a regex over the source (e gains an edge); stop skipping test files or
    # migrations (f gains one); drop the `module == "apps"` alias branch (c loses its edge)
    assert sel.importers() == {"a": {"b", "c", "d"}}
