"""
Reincarnation service — executes rebirth cycles.
"""
from rest_framework.exceptions import APIException

from apps.disposition.models import Disposition
from apps.ledger.services import LedgerService
from apps.souls.models import Soul, SoulState


class RebirthQuotaFull(APIException):
    """This month's quota for the path is used up: the soul stays REINCARNATING (that is the waiting line) until
    next month or until a hall admin raises the quota. 409, with the numbers, so a client can say so."""

    status_code = 409
    default_code = "rebirth_quota_full"

    def __init__(self, form: str, limit: int, used: int):
        super().__init__({"code": "rebirth_quota_full", "rebirth_form": form, "limit": limit, "used": used,
                          "detail": f"This month's quota for {form} is full ({used}/{limit})"})


class SoupNotTaken(APIException):
    """地府的灵魂还没饮孟婆汤(2026-10-25):转世拒绝,灵魂留在 REINCARNATING,饮过之后再转。"""

    status_code = 409
    default_code = "soup_not_taken"

    def __init__(self):
        super().__init__({"code": "soup_not_taken",
                          "detail": "A soul of Diyu must drink the soup of Meng Po before rebirth."})


class SoupRefused(APIException):
    """此刻不能记饮汤:不是地府的灵魂(`not_diyu`),或不在候转世(`not_reincarnating`),或本世已饮过(`soup_already_taken`)。"""

    status_code = 409
    default_code = "soup_refused"

    def __init__(self, code, detail):
        super().__init__({"code": code, "detail": detail})


def needs_soup(soul) -> bool:
    from apps.souls.models import Civilization

    return soul.civilization == Civilization.CHINESE


def drink_soup(soul):
    """记下本世饮孟婆汤(灵魂行锁下)。地府、REINCARNATING、本世未饮,三者都满足才写;事件同一事务。"""
    from django.db import transaction
    from django.utils import timezone

    from apps.events.services import EventService

    with transaction.atomic():
        soul = Soul.all_objects.select_for_update(of=("self",)).get(pk=soul.pk)
        if not needs_soup(soul):
            raise SoupRefused("not_diyu", "Only a soul of Diyu drinks the soup of Meng Po.")
        if soul.current_state != SoulState.REINCARNATING:
            raise SoupRefused("not_reincarnating", f"The soul is {soul.current_state}, not waiting for rebirth.")
        if soul.soup_taken_at is not None:
            raise SoupRefused("soup_already_taken", "The soul has already drunk the soup in this life.")
        soul.soup_taken_at = timezone.now()
        soul.save(update_fields=["soup_taken_at"])
        EventService.log(soul, "MENGPO_SOUP_TAKEN", {"taken_at": soul.soup_taken_at.isoformat()})
    return soul


def _month_start():
    from django.utils import timezone

    return timezone.localtime().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def quota_of(tenant) -> dict:
    """{form: limit} for the forms that have a limit; a form missing here is unlimited."""
    from apps.tenants.models import REBIRTH_QUOTA_SETTING

    raw = (getattr(tenant, "settings", None) or {}).get(REBIRTH_QUOTA_SETTING) or {}
    return {k: v for k, v in raw.items() if isinstance(v, int) and v >= 0}


def quota_usage(tenant) -> dict:
    """{form: {"limit": int | None, "used": int}} for this calendar month, every form listed."""
    from django.db.models import Count

    from apps.reincarnation.models import RebirthForm, Reincarnation

    limits = quota_of(tenant)
    used = dict(Reincarnation.objects.filter(tenant=tenant, reincarnated_at__gte=_month_start())
                .values_list("rebirth_form").annotate(n=Count("id")).values_list("rebirth_form", "n"))
    return {form: {"limit": limits.get(form), "used": used.get(form, 0)} for form in RebirthForm.values}


class RebirthRefusedError(Exception):
    """The soul could not make the move the rebirth depends on.

    Raised rather than returned, and raised **inside** `complete_rebirth`'s
    transaction, because by that point the row and the score rewrites are
    already staged: returning would commit them around a rebirth that did not
    happen.
    """


