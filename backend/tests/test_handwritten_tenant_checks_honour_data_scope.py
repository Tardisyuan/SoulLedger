"""处置、调拨草稿、审批节点三处按 id 指定灵魂 / 流程时,数据范围外的与别殿的一样「不存在」
(重构审查 2026-11-08 后端 1.2)。

这三处的手写校验只比殿;公用的 `apps/core/tenant_fields.py::tenant_scoped` 还查数据范围。
"""
from types import SimpleNamespace

import pytest
from rest_framework import serializers

from apps.dispatch.serializers import DispatchDraftSerializer
from apps.disposition.serializers import DispositionSerializer
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflow
from apps.workflow.serializers import ApprovalNodeSerializer
from tests.data_scope_support import org, scope

pytestmark = pytest.mark.django_db


@pytest.fixture
def world(judge_user, cn_tenant):
    mine, theirs = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    inside = Soul.objects.create(name="内", tenant=cn_tenant, current_state=SoulState.JUDGING, owner_org=mine)
    outside = Soul.objects.create(name="外", tenant=cn_tenant, current_state=SoulState.JUDGING, owner_org=theirs)
    judge_user.organization = mine
    judge_user.save(update_fields=["organization"])
    scope("JUDGE", "ORG")
    context = {"request": SimpleNamespace(user=judge_user, tenant=cn_tenant)}
    return context, inside, outside


@pytest.mark.parametrize("serializer_class", [DispositionSerializer, DispatchDraftSerializer])
def test_a_soul_outside_the_scope_is_refused(world, serializer_class):
    context, inside, outside = world
    serializer = serializer_class(context=context)
    assert serializer.validate_soul(inside) == inside
    with pytest.raises(serializers.ValidationError):
        serializer.validate_soul(outside)


def test_a_workflow_outside_the_scope_is_refused(world, cn_tenant):
    context, inside, outside = world
    serializer = ApprovalNodeSerializer(context=context)
    mine = ApprovalWorkflow.objects.create(soul=inside, tenant=cn_tenant)
    assert serializer.validate_workflow(mine) == mine
    with pytest.raises(serializers.ValidationError):
        serializer.validate_workflow(ApprovalWorkflow.objects.create(soul=outside, tenant=cn_tenant))
