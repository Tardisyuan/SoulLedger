from rest_framework import serializers

from apps.soul_push.models import PushPlatform
from apps.soul_push.views import EXPO_TOKEN_RE
from apps.workflow.serializers import CosignerRowSerializer, WaitingOnCosignerSerializer


class TodoTargetSerializer(serializers.Serializer):
    """推送与列表行落到哪一条:`GET items/<kind>/<id>/`。"""

    kind = serializers.CharField(help_text="approval / reassignment / cooldown / rebirth / letter")
    id = serializers.CharField()


class TodoItemSerializer(serializers.Serializer):
    kind = serializers.CharField(help_text="approval / reassignment / cooldown / rebirth / letter")
    id = serializers.CharField()
    title = serializers.CharField()
    created_at = serializers.DateTimeField()
    target = TodoTargetSerializer()
    node_name = serializers.CharField(required=False, help_text="仅审批节点:轮到的节点名。")
    soul_code = serializers.CharField(required=False, help_text="仅转生申请:此时 `title` 是灵魂名,灵魂码作副行。")
    is_appeal = serializers.BooleanField(required=False, help_text="仅转生申请:是否申诉(客户端据此选标题措辞)。")
    request_kind = serializers.CharField(required=False, help_text="仅受刑计划变更:AMEND / REOPEN(`sentence_plan.request_kinds.*`)。")
    feedback_tag = serializers.CharField(required=False, help_text="仅书信:从 App「帮助与反馈」来的信的类别码"
                                         "(account / record / app / other);还没人回时才有。")
    # 仅「待我选站」(kind = pick,第四十三批):`title` 是灵魂名,`id` 是流程。
    segment_order = serializers.IntegerField(required=False, help_text="仅选站:本域排第几(1 = 发起殿)。")
    go = serializers.IntegerField(required=False, help_text="仅选站:本域这一段要走的站数。")
    total = serializers.IntegerField(required=False, help_text="仅选站:本域这一段的站数(默认流程)。")
    realm = serializers.CharField(required=False, help_text="仅选站:发起殿的租户代码。")
    hall = serializers.CharField(required=False, help_text="仅选站:发起殿的显示名。")
    gate_days = serializers.IntegerField(required=False, allow_null=True,
                                         help_text="仅选站:流程已在门口等的第几天;还没到门口时 null。")
    stations_ahead = serializers.IntegerField(required=False, allow_null=True,
                                              help_text="仅选站:轮到本域之前还有几站;已在门口时 null。")


class TodoGroupSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    items = TodoItemSerializer(many=True)


class TodoSerializer(serializers.Serializer):
    approvals = TodoGroupSerializer()
    reassignments = TodoGroupSerializer()
    cooldowns = TodoGroupSerializer()
    rebirths = TodoGroupSerializer()
    sentence_changes = TodoGroupSerializer(
        help_text="受刑计划变更请求:本殿是原属、等原审判官决定的(最早在前)。需 `judgment.execute`;只看,不推送,计入角标。")
    letters = TodoGroupSerializer(help_text="待回书信:标给我、灵魂最后一封还没回的(最早在前)。需 `soul_inbox.reply`。")
    unassigned_letters = TodoGroupSerializer(
        help_text="未分配的书信:同一个「待回复」里还没人经办的(最早在前)。需 `soul_inbox.reply`;不计入角标与推送数。")
    pick_nodes = TodoGroupSerializer(
        help_text="待我选站(第四十三批):其他殿发起的审批流程里本域那一段还没选站的,在门口等的在前。计入角标。")


class FactHallSerializer(serializers.Serializer):
    code = serializers.CharField()
    display_name = serializers.CharField()


class FactNodeSerializer(serializers.Serializer):
    name = serializers.CharField()
    index = serializers.IntegerField(help_text="第几步(只数需要人决定的节点)。")
    total = serializers.IntegerField()
    is_last = serializers.BooleanField(
        allow_null=True, help_text="批准后流程是否结束。null = 有条件分支、无从判断:App 用通用的一句。")
    next_name = serializers.CharField(allow_null=True, help_text="批准后交给的节点;最后一步或不确定时为 null。")


class FactHistorySerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["start", "decided", "current"])
    name = serializers.CharField(allow_blank=True)
    actor = serializers.CharField(allow_null=True)
    verdict = serializers.CharField(allow_blank=True, help_text="`workflow.verdicts.*` 的码;发起与当前节点为空。")
    comment = serializers.CharField(allow_blank=True)
    at = serializers.DateTimeField(allow_null=True)
    mine = serializers.BooleanField(help_text="当前节点轮到调用者。")


class FactAttachmentSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    content_type = serializers.CharField(help_text="image/png、image/jpeg 或 application/pdf。")
    byte_size = serializers.IntegerField()
    url = serializers.CharField(help_text="站点根相对路径,签名 10 分钟(`/api/v1/case-attachments/<id>/?t=…`)。")


