"""
Soul core model + state machine.
"""
import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from apps.core.archive import ArchivableMixin
from apps.core.models import AuditUserFields
from apps.souls.dates import parse_historical_date, to_legacy_date
from apps.souls.querysets import SoulManager


class Civilization(models.TextChoices):
    CHINESE = "CHINESE", "Chinese Diyu"
    EUROPEAN = "EUROPEAN", "European Heaven/Hell"
    EGYPTIAN = "EGYPTIAN", "Egyptian Duat"
    # GREEK IS A FOURTH COSMOLOGY, NOT A REGION OF THE EUROPEAN ONE.
    #
    # It used to be filed under EUROPEAN, and that was never a claim anybody
    # checked: Hades, Aeacus and Rhadamanthus stood in EU_PLATO_MEADOW — Plato's
    # fork in the road, Gorgias 524a — while carrying the civilization of a
    # tenant whose other rows are the Nicene Creed's judgment and Dante's nine
    # circles. The two systems answer different questions with different
    # instruments: Dante's judgment is *poena* after *culpa* is forgiven, and
    # Plato's is a fixed term served (Republic X, 615a-b). One enum member
    # cannot carry both, and while it did, the Greek rows were reachable only
    # through the European tenant and inherited European routing, European
    # case types and the European ledger reading by default.
    #
    # WHAT DELIBERATELY DID NOT MOVE. Minos, Cerberus and Charon stay EUROPEAN,
    # because their text anchor in this repository is Dante and not the Greeks:
    # Minos allots the circle at the entrance to the second (Inf. V.4-15),
    # Cerberus stands over the gluttons in the third (Inf. VI), Charon works
    # Acheron at the gate of hell (Inf. III). Plato's Minos is a *separate row*
    # under GREEK — the two are different offices in different underworlds
    # (Gorg. 524a's final arbiter at the fork vs the coiling tail of Inf. V),
    # which is what the actor row itself has said all along.
    GREEK = "GREEK", "Greek Underworld"


# The one place tenant codes and cosmologies meet. A tenant is an
# administrative record; a civilization is a claim about what happens to the
# dead. Which tenant speaks for which cosmology is a fact about this
# deployment's configuration, so it is written down once, here, rather than
# re-derived at each call site.
TENANT_CIVILIZATION = {
    "CN_DIYU": Civilization.CHINESE,
    "EU_HEAVEN_HELL": Civilization.EUROPEAN,
    "EG_DUAT": Civilization.EGYPTIAN,
    # GREEK NEEDS ITS OWN TENANT OR IT CAN NEVER HOLD A SOUL.
    #
    # `Soul.civilization` is derived from the soul's tenant through this map and
    # from nothing else (see the property below). A GREEK enum member with no
    # tenant code pointing at it would therefore be unreachable by construction:
    # no soul could ever read GREEK, so its routing branch, its ledger reading
    # and its workflow templates would all be dead code that no test could
    # distinguish from working code.
    "GR_HADES": Civilization.GREEK,
}

# The same fact read backwards: which tenant speaks for a given cosmology.
# Derived rather than written out a second time, because the copies are what
# went wrong — this mapping existed in three more places (the Soul filterset,
# the multitenant backfill command, the seed script), each free to drift from
# the one above and from each other, and one of them defaulted an unrecognised
# civilization to the Chinese tenant. Callers that need this direction (a
# filter turning ?civilization=EGYPTIAN into a tenant lookup, a seeder deciding
# where a row belongs) import it instead of writing their own.
#
# Inverting assumes one tenant per cosmology, which is what this deployment
# configures. A second CHINESE tenant would silently lose to whichever came
# last in TENANT_CIVILIZATION — a reason to revisit the shape of both maps if
# that ever becomes a real configuration, not a reason to keep hand-written
# copies around.
CIVILIZATION_TENANT = {
    civilization: code for code, civilization in TENANT_CIVILIZATION.items()
}

