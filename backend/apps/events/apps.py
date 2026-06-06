from django.apps import AppConfig


class EventsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.events"
    verbose_name = "Events"

    def ready(self) -> None:
        from apps.events.event_bus import configure_default_handlers
        configure_default_handlers()
