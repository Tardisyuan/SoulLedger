"""Channel naming for the realtime layer.

WHAT WAS HERE. `RealtimeEventPublisher`, a "backward-compatible facade" whose
five static methods each forwarded straight to `event_bus`, and which its own
docstring marked Deprecated. Excluding comments and docstrings it had **zero**
production callers and three test files; a naive `grep -rl` reported six
production files, every one of which merely mentioned it in prose explaining
the design.

It was not inert. `apps/workflow/services.py:564` records the incident it
belongs to: `RealtimeEventPublisher.publish_workflow` and
`event_bus.publish_workflow` both had no callers, workflow events never reached
`SoulEvent`, and six tests calling those functions directly stayed green the
whole time. A second, callable, equivalent way to publish is how that happens
twice — so the facade went and `event_bus` is now the only door.

Channel naming convention (unchanged):
  rt:tenant:{code}    — tenant-wide broadcast (all users in tenant)
  rt:user:{user_id}   — per-user targeted delivery
"""
import logging

logger = logging.getLogger(__name__)




class ChannelNaming:
    """
    Standardized channel naming conventions.

    Groups:
      rt_tenant_{code}   — all users in a tenant
      rt_user_{user_id}  — single user

    Note: Channel layer group names must be ASCII alphanumerics, hyphens,
    underscores, or periods (no colons allowed).
    """

    @staticmethod
    def tenant_group(tenant_code: str) -> str:
        """Channel group name for tenant-wide broadcast."""
        return f"rt_tenant_{tenant_code}"

    @staticmethod
    def user_group(user_id: int) -> str:
        """Channel group name for per-user delivery."""
        return f"rt_user_{user_id}"
