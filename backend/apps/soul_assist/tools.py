"""助手的三个只读工具(docs/ARCHITECTURE-soul-assist.md §4.1)。

**每个工具只收 `account`,不收任何 id。** 数据范围由 `SoulAPIView.account` 决定,
模型能选的只有「调哪个工具」,选不了「读谁的」。`tests/test_soul_assist.py` 钉住签名。

**白名单,不复用序列化器。** `MeProfileSerializer` 带姓名、灵魂编号、生卒日期、功过分 ——
这些会发给第三方模型,而回答「怎么申请」一个都用不上。这里只写出回答需要的字段:
- 灵魂自己写的申请陈述、申诉陈述**不出去**(防注入,决策 A9);
- 官员写的驳回理由出去(决策 A8),服务层把整个结果当作数据块交给模型(§4.4);
- 行的 id / 站的 id 不出去。
"""
import json

from apps.soul_assist.providers import ToolSpec

SPECS = [
    ToolSpec("me", "The asking soul's own status: home civilization, current jurisdiction, "
                   "whether it is residing away from home, and its soul state."),
    ToolSpec("rebirth", "Whether the asking soul may apply for rebirth now (with a reason code if not "
                        "and the cooldown end if any), and its rebirth applications in this life: "
                        "status, current review step, whether it can still appeal, rejection reasons."),
    ToolSpec("sentence_plan", "The asking soul's sentence plan in this life: overall state, whether "
                              "rebirth opens after it, and each station's status, realm, term and dates."),
]


def _me(account):
    soul = account.soul
    return {
        "home_civilization": soul.home_civilization,
        "civilization": soul.civilization,
        "is_residing": soul.is_residing,
        "current_state": soul.current_state,
    }


def _rebirth(account):
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication

    can, reason, until = rebirth.eligibility(account)
    rows = (RebirthApplication.objects.filter(soul=account.soul, cycle=account.cycle)
            .select_related("workflow__current_node", "appeal_workflow__current_node").order_by("created_at"))
    return {
        "can_apply": can, "reason": reason, "cooldown_until": until,
        "applications": [{
            "status": a.status,
            "desired_form": a.desired_form,
            "current_step": rebirth.current_step(a),
            "can_appeal": rebirth.can_appeal(a, account),
            "rejection_reason": a.rejection_reason,
            "first_rejection_reason": a.first_rejection_reason,
            "created_at": a.created_at,
            "decided_at": a.decided_at,
            "cooldown_until": rebirth.cooldown_until(a),
        } for a in rows],
    }


def _sentence_plan(account):
    from apps.sentence_plan.soul_view import soul_plan

    plan = soul_plan(account)
    return {
        "state": plan["state"],
        "rebirth_open": plan["rebirth_open"],
        "stations": [{
            "n": s["n"], "status": s["status"], "is_home": s["is_home"], "civilization": s["civilization"],
            "realm": None if s["realm"] is None else {
                "realm_code": s["realm"].realm_code, "name_local": s["realm"].name_local,
                "name_zh": s["realm"].name_zh, "name_en": s["realm"].name_en,
            },
            "sentence_years": s["sentence_years"], "is_eternal": s["is_eternal"],
            "started_on": s["started_on"], "ends_on": s["ends_on"],
        } for s in plan["stations"]],
    }


TOOLS = {"me": _me, "rebirth": _rebirth, "sentence_plan": _sentence_plan}


def run(name, account) -> str:
    """工具结果序列化成 JSON 字符串。未知工具名(模型编的)答一个错误对象,不抛异常。"""
    tool = TOOLS.get(name)
    if tool is None:
        return json.dumps({"error": "unknown_tool"})
    return json.dumps(tool(account), default=str, ensure_ascii=False)
