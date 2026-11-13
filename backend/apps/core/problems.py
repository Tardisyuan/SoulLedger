"""The one error envelope: RFC 9457 `application/problem+json` (2026-11-14 用户决定,一次切换,不双写).

Every 4xx/5xx body the API sends is::

    {"type": "about:blank", "title": "Conflict", "status": 409,
     "code": "not_claimant",            # ProblemCode: the stable key clients branch on
     "detail": "…one sentence…",        # optional
     "instance": "9f3c2a1b…",           # the request id (X-Request-ID), when there is one
     "errors": [{"field": "reason", "code": "blank", "detail": "…"}],  # validation only
     "claimed_by": 12}                  # extension members stay flat

Two ways in, both end in `body()`:

* a view returns `problem(status, code, detail, **extra)`;
* anything raises — DRF's own exceptions, `ValidationError`, `Problem(...)` — and
  `exception_handler` (settings `REST_FRAMEWORK["EXCEPTION_HANDLER"]`) converts it.

Before this there were three shapes (`{"error": …}`, `{"detail": …}`, DRF's field dict)
and the client carried a reader per shape. `tests/test_problem_envelope.py` fails on a
view that builds its own error dict again.
"""
import http
import re
import warnings

from rest_framework import exceptions, serializers
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from apps.core.problem_codes import DEFAULT_CODE_BY_STATUS, PROBLEM_CODE_CHOICES, PROBLEM_CODES, UnknownProblemCode
from apps.core.trace import get_trace_id

CONTENT_TYPE = "application/problem+json"
#: Members RFC 9457 defines, plus the two this API adds. An extension may not reuse them.
RESERVED = frozenset({"type", "title", "status", "detail", "instance", "code", "errors"})


def default_code(status: int) -> str:
    return DEFAULT_CODE_BY_STATUS.get(status, "error" if status >= 500 else "bad_request")


def body(status: int, code=None, detail=None, *, errors=None, **extra) -> dict:
    clash = RESERVED & extra.keys()
    if clash:
        raise TypeError(f"problem extension members may not reuse {sorted(clash)}")
    code = str(code) if code else default_code(status)
    if code not in PROBLEM_CODES:
        # Production keeps the answer; pytest turns this into a failure (pytest.ini filterwarnings).
        warnings.warn(f"problem code {code!r} is not in ProblemCode", UnknownProblemCode, stacklevel=3)
    out = {"type": "about:blank", "title": _title(status), "status": status, "code": code}
    if detail not in (None, ""):
        out["detail"] = str(detail)
    trace_id = get_trace_id()
    if trace_id:
        out["instance"] = trace_id
    if errors is not None:
        out["errors"] = errors
    out.update(extra)
    return out


def problem(status: int, code=None, detail=None, *, headers=None, **extra) -> Response:
    """The response a view returns instead of a hand-built `Response({...}, status=4xx)`."""
    return Response(body(status, code, detail, **extra), status=status, headers=headers, content_type=CONTENT_TYPE)


class Problem(exceptions.APIException):
    """Raise-able `problem()`: `raise Problem(409, "name_taken", "…", name=value)`."""

    def __init__(self, status: int, code=None, detail=None, **extra):
        self.status_code = status
        self.problem_code = str(code) if code else default_code(status)
        self.problem_detail = detail
        self.extra = extra
        super().__init__(detail=detail or _title(status), code=self.problem_code)


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    response.data = from_exception(exc, response.status_code, response.data)
    response.content_type = CONTENT_TYPE
    return response


def from_exception(exc, status: int, data) -> dict:
    if isinstance(exc, Problem):
        return body(status, exc.problem_code, exc.problem_detail, **exc.extra)
    if isinstance(exc, exceptions.ValidationError):
        errors = list(_flatten(data))
        general = next((e["detail"] for e in errors if "field" not in e), None)
        first = errors[0]["detail"] if errors else None
        return body(status, "invalid", general or first, errors=errors)
    if isinstance(data, dict):
        data = dict(data)
        code = data.pop("code", None) or _code_of(exc)
        detail = data.pop("detail", None)
        return body(status, code, detail, **{k: _plain(v) for k, v in data.items() if k not in RESERVED})
    if isinstance(data, list):
        return body(status, _code_of(exc), str(data[0]) if data else None)
    return body(status, _code_of(exc), data)


def _code_of(exc):
    if not isinstance(exc, exceptions.APIException):
        return None
    try:
        codes = exc.get_codes()
    except (AttributeError, TypeError):
        # `detail` carries plain values next to the message (the login view adds `remaining_attempts: 3`), which
        # DRF's get_codes cannot walk; the exception's own default code still names it.
        return getattr(exc, "default_code", None)
    return codes if isinstance(codes, str) else None


def _plain(value):
    """ErrorDetail → str, recursively: the extension members of a raised refusal."""
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return str(value) if isinstance(value, exceptions.ErrorDetail) else value


