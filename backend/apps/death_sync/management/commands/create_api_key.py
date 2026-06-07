"""
Management command to create API keys for external systems.
"""
from django.core.management.base import BaseCommand

from apps.death_sync.models import ExternalApiKey
from apps.tenants.models import Tenant


class Command(BaseCommand):
    help = "Create an API key for external death sync integration"

    def add_arguments(self, parser):
        parser.add_argument("name", type=str, help="Human-readable name for the API key")
        parser.add_argument("--tenant", type=str, required=True, help="Tenant code (e.g., CN_DIYU)")
        parser.add_argument("--system-type", type=str, default="CUSTOM",
                          choices=["GOVERNMENT", "HOSPITAL", "POLICE", "MESSAGE_BUS", "CUSTOM"],
                          help="Type of external system")
        parser.add_argument("--expires-days", type=int, default=None,
                          help="Number of days until key expires (default: never)")

    def handle(self, *args, **options):
        from datetime import timedelta

        from django.utils import timezone

        name = options["name"]
        tenant_code = options["tenant"]
        system_type = options["system_type"]
        expires_days = options["expires_days"]

        # Get tenant
        try:
            tenant = Tenant.objects.get(code=tenant_code)
        except Tenant.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"Tenant '{tenant_code}' not found"))
            return

        # Generate key
        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()

        # Calculate expiry
        expires_at = None
        if expires_days:
            expires_at = timezone.now() + timedelta(days=expires_days)

        # Create the API key
        ExternalApiKey.objects.create(
            tenant=tenant,
            name=name,
            system_type=system_type,
            key_hash=key_hash,
            key_prefix=key_prefix,
            expires_at=expires_at,
        )

        # Display the raw key (only shown once!)
        self.stdout.write(self.style.SUCCESS("\nAPI Key created successfully!"))
        self.stdout.write(f"  Name: {name}")
        self.stdout.write(f"  Tenant: {tenant_code}")
        self.stdout.write(f"  System Type: {system_type}")
        self.stdout.write(f"  Key Prefix: {key_prefix}...")
        self.stdout.write(f"  Expires: {expires_at or 'Never'}")
        self.stdout.write(f"\n{self.style.WARNING('IMPORTANT: Copy the key below. It will NOT be shown again!')}")
        self.stdout.write(f"\n  {self.style.SUCCESS(raw_key)}")
