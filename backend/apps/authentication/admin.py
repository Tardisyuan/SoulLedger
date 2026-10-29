from django import forms
from django.contrib import admin
from django.contrib.admin.utils import unquote
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm as BaseUserChangeForm
from django.db import transaction

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

    #: Changing any of these through the admin ends the user's sessions, as the API does (L-11):
    #: refresh tokens blacklisted, `session_version` bumped, devices signed out, push registrations dropped.
    SESSION_ENDING_FIELDS = {"role", "is_active", "password", "extra_roles", "tenant"}

    def save_model(self, request, obj, form, change):
        with transaction.atomic():
            super().save_model(request, obj, form, change)
            if change and self.SESSION_ENDING_FIELDS & set(form.changed_data):
                _end_sessions(obj)

    def user_change_password(self, request, id, form_url=""):  # noqa: A002 -- Django's own parameter name
        response = super().user_change_password(request, id, form_url)
        if request.method == "POST" and response.status_code == 302:  # the form saved and redirected
            user = self.get_object(request, unquote(id))
            if user is not None:
                with transaction.atomic():
                    _end_sessions(user)
        return response


def _end_sessions(user):
    from .passwords import end_push_registrations, end_sessions

    end_sessions(user)
    end_push_registrations(user)