# What a soul's cosmology is when nothing in the configuration says.
#
# This used to be Civilization.CHINESE — an unrecognised tenant code fell
# through to the first entry in the map. That was never a decision anyone
# made, it was the default argument of a dict lookup showing through, and it
# had a consequence nobody chose either: Chinese Diyu is the one rebirth-capable
# cosmology modelled here, so *unknown* silently meant *reborn*. A soul in a
# misconfigured or freshly created tenant was handed a next life on the
# strength of a typo. Guessing wrong about a cosmology is not a cosmetic error
# — it decides whether a soul is annihilated, admitted, or sent round again.
#
# Deliberately NOT a member of the Civilization TextChoices above. Two reasons,
# and the second is the load-bearing one:
#
#   1. "Unknown" is not a civilization. No one worships in it and nothing
#      happens to you there. It is the absence of an answer, and giving it a
#      seat alongside Diyu and the Duat would make the absence look like one
#      more afterlife on the list — in every dropdown, filter, and chart legend
#      that renders Civilization.choices.
#   2. Civilization.choices is the `choices=` argument of model fields in five
#      apps (actors, judgment, realms, workflow, souls). Adding a member
#      rewrites all five field definitions and demands an AlterField migration
#      in each — a schema change across the codebase to express "we don't
#      know", which is a large blast radius for a value no row should ever
#      legitimately store.
#
# Being a plain str keeps it safe everywhere a civilization is read as text
# (serializers, event payloads, __str__, CSV export) while failing every
# `== Civilization.X` and every `in REBIRTH_CAPABLE_CIVILIZATIONS` membership
# test — which is exactly the behaviour wanted. Unknown must not be quietly
# routed anywhere; it must fall to whatever each caller does when it does not
# recognise a cosmology.
UNKNOWN_CIVILIZATION = "UNKNOWN"


class SoulState(models.TextChoices):
    ALIVE = "ALIVE", "Alive"
    JUDGING = "JUDGING", "Under Judgment"
    DISPOSED = "DISPOSED", "Disposed"
    REINCARNATING = "REINCARNATING", "Reincarnating"
    # Where a soul stops. Only one of the cosmologies modelled here has a next
    # life: Egyptian judgment ends at Aaru or in Ammit's jaws, and European
    # (Dante) judgment ends at Heaven, Hell, or Purgatory-then-Heaven — the
    # Purgatorio empties upward, never back into a new birth. Every executed
    # disposition used to move its soul to REINCARNATING regardless, so a soul
    # admitted to the Field of Reeds was labelled as queued for a rebirth its
    # cosmology does not have. The rebirth *machinery* already refused those
    # souls (REBIRTH_CAPABLE_CIVILIZATIONS in apps/ledger/services.py); it was
    # only the label that lied, and a label that lies is what the dashboards
    # and the state filters read.
    #
    # "Settled" in the ledger sense — the account is closed — rather than
    # "at rest" or "eternal", which would be false for a soul Ammit has
    # devoured. What Aaru and the Devourer have in common is not peace; it is
    # that nothing further is owed either way.
    SETTLED = "SETTLED", "Settled (Final)"
    LOST = "LOST", "Lost/Suspended"


