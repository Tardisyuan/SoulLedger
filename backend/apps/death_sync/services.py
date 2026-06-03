"""
Death Sync Service — core business logic for external death registration.
"""
import logging
from django.db import transaction
from django.utils import timezone
from apps.death_sync.models import (
    ExternalApiKey, DeathRegistrationRequest, DeathRegistrationStatus,
)
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
            queryset = queryset.filter(birth_date=birth_date)

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
            ValueError: On invalid payload or soul lookup failure
            IntegrityError: On duplicate idempotency_key (caught and returned as 409)
        """
        with transaction.atomic():
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

            try:
                # Lookup soul
                soul = DeathSyncService.lookup_soul(tenant, lookup_data)
                if soul is None:
                    request_record.status = DeathRegistrationStatus.FAILED
                    request_record.error_code = "SOUL_NOT_FOUND"
                    request_record.error_message = "No soul found matching the provided lookup criteria"
                    request_record.save()
                    return request_record

                # Check soul state
                if soul.current_state != SoulState.ALIVE:
                    request_record.status = DeathRegistrationStatus.FAILED
                    request_record.error_code = "SOUL_NOT_ALIVE"
                    request_record.error_message = f"Soul is already in state: {soul.current_state}"
                    request_record.soul = soul
                    request_record.save()
                    return request_record

                # Call soul.die() - the domain service handles state transition
                death_date = payload.get("death_date")
                death_location = payload.get("death_location", "")

                judgment = soul.die(
                    death_date=death_date,
                    location=death_location,
                )

                if judgment is None:
                    request_record.status = DeathRegistrationStatus.FAILED
                    request_record.error_code = "INVALID_TRANSITION"
                    request_record.error_message = "State machine rejected the transition"
                    request_record.soul = soul
                    request_record.save()
                    return request_record

                # Success
                request_record.status = DeathRegistrationStatus.PROCESSED
                request_record.soul = soul
                request_record.judgment = judgment
                request_record.processing_duration_ms = int(
                    (timezone.now() - start_time).total_seconds() * 1000
                )
                request_record.save()

                return request_record

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

        Args:
            tenant: The tenant for this batch
            api_key: The ExternalApiKey used
            registrations: List of registration payloads
            source_ip: Client IP address

        Returns:
            List of DeathRegistrationRequest instances
        """
        results = []
        for idx, reg in enumerate(registrations):
            idempotency_key = reg.get("idempotency_key", f"batch_{api_key.id}_{idx}")
            try:
                result = DeathSyncService.register_death(
                    tenant=tenant,
                    api_key=api_key,
                    payload=reg,
                    idempotency_key=idempotency_key,
                    source_ip=source_ip,
                )
                results.append(result)
            except Exception as e:
                logger.exception(f"Batch item {idx} failed: {e}")
                failed_record = DeathRegistrationRequest(
                    tenant=tenant,
                    api_key=api_key,
                    idempotency_key=idempotency_key,
                    source_system=api_key.system_type,
                    source_payload=reg,
                    status=DeathRegistrationStatus.FAILED,
                    error_code="INTERNAL_ERROR",
                    error_message=str(e),
                )
                failed_record.save()
                results.append(failed_record)
        return results
