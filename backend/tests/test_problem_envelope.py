"""Every error is one RFC 9457 problem (apps/core/problems.py, 2026-11-14 用户决定).

Two halves: the source guard (no view builds its own error body again) and the converter (every way an error
leaves the API ends in the same shape).
"""
import ast
import re
import warnings
from pathlib import Path

import pytest
import yaml
from rest_framework import exceptions
from rest_framework.test import APIRequestFactory

from apps.core.problem_codes import PROBLEM_CODES, UnknownProblemCode
from apps.core.problems import CONTENT_TYPE, Problem, body, exception_handler, problem

APPS = Path(__file__).resolve().parents[1] / "apps"
SCHEMA = Path(__file__).resolve().parents[2] / "packages" / "core" / "openapi" / "schema.yml"

#: `Response(…, status=<4xx/5xx>)` that is not an error envelope: the health probe's own report, and the
#: idempotency replay of a stored 2xx (its status is a variable).
RESPONSE_ALLOWED = {"core/health.py", "core/idempotency.py"}
#: Dicts with an `"error"` key that never reach an HTTP error body: tool results handed to the model, the
#: assistant's stream events, a workflow event payload, a notification's last delivery failure.
ERROR_KEY_ALLOWED = {
    "judgment/ai_statutes.py", "soul_assist/tools.py", "soul_assist/officer_tools.py", "soul_assist/features.py",
    "soul_assist/serializers.py", "workflow/timeouts.py", "notifications/views.py",
}


def _sources():
    for path in sorted(APPS.rglob("*.py")):
        rel = path.relative_to(APPS).as_posix()
        if "/tests" in f"/{rel}" or "/migrations/" in rel or path.name.startswith("test_") or rel == "core/problems.py":
            continue
        yield rel, path.read_text(encoding="utf-8")


def _status(call: ast.Call):
    node = next((k.value for k in call.keywords if k.arg == "status"), call.args[1] if len(call.args) > 1 else None)
    if node is None:
        return None
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    match = re.search(r"HTTP_(\d{3})", ast.unparse(node))
    return int(match.group(1)) if match else "dynamic"


def hand_built_errors(sources) -> list[str]:
    found = []
    for rel, src in sources:
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Response":
                status = _status(node)
                data = node.args[0] if node.args else None
                if rel in RESPONSE_ALLOWED or status is None:
                    continue
                if status == "dynamic" and not isinstance(data, ast.Dict):
                    continue
                if status == "dynamic" or status >= 400:
                    found.append(f"{rel}:{node.lineno} Response(..., status={status}) — use problem()")
            elif isinstance(node, ast.Dict) and rel not in ERROR_KEY_ALLOWED:
                if any(isinstance(k, ast.Constant) and k.value == "error" for k in node.keys):
                    found.append(f"{rel}:{node.lineno} a dict with an \"error\" key — a problem says `detail`")
    return found


def test_no_view_builds_its_own_error_body():
    found = hand_built_errors(_sources())
    assert not found, "\n".join(found)


@pytest.mark.parametrize("snippet", [
    'from rest_framework.response import Response\ndef v(r):\n    return Response({"error": "x"}, status=400)\n',
    'from rest_framework.response import Response\ndef v(r):\n    return Response({"detail": "x"}, status=status.HTTP_409_CONFLICT)\n',
    'from rest_framework.response import Response\ndef v(r, e):\n    return Response({"code": e.code}, status=e.status)\n',
    'def refusal():\n    return {"error": "x", "code": "y"}\n',
])
def test_the_guard_sees_each_shape(snippet):
    assert hand_built_errors([("judgment/views.py", snippet)])


def test_the_guard_leaves_success_bodies_alone():
    ok = 'def v(r):\n    return Response({"detail": "saved"})\n    return Response(data, status=201)\n'
    assert not hand_built_errors([("judgment/views.py", ok)])


# ── the converter ───────────────────────────────────────────────────────


def _handled(exc):
    request = APIRequestFactory().get("/")
    return exception_handler(exc, {"request": request, "view": None})


