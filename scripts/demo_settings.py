"""Settings for recording the demo (scripts/demo-backend-up.sh). The demo's administrator signs in with one click, so
recording it must not stop at the two-step setup screen; and a sweep of every GET would otherwise be throttled into
recording almost nothing. Nothing else differs from config.settings."""
from config.settings import *  # noqa: F403

MFA_SETUP_ENFORCED = False
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {k: "1000000/minute" for k in REST_FRAMEWORK.get("DEFAULT_THROTTLE_RATES", {})},  # noqa: F405
}


def _no_decay(**_):
    """The running server reads the ledgers too; it must agree with the seed (see `main` in demo-seed.py)."""
    from apps.ledger import services

    for civ in list(services.CIVILIZATION_DECAY_RATE):
        services.CIVILIZATION_DECAY_RATE[civ] = 0.0


from django.core.signals import request_started  # noqa: E402

request_started.connect(_no_decay)