def _flatten(data, path: str = ""):
    """DRF's nested `{field: [ErrorDetail]}` → `[{field, code, detail}]`; object-level errors have no `field`.

    Nested serializers and list items join with dots: `items.0.name`. A dict whose `code` is a code (not a
    sentence) is one error of its field, not a nested object: the password validators' `{code, message}`
    (`apps/authentication/passwords.py`), or a coded refusal with its facts (`city_god_views._refusal`:
    `{code, region, city_god}`) — the facts ride on the item.
    """
    if isinstance(data, dict) and _is_reason(data):
        facts = {k: _plain(v) for k, v in data.items() if k not in ("code", "message", "detail", "field")}
        yield {**_entry(path, data["code"], data.get("message") or data.get("detail") or data["code"]), **facts}
    elif isinstance(data, dict):
        for key, value in data.items():
            if key in ("non_field_errors", "detail"):
                yield from _flatten(value, path)
            else:
                yield from _flatten(value, f"{path}.{key}" if path else str(key))
    elif isinstance(data, list):
        for i, value in enumerate(data):
            if isinstance(value, (dict, list)) and not (isinstance(value, dict) and _is_reason(value)):
                yield from _flatten(value, f"{path}.{i}" if path else str(i))
            else:
                yield from _flatten(value, path)
    else:
        yield _entry(path, getattr(data, "code", None) or "invalid", data)


_CODE = re.compile(r"^[a-z][a-z0-9_]*$")


def _is_reason(data: dict) -> bool:
    return isinstance(data.get("code"), str) and bool(_CODE.match(data["code"]))


def _entry(path, code, detail) -> dict:
    entry = {"code": str(code), "detail": str(detail)}
    if path:
        entry["field"] = path
    return entry


def _title(status: int) -> str:
    try:
        return http.HTTPStatus(status).phrase
    except ValueError:
        return "Error"


# ── OpenAPI ─────────────────────────────────────────────────────────────


class ProblemFieldErrorSerializer(serializers.Serializer):
    """One validation error. A coded field refusal adds its facts as further members (`region`, `city_god` …)."""

    field = serializers.CharField(required=False, help_text="Dotted path (`items.0.name`); absent = the whole request.")
    code = serializers.CharField(help_text="DRF's validation code (`required`, `blank`, `max_length` …) or the view's own.")
    detail = serializers.CharField()


class ProblemSerializer(serializers.Serializer):
    """RFC 9457 problem details. Every 4xx/5xx of this API is one (`apps/core/problems.py`).

    A named error component that adds members subclasses this; one that adds nothing is folded into
    `Problem` by `problem_responses` below.
    """

    type = serializers.CharField(help_text="Always `about:blank`: `code` is the discriminator.")
    title = serializers.CharField(help_text="The HTTP status phrase.")
    status = serializers.IntegerField()
    code = serializers.ChoiceField(choices=PROBLEM_CODE_CHOICES)
    detail = serializers.CharField(required=False)
    instance = serializers.CharField(required=False, help_text="The request id (`X-Request-ID`).")
    errors = ProblemFieldErrorSerializer(many=True, required=False, help_text="Validation problems only.")


def problem_responses(result, generator, request, public):
    """Spectacular post-processing hook: every 4xx/5xx is `application/problem+json`, and a component that is
    exactly `Problem` (a subclass that added nothing, an untyped object, `DetailResponse`) becomes a `$ref` to it."""
    schemas = result.get("components", {}).get("schemas", {})
    problem_props = schemas["Problem"]["properties"]
    same = {name for name, comp in schemas.items() if name != "Problem" and comp.get("properties") == problem_props}
    ref = {"$ref": "#/components/schemas/Problem"}
    for path in result.get("paths", {}).values():
        for operation in path.values():
            if not isinstance(operation, dict):
                continue
            for code, response in (operation.get("responses") or {}).items():
                if str(code)[:1] not in ("4", "5") or not response.get("content"):
                    continue
                content = response["content"]
                schema = (content.get("application/json") or next(iter(content.values()))).get("schema") or {}
                name = schema.get("$ref", "").rsplit("/", 1)[-1]
                if not name or name in same or name == "DetailResponse":
                    schema = ref
                response["content"] = {CONTENT_TYPE: {"schema": schema}}
    text = repr(result.get("paths")) + repr(schemas)
    for name in same:
        if f"#/components/schemas/{name}'" not in text:
            del schemas[name]
    return result


def field_errors(response_or_data) -> dict:
    """`{field: [detail, …]}` from a problem body's `errors[]` — the shape DRF's 400 had before the envelope, for
    the tests (and any caller) that ask which fields were refused. Object-level errors sit under `non_field_errors`."""
    data = getattr(response_or_data, "data", response_or_data)
    if data is None and hasattr(response_or_data, "json"):
        data = response_or_data.json()
    out: dict = {}
    for e in (data or {}).get("errors", []) if isinstance(data, dict) else []:
        out.setdefault(e.get("field", "non_field_errors"), []).append(e.get("detail", ""))
    return out
