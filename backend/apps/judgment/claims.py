"""认领、释放、改派、暂缓 —— 审判队列「谁在办」的唯一写入路径。

`Judgment.claimed_by` / `deferred_*` 只在这里写。视图负责两件事:这件案子在调用者的
租户里(`get_object()` 或批量时的范围查询),以及调用者持有哪些码名;这里负责剩下的
一切 —— 案子此刻的状态允许这个动作吗,以及两个人同时来时只有一个赢。

并发。每个动作都在 `transaction.atomic()` 里先 `select_for_update(of=("self",))`
锁住案子这一行,**锁到之后再读**认领人。两个官员同时认领同一件案子:第二个在行锁上
等,拿到锁时读到的已是第一个写下的 `claimed_by`,于是得到 409 `already_claimed`,
而不是覆盖它。`of=("self",)` 是 `apps/core/lock_join_guard.py` 要求的写法:锁案子,
不顺带锁住它的灵魂与租户。SQLite 没有行锁,真正的等待只在 PostgreSQL 上可测 ——
`tests/test_concurrency.py::TestJudgmentClaimConcurrency`。

拒绝是 `ClaimRefusedError`,带一个稳定的 `code`,视图原样转成响应体。409 是「请求
合法、调用者也有权,但案子此刻不接受」(与 `destroy` / `cite_statute` 同一区分);
403 是「这件案子不是你的,你又没有改派权」。

历史。写入一律 `save(update_fields=…)` 而不是 `QuerySet.update()`:前者经过审计
信号,每次认领 / 释放 / 改派 / 暂缓都留下一行带前后值的 AuditLog;后者不经信号,
历史就没了。结案不碰这几列,所以已结案的案子仍带着最后的认领人。
"""
from django.db import transaction
from django.utils import timezone

from apps.judgment.models import AT_CITY_GOD, DUAT_BARRED, DuatStage, Judgment, JudgmentKind
from apps.souls import acheron

#: 一次批量最多多少件。与需求一致;超过的请求在序列化器上 400,不截断。
BATCH_LIMIT = 100

_SAVE_FIELDS_BOOKKEEPING = ("version", "update_user", "update_time")


