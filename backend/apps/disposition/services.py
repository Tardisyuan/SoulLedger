"""
Disposition service — creates disposition from judgment verdict.
"""
from apps.judgment.models import Judgment
from apps.disposition.models import Disposition
from apps.realms.models import Realm


class DispositionService:
    """
    Handles disposition creation and execution.
    """

    CHINESE_REALM_MAP = {
        "PASSED": "DY_01_HEAVEN",
        "FAILED": "DY_10_YAMA",
        "PURGATORY": "DY_00_PURGATORY",
        "RETRY": "DY_00_PURGATORY",
    }

    @staticmethod
    def create_from_judgment(judgment: Judgment) -> Disposition:
        """
        Create a disposition based on judgment verdict.
        Maps verdict to destination realm.
        """
        realm_code = DispositionService.CHINESE_REALM_MAP.get(
            judgment.verdict,
            "DY_00_PURGATORY",
        )
        realm = Realm.objects.filter(realm_code=realm_code).first()

        disposition = Disposition.objects.create(
            soul=judgment.soul,
            judgment=judgment,
            destination_realm=realm,
            is_eternal=(realm.is_eternal if realm else False),
            notes=f"Auto-created from judgment {judgment.id}",
        )

        from apps.events.services import log_disposition_created
        log_disposition_created(disposition)

        return disposition

    @staticmethod
    def execute(disposition: Disposition) -> bool:
        """
        Mark disposition as executed, trigger reincarnation.
        """
        from django.utils import timezone
        from apps.souls.models import SoulState

        disposition.is_executed = True
        disposition.executed_at = timezone.now()
        disposition.save()

        disposition.soul.transition_to(SoulState.REINCARNATING, "Disposition executed")
        return True