class ReincarnationService:
    """
    Handles reincarnation execution and rebirth completion.
    """

    @staticmethod
    def execute(disposition: Disposition) -> bool:
        """
        Trigger reincarnation from a disposition.
        Disposition must be executed first via DispositionService.execute().

        Returns False, and logs nothing, when the soul's cosmology has no next
        life for it to be waiting on.

        WHAT THIS USED TO DO. The transition's return value was dropped and the
        event was written **unconditionally**, before anything had been
        established about whether the move happened. Measured on an EG_DUAT
        soul, DISPOSED:

            DispositionService.execute   -> state SETTLED   (correct)
            ReincarnationService.execute -> True, state still SETTLED (refused)
            soul.events = ['REINCARNATION_TRIGGERED', 'STATE_CHANGED', ...]

        So every executed Egyptian or European disposition left
        `REINCARNATION_TRIGGERED` on the soul's timeline -- **exactly the lie
        `SoulState.SETTLED` exists to stop telling.** A soul admitted to the
        Field of Reeds had a record saying it had been sent to be reborn.

        Why nobody noticed: `apps/disposition/tests.py::_execute_for` calls
        `DispositionService.execute` and **never the
        `ReincarnationService.execute` that the view calls immediately after
        it** -- the fixture was one step shorter than the production path. And
        no test anywhere asserted that `REINCARNATION_TRIGGERED` must be
        *absent* for a terminal cosmology.

        THE TEST IS THE STATE, NOT THE TRANSITION. The first attempt at this
        fix gated the event on `transition_to`'s return value, and it was
        wrong in the other direction: for a rebirth-capable soul,
        `DispositionService.execute` has **already** moved it to REINCARNATING,
        so the call here is a same-state transition, which is refused, and the
        event that should be written was not. The question this event answers
        is "is this soul queued for rebirth", and the honest way to ask it is
        to look at where the soul is now.
        """
        from django.db import transaction

        # The state move and the event that records it are one unit (a failed event insert undoes the move).
        with transaction.atomic():
            soul = disposition.soul
            # 暂居租户写的处置(2026-09-17:调拨是暂居)。它执行完毕时灵魂已经回到原属
            # (DispositionService._execute_during_residence),下一世由原文明决定 ——
            # 这里若照常推 DISPOSED → REINCARNATING,就是暂居租户替原文明做了决定。
            # 实测:没有这一行时,埃及官员执行暂居处置的那一次请求把回归的中国灵魂推进了轮回。
            if soul.home_tenant_id is not None and disposition.tenant_id != soul.home_tenant_id:
                return False
            if soul.current_state != SoulState.REINCARNATING:
                soul.transition_to(
                    SoulState.REINCARNATING,
                    f"Reincarnation triggered from disposition {disposition.id}"
                )
                soul.refresh_from_db()
            if soul.current_state != SoulState.REINCARNATING:
                # A terminal cosmology, or a state this move is not available from.
                return False

            # Log domain event
            from apps.events.services import EventService
            # The reincarnation record is created in complete_rebirth, log with disposition info
            EventService.log(disposition.soul, "REINCARNATION_TRIGGERED", {
                "disposition_id": str(disposition.id),
                "destination_realm": disposition.destination_realm.realm_code if disposition.destination_realm else None,
            })
            return True

    @staticmethod
    def complete_rebirth(
        soul: Soul,
        disposition: Disposition = None,
        new_identity: str = "",
        rebirth_form: str = "HUMAN",
        notes: str = "",
    ):
        """
        Complete a reincarnation cycle:
        1. Create Reincarnation record
        2. Apply ledger carryover to the soul
        3. If memory reset: clear name/description
        4. Transition soul back to ALIVE with new identity

        Raises LedgerService.RebirthNotApplicable (409) for a soul whose
        cosmology is terminal.
        """
        from django.db import transaction

        from apps.events.services import EventService
        from apps.reincarnation.models import Reincarnation

        # Gate the machinery, not only the reporting endpoint. An Egyptian
        # soul that /ledger/inheritance/ correctly refuses to answer for must
        # not still be reincarnatable through this door — Aaru and Ammit are
        # both ends of the road, and so are Heaven and Hell.
        LedgerService.assert_rebirth_capable(soul)

        # Determine target realm from disposition
        target_realm = ""
        previous_realm = ""
        if disposition and disposition.destination_realm:
            target_realm = disposition.destination_realm.realm_code
            previous_realm = disposition.destination_realm.realm_code

        with transaction.atomic():
            # THE LOCK COMES BEFORE THE COUNT. It used to be
            #
            #     cycle_count = soul.reincarnations.count() + 1
            #     with transaction.atomic():
            #         Reincarnation.objects.create(..., cycle_count=cycle_count, ...)
            #
            # -- counted outside the transaction, with no lock on the soul.
            # Measured on a PostgreSQL 16 clone of the shared box, barrier placed
            # between "both have counted" and "both have written":
            #
            #     P2 cycle_counts = {'a': 1, 'b': 1}   distinct = 1
            #
            # **Two concurrent rebirths got the same cycle number.** The
            # reincarnation history is then one cycle short and nothing in the
            # data says so. Same shape as the ledger recalculation (H11); at the
            # time `grep select_for_update apps/reincarnation apps/disposition`
            # matched nothing.
            #
            # `soul.save()` further down is a whole-row UPDATE, so it also
            # clobbers a concurrent writer's merit/demerit -- the lock covers
            # that too, which is why it wraps the whole block and not just the
            # count.
            soul = Soul.all_objects.select_for_update().get(pk=soul.pk)

            # 孟婆汤(2026-10-25):地府的灵魂要先饮过。拒绝时灵魂留在 REINCARNATING(与配额满同一条等候线)。
            if needs_soup(soul) and soul.soup_taken_at is None:
                raise SoupNotTaken()

            # Monthly quota per path (2026-10-24). The hall row is locked first so two rebirths in one hall cannot
            # both take the last place; a full path refuses and the soul stays REINCARNATING, waiting.
            if soul.tenant_id is not None:
                from apps.tenants.models import Tenant

                hall = Tenant.objects.select_for_update().get(pk=soul.tenant_id)
                limit = quota_of(hall).get(rebirth_form)
                if limit is not None:
                    used = Reincarnation.objects.filter(tenant=hall, rebirth_form=rebirth_form,
                                                        reincarnated_at__gte=_month_start()).count()
                    if used >= limit:
                        raise RebirthQuotaFull(rebirth_form, limit, used)

            # Read the carry-over BEFORE the Reincarnation row exists. The
            # ledger reads `soul.current_life_records()`, keyed on
            # `life_index` = reincarnations.count(); once the row below is
            # written that index moves on to the new, empty life and the
            # inheritance would be 20% of nothing. (The reasons this goes
            # through get_reincarnation_inheritance rather than re-deriving
            # the arithmetic are below, where the value is applied.)
            inheritance = LedgerService.get_reincarnation_inheritance(soul)
            cycle_count = soul.life_index + 1

            # Create reincarnation record
            reincarnation = Reincarnation.objects.create(
                soul=soul,
                disposition=disposition,
                target_realm=target_realm,
                rebirth_form=rebirth_form,
                cycle_count=cycle_count,
                previous_realm=previous_realm,
                new_identity=new_identity or soul.name,
                notes=notes,
                tenant=soul.tenant,
            )

            # Memory reset
            if disposition and disposition.memory_reset != "NONE":
                # Partial reset: keep birth_name, clear description
                soul.description = ""

            # Apply ledger carryover. This used to multiply soul.merit_score /
            # soul.demerit_score directly — the *denormalised* fields that
            # only recalculate_soul_ledger writes, refreshed live on every new
            # SoulRecord but otherwise only by the nightly
            # ledger.recalculate_all task. GET /ledger/inheritance/<soul_id>/
            # (get_reincarnation_inheritance) never reads those fields at
            # all; it recomputes from the soul's records every time. The two
            # bases agreed only when the denormalised fields happened to be
            # fresh, so the endpoint could report one carryover number while
            # rebirth quietly applied another.
            #
            # Calling get_reincarnation_inheritance() (above, before the
            # Reincarnation row) instead of
            # re-deriving the same arithmetic makes this the same call the
            # endpoint makes — not just the same inputs, the same function —
            # so there is no way for the two to drift again, including
            # through get_ledger_summary's 5-minute Redis cache: whichever
            # value (fresh or cached) the endpoint would hand back right now
            # is exactly the value applied here. A soul with no records at
            # all inherits 0/0, same as the endpoint would report for it.
            soul.merit_score = inheritance["inherited_merit"]
            soul.demerit_score = inheritance["inherited_demerit"]
            # ...and the same numbers as the base the next recalculation
            # starts from, so the first deed of this life adds to them
            # instead of replacing them.
            soul.inherited_merit = inheritance["inherited_merit"]
            soul.inherited_demerit = inheritance["inherited_demerit"]

            # Reset soul to ALIVE with new identity
            soul.name = new_identity or soul.name
            soul.birth_name = soul.birth_name or new_identity
            soul.death_date = None
            soul.origin_location = ""
            soul.soup_taken_at = None  # 每世一次:下一世转世前要再饮
            soul.save()
            # The cached summary describes the life that just ended.
            LedgerService._invalidate_cache(soul)

            # The return value is checked, and the check is inside the
            # `atomic()` on purpose.
            #
            # Dropped, this was the worst of the three: by the time it runs the
            # `Reincarnation` row exists, `merit_score`/`demerit_score` have
            # been overwritten with the inherited values, and `name` /
            # `death_date` / `origin_location` have been rewritten — **all in
            # this same transaction**. A refused transition raised nothing, so
            # nothing rolled back, and every one of those side effects
            # committed around a soul that never became ALIVE.
            if not soul.transition_to(
                SoulState.ALIVE, f"Rebirth complete (cycle {cycle_count})"
            ):
                raise RebirthRefusedError(
                    f"Soul {soul.pk} is {soul.current_state}; it cannot be "
                    f"reborn from there. Nothing was written."
                )

            # 上一世的灵魂账号在这里停用,**与转世同一个事务**:转世回滚,停用也回滚;
            # 转世提交,前世账号就永不可再登录。下一世的账号等下一次死亡登记再开。
            from apps.soul_accounts.services import retire_account_for_rebirth

            retire_account_for_rebirth(soul, ended_cycle=cycle_count - 1)

            # 行程拓扑:转世即离开冥界。通常执行处置时已经关了那一站;这里兜住
            # 没有经过执行就转世的路径(例如没有处置的 `complete_rebirth`)。
            from apps.realms.path import SoulPathService
            SoulPathService.leave(soul)

            EventService.log(
                soul,
                "REINCARNATION_COMPLETED",
                {
                    "reincarnation_id": str(reincarnation.id),
                    "cycle_count": cycle_count,
                    "new_identity": new_identity or soul.name,
                    "rebirth_form": rebirth_form,
                }
            )

        return reincarnation
