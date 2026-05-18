"""
Django signals for Soul app.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.souls.models import Soul


# Soul tenant-setting and event logging are now handled directly in Soul.save().
# This file is kept for future per-soul signal handlers if needed.
