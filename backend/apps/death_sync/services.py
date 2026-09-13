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
        lookup_data = payload.get("soul_lookup", {})

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

                # Call soul.die() - the domain service handles state transition
                judgment = soul.die(
                    death_date=payload.get("death_date"),
                    location=payload.get("death_location", ""),
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
            request_record.save()
            return request_record

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