class Soul(ArchivableMixin, AuditUserFields, models.Model):
    """
    Core soul entity. All other records link back to a Soul.
    Civilization is now derived from tenant FK.

    Deletion (Stage 4 §4.7): a soul with no concluded judgment can still be
    soft-deleted, cascading to its karma/demerit records (SoulRecord) and any
    pending (verdict-less) judgments under one delete_cascade_id — see
    delete_with_cascade() and apps.core.recycle_bin. Once any judgment on
    this soul has a verdict, the soul is archivable instead: see
    has_concluded_judgment and ArchivableMixin.archive().
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    current_state = models.CharField(
        max_length=20,
        choices=SoulState.choices,
        default=SoulState.ALIVE,
    )
    # Historical (possibly BCE) dates, stored as signed year + optional
    # month/day rather than a DateField — see apps.souls.dates for the
    # year-0 convention. `birth_date`/`death_date` below are compatibility
    # properties, not real columns.
    birth_year = models.IntegerField(null=True, blank=True)
    birth_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    birth_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    death_year = models.IntegerField(null=True, blank=True)
    death_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    death_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    origin_location = models.CharField(max_length=255, blank=True)
    birth_name = models.CharField(max_length=255, blank=True)  # name at birth
    description = models.TextField(blank=True)

    # Karma summary (denormalised for performance, updated via signal/service)
    merit_score = models.IntegerField(default=0)
    demerit_score = models.IntegerField(default=0)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='souls',
        null=True,
    )

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Soul"
        verbose_name_plural = "Souls"
        indexes = [
            models.Index(fields=["tenant", "current_state"]),
            models.Index(fields=["current_state"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = SoulManager()

    def save(self, *args, **kwargs):
        # Set tenant from thread-local request context on first save
        is_new = self._state.adding
        if is_new and self.tenant_id is None:
            from apps.core.request_local import get_current_request
            request = get_current_request()
            if request:
                tenant = getattr(request, 'tenant', None)
                if not tenant:
                    user = getattr(request, 'user', None)
                    if user:
                        tenant = getattr(user, 'tenant', None)
                if tenant:
                    self.tenant = tenant

        # Enforce tenant requirement on creation
        if is_new and self.tenant_id is None:
            from django.core.exceptions import ValidationError
            raise ValidationError("Tenant is required when creating a Soul.")

        super().save(*args, **kwargs)

        # Log SOUL_CREATED event after first save (not on updates)
        if is_new:
            from apps.events.services import EventService
            EventService.log_soul_created(self)

    def __str__(self):
        return f"{self.name} ({self.civilization}) [{self.current_state}]"

    @property
    def civilization(self) -> str:
        """Derive civilization from tenant code.

        Returns UNKNOWN_CIVILIZATION — not a Civilization member — when the
        tenant is missing or its code is not in TENANT_CIVILIZATION. See that
        constant for why an unrecognised tenant must not resolve to Chinese
        Diyu, and why "unknown" is not itself one of the choices.
        """
        if self.tenant_id is None:
            return UNKNOWN_CIVILIZATION
        return TENANT_CIVILIZATION.get(self.tenant.code, UNKNOWN_CIVILIZATION)

    @property
    def karmic_balance(self) -> int:
        return self.merit_score - self.demerit_score

    @property
    def has_concluded_judgment(self) -> bool:
        """True once any judgment on this soul carries a verdict.

        Stage 4 §4.7: this is the gate between "soft-deletable" and
        "archivable instead" for a soul — not current_state, and not
        is_final, because a verdict can exist before a judgment is marked
        final. A soul with only pending (verdict-less) judgments is still
        an ordinary soft delete.
        """
        return self.judgments.filter(verdict__isnull=False).exists()

    def delete_with_cascade(self, user=None, reason=""):
        """Soft-delete this soul and cascade to its dependent karma/demerit
        records and pending judgments, all under one delete_cascade_id —
        see apps.core.recycle_bin.cascade_soft_delete. Refuses (raises
        DeletionNotAllowedError) once the soul has a concluded judgment; call
        archive() instead in that case.

        Only SoulRecord and pending Judgment rows are cascaded — the two
        dependent types the design doc names explicitly. Other soul-linked
        records (dispatch history, workflow approvals, ...) are not cascaded
        here; they would need the same treatment in a later pass.
        """
        from apps.core.archive import DeletionNotAllowedError
        from apps.core.recycle_bin import cascade_soft_delete
        from apps.judgment.models import Judgment
        from apps.souls.record_models import SoulRecord

        if self.has_concluded_judgment:
            raise DeletionNotAllowedError(
                "This soul has a concluded judgment and cannot be deleted. "
                "Archive it instead.",
                archivable=True,
            )

        dependents = list(SoulRecord.objects.filter(soul=self)) + list(
            Judgment.objects.filter(soul=self, verdict__isnull=True)
        )
        return cascade_soft_delete(self, dependents, user=user, reason=reason)

    # ------------------------------------------------------------------
    # Legacy DateField-shaped accessors, kept for callers outside this
    # app (death_sync webhook payloads, reincarnation reset, event
    # logging, and most of the existing test suite) that still read or
    # assign `soul.birth_date` / `soul.death_date` as a plain date.
    # These are NOT stored columns — birth_year/month/day are the only
    # source of truth. The getter can only represent CE dates with full
    # month/day precision; BCE or year-only records read back as None
    # here (use birth_year/birth_month/birth_day directly for those).
    # ------------------------------------------------------------------
    @property
    def birth_date(self):
        return to_legacy_date(self.birth_year, self.birth_month, self.birth_day)

    @birth_date.setter
    def birth_date(self, value):
        self.birth_year, self.birth_month, self.birth_day = parse_historical_date(value)

    @property
    def death_date(self):
        return to_legacy_date(self.death_year, self.death_month, self.death_day)

    @death_date.setter
    def death_date(self, value):
        self.death_year, self.death_month, self.death_day = parse_historical_date(value)

    def can_transition_to(self, new_state: str) -> bool:
        """
        State machine guard. Returns True if the transition is valid.
        """
        valid_transitions = {
            SoulState.ALIVE: [SoulState.JUDGING],
            SoulState.JUDGING: [SoulState.DISPOSED],
            # A disposed soul goes one of three ways: back round the wheel, to
            # a final destination its cosmology has no exit from, or missing.
            # Which of the first two is not a choice — see
            # DispositionService.execute.
            SoulState.DISPOSED: [
                SoulState.REINCARNATING,
                SoulState.SETTLED,
                SoulState.LOST,
            ],
            SoulState.REINCARNATING: [SoulState.ALIVE],
            # SETTLED is absorbing, and deliberately does not keep LOST
            # reachable the way DISPOSED does. LOST means the disposition was
            # never carried through and the soul went missing on the way to
            # its realm — something that can only happen in transit. Once a
            # soul is in Aaru, or in Ammit, or in the Empyrean, there is no
            # transit left to fail; mislaying the *record* afterwards is a
            # bookkeeping problem, not a change in what became of the soul.
            # Letting an administrative mistake re-open a cosmologically closed
            # case is exactly the lie this state exists to stop telling.
            SoulState.SETTLED: [],
            SoulState.LOST: [],
        }
        return new_state in valid_transitions.get(self.current_state, [])

    def transition_to(self, new_state: str, reason: str = "", **kwargs) -> bool:
        """
        Attempt state transition with pessimistic locking to prevent race conditions.
        Returns True if successful.
        """
        from django.db import transaction

        from apps.events.services import log_soul_state_change

        with transaction.atomic():
            # Lock the row to prevent concurrent state mutations
            locked_soul = Soul.objects.select_for_update().get(pk=self.pk)
            if not locked_soul.can_transition_to(new_state):
                return False

            old_state = locked_soul.current_state
            locked_soul.current_state = new_state

            if new_state == SoulState.JUDGING and not locked_soul.death_date:
                from django.utils import timezone as tz
                locked_soul.death_date = tz.now().date()

            # Apply any extra field updates (e.g. death_date, origin_location from die())
            for field, value in kwargs.items():
                if hasattr(locked_soul, field):
                    setattr(locked_soul, field, value)

            locked_soul.save()

        # Log outside the transaction to avoid holding locks during external calls
        log_soul_state_change(locked_soul, old_state, new_state, reason)
        # Sync back to self instance. Copy the raw year/month/day (not via
        # the birth_date/death_date properties) so a BCE death date isn't
        # silently dropped — the legacy property getter returns None for
        # anything it can't express as a datetime.date.
        self.current_state = locked_soul.current_state
        self.death_year = locked_soul.death_year
        self.death_month = locked_soul.death_month
        self.death_day = locked_soul.death_day
        return True

    def correct_settlement(self, user=None, reason: str = "") -> bool:
        """Revert a SETTLED soul to DISPOSED to fix a data-entry error.

        Deliberately does not go through transition_to/can_transition_to —
        SoulState.SETTLED has no valid_transitions by design (see the
        comment there on why re-opening a cosmologically closed case must
        never look like an ordinary transition). This is a correction, not
        a transition: ADMIN-only (enforced by the view's permission
        codename, not here), requires a reason, and is logged as its own
        SETTLEMENT_CORRECTED event so the lifecycle timeline never renders
        it as if the soul walked DISPOSED->SETTLED backwards. Reverts to
        DISPOSED rather than clearing to ALIVE/JUDGING, since only the
        settlement itself was in error — the judgment and disposition that
        led to it are untouched, and normal machinery can re-run from
        DISPOSED once the record is fixed.
        """
        from django.db import transaction

        if not reason:
            raise ValueError("A reason is required to correct a settlement.")

        with transaction.atomic():
            locked_soul = Soul.objects.select_for_update().get(pk=self.pk)
            if locked_soul.current_state != SoulState.SETTLED:
                raise ValueError("Only a SETTLED soul can have its settlement corrected.")

            old_state = locked_soul.current_state
            locked_soul.current_state = SoulState.DISPOSED
            locked_soul.save()

        from apps.events.services import EventService
        EventService.log_settlement_corrected(
            locked_soul, old_state, SoulState.DISPOSED, reason,
            actor=getattr(user, "username", "system") if user else "system",
        )
        self.current_state = locked_soul.current_state
        return True

    def die(self, death_date=None, location: str = "") -> "Judgment | None":
        """Mark soul as dead, transition to JUDGING, and create a Judgment record."""
        from django.db import transaction

        if self.current_state != SoulState.ALIVE:
            return None

        with transaction.atomic():
            result = self.transition_to(
                SoulState.JUDGING,
                "Death recorded, judgment initiated",
                death_date=death_date or timezone.now().date(),
                **({"origin_location": location} if location else {}),
            )
            if not result:
                return None

            from apps.judgment.models import Judgment, JudgmentMethod

            method_map = {
                Civilization.CHINESE: JudgmentMethod.STANDARD,
                Civilization.EUROPEAN: JudgmentMethod.STANDARD,
                Civilization.EGYPTIAN: JudgmentMethod.HEART_WEIGHING,
            }
            judgment = Judgment.objects.create(
                soul=self,
                civilization=self.civilization,
                tenant=self.tenant,
                judgment_method=method_map.get(self.civilization, JudgmentMethod.STANDARD),
            )
            return judgment