class FactSoulSerializer(serializers.Serializer):
    name = serializers.CharField()
    soul_code = serializers.CharField()
    id = serializers.CharField(required=False, help_text="灵魂 id:App 详情里点灵魂名打开灵魂详情(旧服务端没有)。")


class TodoFactsSerializer(serializers.Serializer):
    """O-01:批准前要看清的申请内容。按类给字段,没有的不出现。"""

    node = FactNodeSerializer(required=False)
    requester = serializers.CharField(required=False, allow_null=True)
    requester_hall = FactHallSerializer(required=False, allow_null=True)
    requested_at = serializers.DateTimeField(required=False, allow_null=True)
    deadline = serializers.DateTimeField(required=False, allow_null=True, help_text="当前节点的时限;没设为 null。")
    reason = serializers.CharField(required=False, allow_blank=True)
    history = FactHistorySerializer(many=True, required=False)
    attachments = FactAttachmentSerializer(many=True, required=False)
    from_hall = FactHallSerializer(required=False, allow_null=True)
    to_hall = FactHallSerializer(required=False, allow_null=True)
    souls = FactSoulSerializer(many=True, required=False)
    soul_count = serializers.IntegerField(required=False)
    soul = FactSoulSerializer(required=False)
    cycle = serializers.IntegerField(required=False, help_text="仅转生:第几世。")
    desired_form = serializers.CharField(required=False, help_text="仅转生:期望去向(`reincarnation.forms.*`)。")
    merit_balance = serializers.IntegerField(required=False, help_text="仅转生:功过结余 = 功 − 过。")
    cross_civilization = serializers.BooleanField(
        required=False, allow_null=True, help_text="仅转生:是否跨文明;null = 初审还没定(批准即按「不跨」)。")
    status = serializers.CharField(required=False, help_text="仅调拨:记录此刻的状态(PROPOSED / APPROVED / …)。")
    cooldown_now_days = serializers.IntegerField(required=False, help_text="仅缩短冷却:现在还剩几天。")
    cooldown_asked_days = serializers.IntegerField(required=False, allow_null=True, help_text="仅缩短冷却:申请改成剩几天。")


class HandledBySerializer(serializers.Serializer):
    id = serializers.IntegerField(allow_null=True)
    name = serializers.CharField()


class TodoItemDetailSerializer(serializers.Serializer):
    """`state`:actionable / already_handled / deadline_passed / permission_changed
    (与决定失败的 `code` 同一组词)。`handled_by` 在调拨上恒为 null(调拨记录不存决定人)。"""

    kind = serializers.CharField(help_text="approval / reassignment / cooldown / rebirth")
    id = serializers.CharField()
    title = serializers.CharField()
    created_at = serializers.DateTimeField()
    actionable = serializers.BooleanField()
    state = serializers.CharField()
    handled_by = HandledBySerializer(allow_null=True)
    handled_at = serializers.DateTimeField(allow_null=True)
    soul_code = serializers.CharField(required=False, help_text="仅转生申请:此时 `title` 是灵魂名,灵魂码作副行。")
    is_appeal = serializers.BooleanField(required=False, help_text="仅转生申请:是否申诉(客户端据此选标题措辞)。")
    facts = TodoFactsSerializer(required=False, help_text="申请内容(O-01):节点、对象字段、事由、前面几步、附件。")
    workflow_id = serializers.CharField(required=False, help_text="审批节点与转生申请:决定走 workflows/<id>/approve_node/。")
    node_id = serializers.CharField(required=False, help_text="待决的节点;决定时作为 node_id 传回。")
    required_verdicts = serializers.ListField(
        child=serializers.CharField(), required=False,
        help_text="该节点接受的裁决(PASSED / CONFIRMED / FAILED / REJECTED …);空 = 不限。批准只在其中的通过类里选。",
    )
    cosigners = CosignerRowSerializer(
        many=True, required=False, help_text="审批节点与转生申请:当前节点的加签人,及各自签了没有。",
    )
    waiting_on_cosigner = WaitingOnCosignerSerializer(
        allow_null=True, required=False,
        help_text="我是指定审批人而加签人还没签完时,第一位欠签的人;此时「批准」会被 409 cosigners_pending 拒绝,App 据此置灰。",
    )


class CosignAddSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(help_text="A `signer-candidates/` id: an officer of the same hall.")


class CosignerSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    user_name = serializers.CharField()
    added_at = serializers.CharField()
    signed_at = serializers.CharField(allow_null=True)


class CosignRefusalSerializer(serializers.Serializer):
    code = serializers.CharField(help_text="not_allowed / not_eligible / duplicate")
    detail = serializers.CharField()


class OfficerPushTokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
    platform = serializers.ChoiceField(choices=PushPlatform.choices)

    def validate_token(self, value):
        if not EXPO_TOKEN_RE.match(value):
            raise serializers.ValidationError("不是 Expo push token(ExponentPushToken[...])。")
        return value


class OfficerPushUnregisterSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)


class SignerCandidateSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    username = serializers.CharField()
    role = serializers.CharField()
