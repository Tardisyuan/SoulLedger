from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm as BaseUserChangeForm

from .models import User


class UserChangeForm(BaseUserChangeForm):
    """Django admin is a write path for `email` like any other (BP-04).

    The API serializers refuse an address another account already holds,
    because a duplicate silently disables the other account's password reset
    (`reset_password_request` issues a code only when exactly one account
    holds the address, and answers 200 either way). The admin change form had
    no such check — so the one screen whose users can edit *anybody's* record
    was the one place the rule did not apply.
    """

    def clean_email(self):
        from .serializers import email_already_registered

        email = self.cleaned_data.get("email")
        if email_already_registered(email, exclude_pk=self.instance.pk):
            raise forms.ValidationError("该邮箱已被注册")
        return email


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    form = UserChangeForm
    list_display = ["username", "email", "role", "is_active", "is_staff"]
    list_filter = ["role", "is_active", "is_staff"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("SoulLedger", {"fields": ("role", "actor")}),
    )
