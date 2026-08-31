"""每一个能写 `AuditUserFields` 模型的 viewset 都必须挂 `AuditUserViewSetMixin`。

`apps/core/viewsets.py::AuditUserViewSetMixin` 是**唯一**设置 `create_user` /
`update_user` 那个 contextvar 的地方。2026-08-29 穷举真实 URLconf:20 个可写的
审计 viewset 里 **8 个没挂** —— `DeathRegistrationViewSet`、`ExternalApiKeyViewSet`、
`WebhookViewSet`、`CrossTenantJudgmentViewSet`、`MenuButtonViewSet`、`MenuViewSet`、
`NotificationViewSet`、`ReincarnationViewSet`。实测有一条伪造记录 `create_user=None`。

**API key 与 webhook 配置上「谁加的」正是审计的全部问题。**

这个文件从**真实的 URLconf**遍历,不是从一份手写名单 —— 手写名单正是上一次
漏掉这 8 个的原因。新加一个可写 viewset 而忘了挂,这里报红。
"""
import pytest
from django.urls import get_resolver
from rest_framework.viewsets import ViewSetMixin

from apps.core.models import AuditUserFields
from apps.core.viewsets import AuditUserViewSetMixin

WRITE_ACTIONS = {"create", "update", "partial_update", "destroy"}

#: Viewsets that write an audit model but deliberately do not carry the mixin.
#: Empty on purpose — an entry here needs a reason, and the reason has to be
#: that the rows it writes genuinely have no author.
EXEMPT: dict = {}


def _viewset_classes():
    seen = {}
    for pattern in get_resolver().url_patterns:
        _walk(pattern, seen)
    return seen


def _walk(pattern, seen):
    if hasattr(pattern, "url_patterns"):
        for child in pattern.url_patterns:
            _walk(child, seen)
        return
    callback = getattr(pattern, "callback", None)
    cls = getattr(callback, "cls", None)
    if cls is None or not issubclass(cls, ViewSetMixin):
        return
    # `.values()`, not the keys. DRF's router stores `{http_method: action}`
    # — `{"post": "create", "get": "list"}` — so reading the keys gives HTTP
    # verbs, which intersect `WRITE_ACTIONS` in exactly zero cases. The first
    # version of this file did read the keys, found 0 viewsets, and would have
    # passed silently if `test_the_enumeration_finds_a_realistic_number_of_
    # viewsets` were not sitting above it.
    actions = set((getattr(callback, "actions", {}) or {}).values())
    seen.setdefault(cls, set()).update(actions)


def _model_of(cls):
    queryset = getattr(cls, "queryset", None)
    if queryset is not None:
        return queryset.model
    serializer = getattr(cls, "serializer_class", None)
    return getattr(getattr(serializer, "Meta", None), "model", None)


def _writable_audit_viewsets():
    out = {}
    for cls, actions in _viewset_classes().items():
        if not (actions & WRITE_ACTIONS):
            continue
        model = _model_of(cls)
        if model is None or not issubclass(model, AuditUserFields):
            continue
        out[cls] = model
    return out


def test_the_enumeration_finds_a_realistic_number_of_viewsets():
    """守卫的守卫。

    下面那条是 `assert missing == []`。**遍历返回空集合时它最干净** —— 而
    「URLconf 的走法变了、一个都没找到」和「一个都没漏」在输出里长得一样。
    这就是 [[verification-mechanisms-fail-silently-here]] 的形状。
    """
    found = _writable_audit_viewsets()
    assert len(found) >= 15, (
        f"只枚举到 {len(found)} 个可写审计 viewset;2026-08-29 实测是 20 个 —— "
        f"遍历大概率坏了,而下面那条断言会因此静默通过。找到的:"
        f"{sorted(c.__name__ for c in found)}"
    )


@pytest.mark.parametrize(
    "cls", sorted(_writable_audit_viewsets(), key=lambda c: c.__name__)
)
def test_it_sets_the_current_user_before_writing(cls):
    if cls.__name__ in EXEMPT:
        pytest.skip(EXEMPT[cls.__name__])
    assert issubclass(cls, AuditUserViewSetMixin), (
        f"{cls.__module__}.{cls.__name__} 能写 {_model_of(cls).__name__}"
        f"(一个 AuditUserFields 模型)却没挂 AuditUserViewSetMixin —— "
        f"它写的行 `create_user` / `update_user` 会是 None"
    )


def test_the_exempt_list_does_not_name_anything_that_no_longer_exists():
    """一份指向已删类的豁免名单,是一条永远不会红的规则。"""
    live = {c.__name__ for c in _writable_audit_viewsets()}
    stale = sorted(set(EXEMPT) - live)
    assert stale == [], f"EXEMPT 里这些已经不是可写审计 viewset 了:{stale}"