def test_a_view_problem_has_the_rfc_members_and_the_problem_media_type():
    response = problem(409, "not_claimant", "Someone else holds it.", claimed_by=7)
    assert response.content_type == CONTENT_TYPE
    data = response.data
    assert data["type"] == "about:blank" and data["title"] == "Conflict" and data["status"] == 409
    assert data["code"] == "not_claimant" and data["detail"] == "Someone else holds it." and data["claimed_by"] == 7
    assert "error" not in data and "errors" not in data


def test_no_code_gets_the_generic_name_of_its_status():
    assert body(404)["code"] == "not_found"
    assert body(429)["code"] == "throttled"


def test_an_extension_may_not_reuse_a_member_name():
    with pytest.raises(TypeError, match="reuse"):
        body(409, "not_cancellable", **{"title": "APPROVED"})


def test_a_code_outside_the_enum_warns():
    assert "no_such_code_anywhere" not in PROBLEM_CODES
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        body(400, "no_such_code_anywhere")
    assert [w.category for w in caught] == [UnknownProblemCode]


def test_validation_errors_become_errors_with_field_paths_and_codes():
    exc = exceptions.ValidationError({
        "reason": [exceptions.ErrorDetail("This field may not be blank.", code="blank")],
        "items": [{}, {"name": [exceptions.ErrorDetail("Required.", code="required")]}],
        "non_field_errors": [exceptions.ErrorDetail("Pick one.", code="pick_one")],
        "new_password": [{"code": "password_too_short", "message": "Too short."}],
    })
    data = _handled(exc).data
    assert data["status"] == 400 and data["code"] == "invalid"
    assert data["detail"] == "Pick one."  # the object-level sentence, not a field's
    assert data["errors"] == [
        {"field": "reason", "code": "blank", "detail": "This field may not be blank."},
        {"field": "items.1.name", "code": "required", "detail": "Required."},
        {"code": "pick_one", "detail": "Pick one."},
        {"field": "new_password", "code": "password_too_short", "detail": "Too short."},
    ]


def test_drf_exceptions_keep_their_code():
    data = _handled(exceptions.NotAuthenticated()).data
    assert (data["status"], data["code"], data["title"]) == (401, "not_authenticated", "Unauthorized")
    refused = exceptions.PermissionDenied({"detail": "请先修改密码。", "code": "password_change_required"})
    data = _handled(refused).data
    assert (data["status"], data["code"], data["detail"]) == (403, "password_change_required", "请先修改密码。")


def test_a_raised_problem_keeps_its_extension_types():
    response = _handled(Problem(409, "rebirth_blocked", "Not yet.", term_end={"year": 2029}))
    assert response.content_type == CONTENT_TYPE
    assert response.data["term_end"] == {"year": 2029}


@pytest.mark.django_db
def test_instance_is_the_request_id(api_client):
    response = api_client.get("/api/v1/souls/", HTTP_X_REQUEST_ID="abcdef0123456789")
    assert response.status_code == 401
    assert response["Content-Type"] == CONTENT_TYPE
    assert response.json()["instance"] == "abcdef0123456789"


# ── the document ────────────────────────────────────────────────────────


def test_every_error_response_in_the_committed_schema_is_a_problem():
    doc = yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))
    schemas = doc["components"]["schemas"]
    problem_members = set(schemas["Problem"]["properties"])
    assert {"type", "title", "status", "code", "detail", "instance", "errors"} <= problem_members
    wrong = []
    for path, operations in doc["paths"].items():
        for method, operation in operations.items():
            for status, response in operation.get("responses", {}).items():
                if not status.startswith(("4", "5")) or "content" not in response:
                    continue
                if list(response["content"]) != [CONTENT_TYPE]:
                    wrong.append(f"{method.upper()} {path} {status}: {list(response['content'])}")
                    continue
                name = response["content"][CONTENT_TYPE]["schema"].get("$ref", "").rsplit("/", 1)[-1]
                if not problem_members <= set(schemas.get(name, {}).get("properties", {})):
                    wrong.append(f"{method.upper()} {path} {status}: {name or 'inline'} is not a Problem")
    assert not wrong, "\n".join(wrong[:30])