class ClaimRefusedError(Exception):
    """案子此刻不接受这个动作。`code` 是给客户端分支用的稳定键。"""

    def __init__(self, message: str, code: str, status: int = 409, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra

    def as_payload(self) -> dict:
        return {"error": str(self), "code": self.code, **self.extra}


def _lock(pk) -> Judgment:
    return Judgment.all_objects.select_for_update(of=("self",)).get(pk=pk)


def _lock_many(pks) -> list[Judgment]:
    # 按主键排序加锁:两个批量请求以不同顺序锁同一组行,会互相等成死锁。
    return list(Judgment.all_objects.select_for_update(of=("self",)).filter(pk__in=pks).order_by("pk"))


def _assert_pending(judgment: Judgment) -> None:
    """已结案、已撤案、已归档的案子不再有「谁在办」。

    与 `open_judgments` 同一组列;`is_archived` 额外排除,因为队列(`_pending_queue`)
    也排除它。结案后认领信息保留,但不能再改。
    """
    if judgment.verdict is not None or judgment.is_final or judgment.is_deleted or judgment.is_archived:
        raise ClaimRefusedError("This judgment is no longer pending.", "not_pending")
    _assert_sent_on(judgment)


def _assert_sent_on(judgment: Judgment) -> None:
    """还在城隍那里(初审未解送)的案子,十殿不能认领、改派、暂缓、结案(apps/judgment/city_gods.py)。"""
    if judgment.city_god_status in AT_CITY_GOD:
        raise ClaimRefusedError(
            "This case is still with the city god (城隍初审) and reaches the ten courts once sent on.",
            "at_city_god", city_god=str(judgment.city_god_id), city_god_status=judgment.city_god_status,
        )


def assert_concludable(judgment: Judgment) -> None:
    """Every conclude path, an officer's or an in-process one (2026-10-24 user decision): a case still with the
    city god, or an untimely death still held in 枉死城, cannot be concluded. Before this only claiming checked
    `held_until`, and a workflow-driven conclude (by=None) checked neither."""
    _assert_sent_on(judgment)
    _assert_not_held(judgment)


def ferry_barred(judgment) -> str:
    """希腊原审此刻过不了阿刻戎的原因(`Soul.FerryPassage`,UNBURIED / NO_FARE);能过河是空串。

    认领的拒绝与队列的 `ferry_barred` 列(审判队列据此不画「认领」,第五十七批 G-1)读同一条规则。
    """
    soul = judgment.soul
    if (judgment.civilization == "GREEK" and judgment.kind == JudgmentKind.ORIGINAL
            and soul.ferry_passage and not acheron.crossed(soul, timezone.localdate())):
        return soul.ferry_passage
    return ""


def _assert_not_held(judgment: Judgment) -> None:
    """Held before the case can be heard: 枉死城 until the fated date (Diyu), or the Egyptian stages before the
    hall — 70 days of embalming, or for ever when the soul cannot reach it (docs/02 §1.1, 01 §4.2)."""
    if judgment.duat_stage in DUAT_BARRED:
        raise ClaimRefusedError(
            "This soul cannot complete the journey to the Hall of Two Truths.", "duat_unfinished",
            duat_stage=judgment.duat_stage,
        )
    # 希腊:未葬或无渡资的亡魂过不了阿刻戎,滞留岸边,到不了岔路草地受审(docs/01_希腊冥府整体架构.md §2.3;
    # `Soul.ferry_passage`)。读灵魂此刻的记录,不冻在案子上:官员补记「已葬」后即可认领。只拦原审 ——
    # 上诉、重开时灵魂早已过河。未葬者在岸边游荡满一百年后得渡(Aen. 6.325-330,`apps/souls/acheron.py`);
    # 无渡资照拦,死亡日没登记也照拦。
    if ferry := ferry_barred(judgment):
        raise ClaimRefusedError(
            "Charon ferries only the buried who can pay; this soul waits on the bank of Acheron.", "unferried",
            ferry_passage=ferry,
        )
    if judgment.held_until and judgment.held_until > timezone.localdate():
        if judgment.duat_stage == DuatStage.EMBALMING:
            raise ClaimRefusedError(
                "This soul is being embalmed and sets out for the hall when it is done.", "embalming",
                held_until=judgment.held_until.isoformat(),
            )
        raise ClaimRefusedError(
            "This soul died before its fated date and waits in 枉死城 until then.", "held_until_fated_date",
            held_until=judgment.held_until.isoformat(),
        )


def _holder(judgment: Judgment) -> dict:
    return {"claimed_by": judgment.claimed_by_id}


def _save(judgment: Judgment, *fields: str) -> None:
    judgment.save(update_fields=[*fields, *_SAVE_FIELDS_BOOKKEEPING])


def _assert_may_act_on(judgment: Judgment, user, may_override: bool) -> None:
    """别人认领的案子,只有持改派权的人能替他释放或暂缓。"""
    if judgment.claimed_by_id not in (None, user.pk) and not may_override:
        raise ClaimRefusedError(
            "This judgment is claimed by another officer.", "not_claimant", status=403, **_holder(judgment)
        )


#: 结案不受认领限制的角色:ADMIN,以及殿主(MODERATOR)—— 与默认持有 `judgment.assign`
#: 的是同一批人。按角色名判,不按码名:这是用户拍板的「谁可以越过认领」,不随权限矩阵漂。
CONCLUDE_OVERRIDE_ROLES = ("ADMIN", "MODERATOR")


def lock_for_conclude(pk, user) -> Judgment:
    """结案前锁住案子这一行,并确认调用者可以结它。**必须在结案事务里调用。**

    别人认领的案子只有认领人本人能结;ADMIN 与殿主不受此限。无人认领的案子,持
    `judgment.execute` 的人都能结(码名由视图查)。行锁一直持有到结案事务结束,所以
    与「改派」并发时,要么改派先落、结案读到新认领人而被拒,要么结案先落、改派读到
    已结案而得 `not_pending` —— 不会有「按旧认领人放行、按新认领人落判」。
    """
    judgment = _lock(pk)
    assert_concludable(judgment)
    if (
        judgment.claimed_by_id not in (None, user.pk)
        and getattr(user, "role", None) not in CONCLUDE_OVERRIDE_ROLES
    ):
        holder = judgment.claimed_by
        raise ClaimRefusedError(
            "This judgment is claimed by another officer; only they can conclude it.",
            "claimed_by_other",
            claimed_by=judgment.claimed_by_id,
            claimed_by_name=holder.display_name or holder.username,
        )
    return judgment


# ---------------------------------------------------------------------------
# 单件动作的规则(锁已由调用方拿到)
# ---------------------------------------------------------------------------


def _clear_reassign_request(judgment: Judgment) -> list[str]:
    """认领人变了(认领 / 释放 / 改派),先前的「请管理员改派」就作废。返回要一并存的列。"""
    judgment.reassign_requested_at = None
    judgment.reassign_requested_by = None
    judgment.reassign_reason = ""
    return ["reassign_requested_at", "reassign_requested_by", "reassign_reason"]


def _apply_claim(judgment: Judgment, user) -> None:
    _assert_pending(judgment)
    _assert_not_held(judgment)
    if judgment.claimed_by_id == user.pk:
        return  # 幂等:重复认领自己的案子不写、不改 claimed_at
    if judgment.claimed_by_id is not None:
        raise ClaimRefusedError(
            "This judgment is already claimed by another officer.", "already_claimed", **_holder(judgment)
        )
    judgment.claimed_by = user
    judgment.claimed_at = timezone.now()
    _save(judgment, "claimed_by", "claimed_at", *_clear_reassign_request(judgment))


def _apply_release(judgment: Judgment, user, may_override: bool) -> None:
    _assert_pending(judgment)
    if judgment.claimed_by_id is None:
        raise ClaimRefusedError("This judgment is not claimed.", "not_claimed")
    _assert_may_act_on(judgment, user, may_override)
    judgment.claimed_by = None
    judgment.claimed_at = None
    _save(judgment, "claimed_by", "claimed_at", *_clear_reassign_request(judgment))


def _apply_reassign(judgment: Judgment, target) -> None:
    _assert_pending(judgment)
    if judgment.claimed_by_id == target.pk:
        return
    judgment.claimed_by = target
    judgment.claimed_at = timezone.now()
    _save(judgment, "claimed_by", "claimed_at", *_clear_reassign_request(judgment))


def _apply_defer(judgment: Judgment, user, reason: str, may_override: bool) -> None:
    _assert_pending(judgment)
    if judgment.deferred_at is not None:
        raise ClaimRefusedError("This judgment is already deferred.", "already_deferred")
    _assert_may_act_on(judgment, user, may_override)
    judgment.deferred_at = timezone.now()
    judgment.deferred_by = user
    judgment.defer_reason = reason
    _save(judgment, "deferred_at", "deferred_by", "defer_reason")


def _apply_undefer(judgment: Judgment, user, may_override: bool) -> None:
    _assert_pending(judgment)
    if judgment.deferred_at is None:
        raise ClaimRefusedError("This judgment is not deferred.", "not_deferred")
    _assert_may_act_on(judgment, user, may_override)
    judgment.deferred_at = None
    judgment.deferred_by = None
    judgment.defer_reason = ""
    _save(judgment, "deferred_at", "deferred_by", "defer_reason")


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def claim(pk, user) -> Judgment:
    with transaction.atomic():
        judgment = _lock(pk)
        _apply_claim(judgment, user)
    return judgment


def release(pk, user, *, may_override: bool, reason: str = "") -> Judgment:
    with transaction.atomic():
        judgment = _lock(pk)
        holder = judgment.claimed_by_id
        _apply_release(judgment, user, may_override)
        _tell_holder(judgment, holder, user, "judgment_released_for_you", reason)
    return judgment


def reassign(pk, target, *, actor=None, reason: str = "") -> Judgment:
    with transaction.atomic():
        judgment = _lock(pk)
        assert_assignable(target, judgment.tenant_id)
        holder = judgment.claimed_by_id
        _apply_reassign(judgment, target)
        if holder != target.pk:
            _tell_holder(judgment, holder, actor, "judgment_reassigned_away", reason,
                         to=target.display_name or target.username)
    return judgment


def defer(pk, user, reason: str, *, may_override: bool) -> Judgment:
    with transaction.atomic():
        judgment = _lock(pk)
        _apply_defer(judgment, user, reason, may_override)
        _tell_holder(judgment, judgment.claimed_by_id, user, "judgment_deferred_for_you", reason)
    return judgment


def undefer(pk, user, *, may_override: bool, reason: str = "") -> Judgment:
    with transaction.atomic():
        judgment = _lock(pk)
        _apply_undefer(judgment, user, may_override)
        _tell_holder(judgment, judgment.claimed_by_id, user, "judgment_undeferred_for_you", reason)
    return judgment


def _tell_holder(judgment: Judgment, holder_id, actor, kind: str, reason: str = "", **extra) -> None:
    """替别人放回 / 改派 / 暂缓 / 取消暂缓(Design 第四十批 O-a):原经办人收到一条站内通知,带理由。
    自己对自己手上的案子做的不发;没有经办人的也不发。**提交之后才发**(通知失败不回滚动作)。
    理由手机端必填;网页的改派 / 放回不带理由,通知里写「—」。"""
    if holder_id is None or actor is None or holder_id == actor.pk:
        return
    params = {"by": actor.display_name or actor.username, "soul": judgment.soul.name,
              "reason": reason.strip() or "—", "kind": kind, **extra}
    judgment_id = str(judgment.pk)

    def send():
        from apps.authentication.models import User
        from apps.events.services import EventService
        from apps.notifications import messages

        holder = User.objects.filter(pk=holder_id, is_active=True).first()
        if holder is None:
            return
        title, body = messages.render(messages.DEFAULT_LOCALE, kind, params)
        EventService.notify_user(
            holder, title=title, message=body, notification_type="JUDGMENT_CLAIM_CHANGED",
            related_resource="judgment", related_id=judgment_id, params=params,
        )

    transaction.on_commit(send)


def batch(pks, operation: str, user, *, target=None, reason: str = "", may_override: bool = False) -> list[Judgment]:
    """一次对最多 `BATCH_LIMIT` 件案子做同一个动作。**全有或全无。**

    任何一件被拒,`ClaimRefusedError` 带着那件的 `id` 抛出,整个事务回滚 —— 前面已经
    写下的几件也一起撤回。调用方(视图)已确认每个 id 都在调用者的租户里。
    """
    with transaction.atomic():
        judgments = _lock_many(pks)
        if len(judgments) != len(set(pks)):
            # 视图查过范围之后、加锁之前被硬删的行。软删的仍在,由 `_assert_pending` 拒。
            found = {j.pk for j in judgments}
            raise ClaimRefusedError(
                "Some judgments were not found.", "not_found", status=404,
                missing=[str(pk) for pk in pks if pk not in found],
            )
        for judgment in judgments:
            try:
                if operation == "claim":
                    _apply_claim(judgment, user)
                elif operation == "reassign":
                    assert_assignable(target, judgment.tenant_id)
                    _apply_reassign(judgment, target)
                elif operation == "defer":
                    _apply_defer(judgment, user, reason, may_override)
                else:  # pragma: no cover — the serializer's ChoiceField is the gate
                    raise ValueError(operation)
            except ClaimRefusedError as exc:
                exc.extra["id"] = str(judgment.pk)
                raise
    return judgments


def is_assignable(target, tenant_id, codename: str = "judgment.execute") -> bool:
    """改派的对象必须是这件案子所在租户里、能办案的在职官员。**这一条是唯一的规则**:
    改派时由 `assert_assignable` 执行,改派弹层的名单由 `assignable_officers` 按它筛。
    两处问的是同一个函数,名单里有谁,改派就收谁 ——
    `tests/test_judgment_assignable_officers.py` 断言两个集合相等。

    「能办案」= 持有 `judgment.execute`,问的是与视图同一个 `check_permission`,
    所以数据库里撤掉了某人的授权,他就不再能被改派到。灵魂账号(role=SOUL)在
    checker 里一律无权,自然被挡住。

    `codename` 让同一条规则服务别的「交给同僚」:殿司收件箱的经办人问的是
    `soul_inbox.reply`(`apps/chat/inbox.py::assign`)。默认值是审判,调用方不变。
    """
    from apps.perm.checker import check_permission

    return (
        target is not None
        and target.is_active
        and not getattr(target, "is_deleted", False)
        and target.tenant_id == tenant_id
        and check_permission(target, codename)
    )


def assert_assignable(target, tenant_id) -> None:
    if is_assignable(target, tenant_id):
        return
    # 「没有这个人」与「这个人在别的租户」答同一句话:不同的答复就是一个跨租户的
    # 用户枚举口子。同租户里「在,但不能办案」才另说一句。
    if target is not None and target.tenant_id == tenant_id and target.is_active \
            and not getattr(target, "is_deleted", False):
        raise ClaimRefusedError("That officer cannot work judgments.", "invalid_assignee", status=400)
    raise ClaimRefusedError("No such officer in this judgment's tenant.", "invalid_assignee", status=400)


def assignable_officers(users, tenant_id, codename: str = "judgment.execute") -> list:
    """`users` 里能被改派到 `tenant_id` 的案子上的人。`users` 由视图先按租户收窄。

    先在库里去掉灵魂与停用的人只是省事 —— 决定权在 `is_assignable`,它对这两类本来
    就答否。`check_permission` 按角色缓存,逐人问不是逐人查库。
    """
    candidates = users.filter(tenant_id=tenant_id, is_active=True).exclude(role="SOUL").order_by("username")
    return [u for u in candidates if is_assignable(u, tenant_id, codename)]


#: 「请管理员改派」:同一人对同一件案子多久能再请一次。
REASSIGN_REQUEST_WINDOW_SECONDS = 600


def request_reassign(judgment: Judgment, actor, reason: str = "") -> list:
    """改派名单空了时,请 ADMIN 来改派:通知案子所在租户的在职 ADMIN;该租户没有就通知
    全局 ADMIN(tenant 为空,`scope_to_tenant` 唯一放行跨租户的角色)—— 与「忘记密码」
    求助同一条收件人退路(`apps/authentication/tasks.py::notify_password_help`)。
    求助者自己不在收件人里。返回被通知的人。

    存 zh-Hans(推送与兜底),读时按请求语言重渲染(`apps/notifications/messages.py`)。
    """
    from apps.authentication.models import User
    from apps.events.services import EventService
    from apps.notifications import messages

    admins = User.objects.filter(role="ADMIN", is_active=True).exclude(pk=actor.pk).order_by("pk")
    recipients = list(admins.filter(tenant_id=judgment.tenant_id)) or list(admins.filter(tenant__isnull=True))
    params = {"by": actor.display_name or actor.username, "soul": judgment.soul.name}
    # 有理由时用 `_with_reason` 那句(审批人读);没有理由(网页路径)与旧通知仍是原来的句子。
    if reason:
        params["reason"] = reason
        params["kind"] = "judgment_reassign_requested_with_reason"
    kind = params.get("kind", "judgment_reassign_requested")
    # 持久标记:官员端重开也知道「已请求」;改派 / 释放 / 认领时清。
    judgment.reassign_requested_at = timezone.now()
    judgment.reassign_requested_by = actor
    judgment.reassign_reason = reason[:500]
    _save(judgment, "reassign_requested_at", "reassign_requested_by", "reassign_reason")
    title, body = messages.render(messages.DEFAULT_LOCALE, kind, params)
    for admin in recipients:
        EventService.notify_user(
            admin, title=title, message=body, notification_type="JUDGMENT_REASSIGN_REQUESTED",
            related_resource="judgment", related_id=str(judgment.pk), params=params,
        )
    return recipients
