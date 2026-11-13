"""`client.force_authenticate(...)` in tests only shrinks (2026-11-13, user decision; test review 3.3).

Why: `force_authenticate` hands DRF a user and skips everything before the view — no JWT, so
`TenantMiddleware` never puts a hall on the request. Since 2026-10-29 an ADMIN bound to a hall is refused
on that path (only the hall-less ADMIN works without `request.tenant`), and a view that reads
`request.tenant` sees None. So a test signed in this way can be green while the real path answers
differently, or red while it is right. `tests/conftest.py::sign_in(client, user)` signs in the way
production does: a JWT carrying the user's `tenant_code`.

So the uses that exist today are listed, per file, and the list only shrinks:

  - a test file that is not listed may not call it at all;
  - a listed file may not call it more often than recorded;
  - a recorded count above the real one fails too ("stale baseline"), until the number is lowered —
    otherwise the room freed by a migrated test is quietly spent on a new one.

What is counted: a METHOD call `<anything>.force_authenticate(...)`, read with `ast` (a comment or a
string never counts), in every `.py` under `tests/` and every test module under `apps/`
(`tests.py`, `test_*.py`, `conftest.py`, anything in a `tests/` directory). `force_authenticate(user=None)`,
which signs out, is a call like any other.

What is NOT counted: the FUNCTION `force_authenticate(request, user=...)` from `rest_framework.test`, used
with `APIRequestFactory` to hand a request straight to a view or a permission class. That path has no
middleware by construction and no client to sign in; `sign_in` cannot replace it. (7 calls in 6 files on
2026-11-13.) The scanner tells the two apart by shape — attribute call vs. bare name — and
`test_the_scan_tells_the_client_method_from_the_request_function` holds it to that.
ponytail: `fa = client.force_authenticate; fa(user)` is not seen; nobody writes it, read the alias if one does.

Nothing here asks for existing tests to be migrated. When you touch one, switch it to `sign_in` and lower
its number (delete the row at 0).
"""
import ast
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

# "<file under backend/>": client.force_authenticate(...) calls. Measured 2026-11-13: 136 in 45 files.
BASELINE = {
    "apps/audit/tests.py": 1,
    "apps/judgment/tests.py": 7,
    "apps/perm/test_reported_matches_granted.py": 8,
    "apps/perm/tests.py": 23,
    "tests/test_a_node_only_accepts_the_verdicts_it_declares.py": 1,
    "tests/test_a_refused_transition_is_not_reported_as_success.py": 1,
    "tests/test_actor_search_and_seat_are_single_owner.py": 1,
    "tests/test_admin_account_actions_hardened.py": 1,
    "tests/test_an_email_cannot_be_claimed_twice.py": 1,
    "tests/test_archiving_a_disposition_actually_removes_it.py": 1,
    "tests/test_audit.py": 1,
    "tests/test_auth_account.py": 14,
    "tests/test_bound_admin_is_not_reported_global_codenames.py": 1,
    "tests/test_citation_snapshot.py": 1,
    "tests/test_dedication_records.py": 1,
    "tests/test_judgment_api.py": 2,
    "tests/test_judgment_queue.py": 3,
    "tests/test_judgment_statutes.py": 1,
    "tests/test_karma.py": 1,
    "tests/test_karma_distribution_accounts_for_every_soul.py": 1,
    "tests/test_ledger_stats.py": 4,
    "tests/test_logout_errors.py": 1,
    "tests/test_notification_categories.py": 4,
    "tests/test_notification_email.py": 1,
    "tests/test_notifications.py": 1,
    "tests/test_officer_mfa.py": 26,
    "tests/test_officer_push_receipts_and_admin_reset.py": 1,
    "tests/test_perm_all_role_permissions.py": 1,
    "tests/test_perm_api.py": 1,
    "tests/test_perm_matrix_and_role_table.py": 1,
    "tests/test_perm_prefix_discloses_only_the_catalogue.py": 2,
    "tests/test_permission_refresh_is_pushed.py": 2,
    "tests/test_push_registration_expires_with_the_sign_in.py": 1,
    "tests/test_rebirth_quota.py": 2,
    "tests/test_request_context_middleware.py": 2,
    "tests/test_session_end_closes_open_sockets.py": 1,
    "tests/test_souls_filtering.py": 1,
    "tests/test_tenant_api.py": 2,
    "tests/test_the_sidebar_does_not_cost_a_query_per_row.py": 1,
    "tests/test_user_management.py": 2,
    "tests/test_workflow_countersign_notify_conditions.py": 3,
    "tests/test_workflow_instance.py": 1,
    "tests/test_workflow_pointer_never_goes_back.py": 1,
    "tests/test_workflow_template.py": 2,
    "tests/test_workflow_timeout_and_reject_to.py": 1,
}


def _test_files():
    yield from sorted((BACKEND / "tests").rglob("*.py"))
    for path in sorted((BACKEND / "apps").rglob("*.py")):
        if "tests" in path.relative_to(BACKEND).parts or path.name.startswith("test_") \
                or path.name in ("tests.py", "conftest.py"):
            yield path


def _calls(tree: ast.AST) -> tuple[int, int]:
    """(client-method calls, request-function calls) of force_authenticate in one module."""
    method = function = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute) and node.func.attr == "force_authenticate":
                method += 1
            elif isinstance(node.func, ast.Name) and node.func.id == "force_authenticate":
                function += 1
    return method, function


def _found() -> Counter:
    found = Counter()
    for path in _test_files():
        method, _function = _calls(ast.parse(path.read_text(encoding="utf-8")))
        if method:
            found[path.relative_to(BACKEND).as_posix()] = method
    return found


WHY = (
    "client.force_authenticate() skips TenantMiddleware: request.tenant stays empty, so an ADMIN bound to a hall "
    "is refused (2026-10-29) and the test does not exercise the path production takes. Use "
    "`from tests.conftest import sign_in; sign_in(client, user)` — a JWT with the user's tenant_code — instead. "
    "(Handing a request from APIRequestFactory to a view with the function force_authenticate(request, user=...) "
    "is not counted.)")


def test_no_test_file_gains_a_force_authenticate():
    found = _found()
    new = {k: f"{n} (allowed {BASELINE.get(k, 0)})" for k, n in found.items() if n > BASELINE.get(k, 0)}
    assert not new, f"{WHY}\nNew uses: {new}"


def test_the_baseline_is_not_stale():
    found = _found()
    stale = {k: f"recorded {n}, found {found.get(k, 0)}" for k, n in BASELINE.items() if found.get(k, 0) < n}
    assert not stale, ("force_authenticate uses went away (good) — lower these numbers in BASELINE, or delete the "
                       f"row at 0, so the room is not spent on a new one: {stale}")
    assert all(n > 0 for n in BASELINE.values()), "a row at 0 allows nothing; delete it"


def test_the_scan_tells_the_client_method_from_the_request_function():
    """The check is only as good as its reader."""
    tree = ast.parse(
        "from rest_framework.test import force_authenticate\n"
        "def test_a(api_client, user):\n"
        "    api_client.force_authenticate(user=user)\n"
        "    self.client.force_authenticate(None)\n"
        "    # client.force_authenticate(user) in a comment\n"
        "    note = 'client.force_authenticate(user) in a string'\n"
        "def test_b(rf, user):\n"
        "    request = rf.get('/')\n"
        "    force_authenticate(request, user=user)\n")
    assert _calls(tree) == (2, 1)
