"""
Death Sync Service — core business logic for external death registration.
"""
import logging
import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.death_sync.models import (
    DeathRegistrationRequest,
    DeathRegistrationStatus,
)
from apps.souls.dates import parse_historical_date
from apps.souls.models import Soul, SoulState

logger = logging.getLogger(__name__)


class RetryRefusedError(Exception):
    """A registration that may not be retried; `code` goes on the 409."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class DeathSyncService:
    """
    Core service for processing inbound death registrations.
    Follows the same service-layer pattern as DispatchService.
    """

    @staticmethod
    def lookup_soul(tenant, lookup_data):
        """
        Find a soul by soul_id or by name+birth_date+tenant.

        Args:
            tenant: The tenant to search within
            lookup_data: Dict with soul_id or name/birth_date/civilization

        Returns:
            Soul instance or None

        Raises:
            ValueError: If lookup criteria are invalid
        """
        soul_id = lookup_data.get("soul_id")
        if soul_id:
            return Soul.objects.filter(id=soul_id, tenant=tenant).first()

        name = lookup_data.get("name")
        if not name:
            raise ValueError("Must provide soul_id or name in soul_lookup")

        queryset = Soul.objects.filter(name=name, tenant=tenant)
        birth_date = lookup_data.get("birth_date")
        if birth_date:
            # Soul.birth_date is no longer a queryable DateField — it's
            # decomposed into birth_year/birth_month/birth_day (BCE-capable,
            # see apps.souls.dates). Still accepts the same "YYYY-MM-DD"
            # string external systems have always sent here.
            year, month, day = parse_historical_date(birth_date)
            date_filters = {}
            if year is not None:
                date_filters["birth_year"] = year
            if month is not None:
                date_filters["birth_month"] = month
            if day is not None:
                date_filters["birth_day"] = day
            queryset = queryset.filter(**date_filters)

        return queryset.first()

    @staticmethod
    def register_death(tenant, api_key, payload, idempotency_key, source_ip=None):
        """
        Process a single death registration.

        1. Check idempotency
        2. Look up the Soul
        3. Call soul.die()
        4. Create DeathRegistrationRequest record
        5. Return result

        Args:
            tenant: The tenant for this registration
            api_key: The ExternalApiKey used
            payload: The validated request payload
            idempotency_key: Client-provided idempotency key
            source_ip: Client IP address

        Returns:
            DeathRegistrationRequest instance

        Raises:
            IntegrityError: On duplicate idempotency_key. Re-raised on purpose:
                the caller owns the answer (the single view turns it into a
                409 with the existing row, process_batch returns that row).
        """
        start_time = timezone.now()

        # Create request record (for idempotency tracking)
        request_record = DeathRegistrationRequest(
            tenant=tenant,
            api_key=api_key,
            idempotency_key=idempotency_key,
            source_system=api_key.system_type,
            source_reference_id=payload.get("source_reference", ""),
            source_payload=payload,
            source_ip=source_ip,
            status=DeathRegistrationStatus.PENDING,
        )

        return DeathSyncService._process(request_record, tenant, payload, start_time)

    @staticmethod
    def _process(request_record, tenant, payload, start_time):
        """Look the soul up, call die(), and record the outcome on `request_record`.

        Shared by `register_death` (a new, unsaved row) and `retry_failed`
        (an existing FAILED row, already locked by the caller).
        """
        lookup_data = payload.get("soul_lookup", {})

        # The `except` used to sit INSIDE the atomic block. After the first
        # save() hit uniq_death_reg_idempotency the handler saved the same
        # row again inside a transaction Django had already marked broken,
        # which raises TransactionManagementError -- so a replayed key was a
        # 500 on the single path (the view's `except IntegrityError` never
        # saw an IntegrityError) and a 500 on the batch path (process_batch
        # then saved a third row under the same key). The atomic block now
        # covers only the work, and the failure row is written after it has
        # rolled back; a duplicate key is left to the caller.
        try:
            with transaction.atomic():
                # 停用的殿不收新的死亡登记(2026-10-25 用户决定);数据都留着。重试同样被拒。
                if not tenant.is_active:
                    request_record.status = DeathRegistrationStatus.FAILED
                    request_record.error_code = "HALL_INACTIVE"
                    request_record.error_message = "This hall is deactivated and accepts no new registrations"
                    request_record.save()
                    return request_record
                soul = DeathSyncService.lookup_soul(tenant, lookup_data)
                if soul is None:
                    request_record.status = DeathRegistrationStatus.FAILED
                    request_record.error_code = "SOUL_NOT_FOUND"
                    request_record.error_message = "No soul found matching the provided lookup criteria"
                    request_record.save()
                    return request_record

                if soul.current_state != SoulState.ALIVE:
                    request_record.status = DeathRegistrationStatus.FAILED
                    request_record.error_code = "SOUL_NOT_ALIVE"
                    request_record.error_message = f"Soul is already in state: {soul.current_state}"
                    request_record.soul = soul
                    request_record.save()
                    return request_record

                # 联系方式先落库:开号发生在 die() 的状态转换里,投递渠道在那一刻选。
                from apps.soul_accounts.services import apply_contacts

                apply_contacts(soul, payload.get("contact_email", ""), payload.get("contact_phone", ""))

                # Call soul.die() - the domain service handles state transition
                judgment = soul.die(
                    death_date=payload.get("death_date"),
                    location=payload.get("death_location", ""),
                    account_origin="DEATH_SYNC",
                )

                if judgment is None:
                    request_record.status = DeathRegistrationStatus.FAILED
                    request_record.error_code = "INVALID_TRANSITION"
                    request_record.error_message = "State machine rejected the transition"
                    request_record.soul = soul
                    request_record.save()
                    return request_record

                request_record.status = DeathRegistrationStatus.PROCESSED
                request_record.soul = soul
                request_record.judgment = judgment
                request_record.processing_duration_ms = int(
                    (timezone.now() - start_time).total_seconds() * 1000
                )
                request_record.save()
                # BD-11: the only thing that ever tells the tenant's webhooks.
                # Published inside the transaction on purpose: the EventBus
                # webhook handler writes the delivery row here and enqueues it
                # once the transaction is committed, so a rolled-back
                # registration announces nothing.
                from apps.events.event_bus import event_bus

                event_bus.publish_deathsync(
                    "DEATH_SYNC_PROCESSED",
                    {
                        "registration_id": str(request_record.id),
                        "soul_id": str(soul.id),
                        "judgment_id": str(judgment.id),
                        "source_system": request_record.source_system,
                        "source_reference_id": request_record.source_reference_id,
                    },
                    tenant_code=tenant.code,
                )
                return request_record

        except IntegrityError:
            raise
        except Exception as e:
            logger.exception(f"Death registration failed: {e}")
            request_record.status = DeathRegistrationStatus.FAILED
            request_record.error_code = "INTERNAL_ERROR"
            request_record.error_message = str(e)
            # die() may have set this before the failure; its row was rolled
            # back with the atomic block, so keeping the id would point at nothing.
            request_record.judgment = None
            request_record.save()
            return request_record

    @staticmethod
    def retry_failed(registration_id, tenant):
        """Rerun a FAILED registration on its own row (admin action, W-12).

        `register_death` cannot be called again: it inserts a new row, and the
        idempotency key belongs to this one. The stored payload goes back
        through the create serializer, because it was stored as JSON and
        `death_date` has to be a date again.

        Only INTERNAL_ERROR is retried (user decision 2026-10-16): the other
        reasons (SOUL_NOT_FOUND, SOUL_NOT_ALIVE, INVALID_TRANSITION, ...) are
        answers about the data, and running it again gives the same answer.

        Raises:
            RetryRefusedError: with `code`, when the row may not be retried.
        """
        from apps.death_sync.serializers import DeathRegistrationCreateSerializer

        start_time = timezone.now()
        with transaction.atomic():
            # The lock is what stops two clicks from both running die(): the
            # second waits here and then sees status != FAILED. SQLite ignores
            # select_for_update, so no SQLite test can show this.
            record = DeathRegistrationRequest.objects.select_for_update().get(
                pk=registration_id, tenant=tenant
            )
            if record.status != DeathRegistrationStatus.FAILED:
                raise RetryRefusedError("NOT_FAILED")
            if record.error_code != "INTERNAL_ERROR":
                raise RetryRefusedError("NOT_RETRYABLE")
            if record.retry_count >= record.max_retries:
                raise RetryRefusedError("MAX_RETRIES")

            record.retry_count += 1
            record.error_code = ""
            record.error_message = ""
            serializer = DeathRegistrationCreateSerializer(data=record.source_payload or {})
            if not serializer.is_valid():
                record.status = DeathRegistrationStatus.FAILED
                record.error_code = "VALIDATION_ERROR"
                record.error_message = str(serializer.errors)
                record.save()
                return record
            # The inner atomic in _process is a savepoint here: a failure
            # rolls back die() and keeps the lock and the retry_count bump.
            return DeathSyncService._process(record, tenant, serializer.validated_data, start_time)

    @staticmethod
    def process_batch(tenant, api_key, registrations, source_ip=None):
        """
        Process a batch of death registrations.

        Every item goes through DeathRegistrationCreateSerializer, the same
        gate the single endpoint applies; the batch path used to skip it.

        Args:
            tenant: The tenant for this batch
            api_key: The ExternalApiKey used
            registrations: List of registration payloads
            source_ip: Client IP address

        Returns:
            List of DeathRegistrationRequest instances, one per item, in order.
            A client-supplied key that already owns a row yields that row.
        """
        from apps.death_sync.serializers import DeathRegistrationCreateSerializer

        # One nonce per call. The default key used to be batch_{key}_{idx},
        # identical for item 0 of every batch this API key ever sent, so the
        # second keyless batch collided with the first on
        # uniq_death_reg_idempotency -- every time.
        nonce = uuid.uuid4().hex
        results = []
        for idx, reg in enumerate(registrations):
            payload = reg if isinstance(reg, dict) else {}
            idempotency_key = payload.get("idempotency_key") or f"batch_{api_key.id}_{nonce}_{idx}"
            try:
                serializer = DeathRegistrationCreateSerializer(data=payload)
                if serializer.is_valid():
                    result = DeathSyncService.register_death(
                        tenant=tenant,
                        api_key=api_key,
                        payload=serializer.validated_data,
                        idempotency_key=idempotency_key,
                        source_ip=source_ip,
                    )
                else:
                    result = DeathRegistrationRequest(
                        tenant=tenant,
                        api_key=api_key,
                        idempotency_key=idempotency_key,
                        source_system=api_key.system_type,
                        source_payload=payload,
                        source_ip=source_ip,
                        status=DeathRegistrationStatus.FAILED,
                        error_code="VALIDATION_ERROR",
                        error_message=str(serializer.errors),
                    )
                    result.save()
            except IntegrityError:
                # Same answer the single path gives as a 409: the row that
                # owns the key. Tenant-scoped, so another tenant's row with
                # the same key is not handed back.
                result = DeathRegistrationRequest.objects.filter(
                    tenant=tenant,
                    source_system=api_key.system_type,
                    idempotency_key=idempotency_key,
                ).first()
                if result is None:
                    raise
            results.append(result)
        return results


#: 外部系统能看到的进度阶段(2026-10-25 用户决定):粗粒度,没有裁决、批语、经办人。
PROGRESS_STAGES = ("registered", "at_city_god", "judging", "sentenced", "reincarnated", "settled")


def progress_of(registration) -> dict:
    """一条死亡登记对应的灵魂**此刻**走到哪一步。只看灵魂状态与这条登记开的那件审判在不在城隍处。

    reincarnated:灵魂已转入下一世(本世序号大于那件审判的世)—— 之后的事不再属于这条登记;
    settled:终局(SETTLED);sentenced:已判、在受刑或候转世(DISPOSED / REINCARNATING);
    at_city_god / judging:审判中,前者是还在城隍初审;其余(登记失败、没找到灵魂、LOST)都是 registered。
    """
    from apps.death_sync.models import DeathRegistrationStatus
    from apps.judgment.models import AT_CITY_GOD

    soul, judgment = registration.soul, registration.judgment
    stage = "registered"
    if registration.status == DeathRegistrationStatus.PROCESSED and soul is not None:
        if judgment is not None and soul.life_index > judgment.cycle:
            stage = "reincarnated"
        elif soul.current_state == SoulState.SETTLED:
            stage = "settled"
        elif soul.current_state in (SoulState.DISPOSED, SoulState.REINCARNATING):
            stage = "sentenced"
        elif soul.current_state == SoulState.JUDGING:
            stage = "at_city_god" if judgment is not None and judgment.city_god_status in AT_CITY_GOD else "judging"
    return {
        "registration_id": str(registration.pk),
        "registration_status": registration.status,
        "soul_id": str(soul.pk) if soul is not None else None,
        "soul_state": soul.current_state if soul is not None else None,
        "stage": stage,
    }
