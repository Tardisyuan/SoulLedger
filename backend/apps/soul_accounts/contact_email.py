"""灵魂自己改联系邮箱(Design 第四十批 S-b)。

    GET  /me/contact-email/           打码的邮箱(前两位 + *** + 完整域名)、本殿是否允许自己改、要不要两步验证
    POST /me/contact-email/verify/    当前密码(开了两步验证再加 6 位数字)→ 10 分钟内可以填新邮箱
    POST /me/contact-email/           新邮箱 → 验证码发到**新**邮箱(5 分钟)
    POST /me/contact-email/confirm/   验证码 → 改好,同时给**旧**邮箱发一封「联系邮箱已改」

不验证旧邮箱:要改邮箱的人常常就是旧邮箱用不了了(Design)。验证码与次数照邮箱重置(`apps/authentication/
views.py::reset_password_request`)的同一组上限:5 分钟内最多发 3 次,一个码最多试 5 次,第 5 次错了码作废。
状态都在缓存里,按账号分键;不落库。

本殿不允许自己改(`Tenant.settings["soul_contact_email_self_service"] is False`,看**原属**殿 —— 账号归原属殿管)
时,**开始**这一步(验密码)答 403 `email_in_person`;已经验过密码、已经发出验证码的,照常往下走
(关开关不打断在途的改动,2026-10-17)。开始之后的两步(填新邮箱、确认验证码)不再看开关,App 写「要改联系邮箱，请到本殿，带上交付单。」
地址被别的账号占着(`User.email` 在未删除的行里唯一):确认那一步答 409 `email_taken` —— 到这一步的人已经证明
收得到这个邮箱的信,告诉他「被占了」不是一个探测口。
"""
import logging
import secrets

from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.authentication.views import (
    MAX_RESET_CODE_ATTEMPTS,
    MAX_RESET_REQUESTS_PER_ADDRESS,
    RESET_REQUEST_WINDOW_SECONDS,
)
from apps.soul_accounts import mfa
from apps.soul_accounts import services as svc
from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_accounts.mfa_views import _refuse_outcome, confirm_current_password
from apps.tenants.models import SELF_SERVICE_SETTING  # 写入端 TenantSettingsSerializer 用同一个常量

logger = logging.getLogger(__name__)

PROOF_SECONDS = 600
CODE_SECONDS = 300


def mask(value):
    """前两位 + *** + 完整域名(Design S-b)。不到两位的本地部分照样只露它有的那些。"""
    if not value or "@" not in value:
        return ""
    local, domain = value.split("@", 1)
    return f"{local[:2]}***@{domain}"


def self_service(account):
    tenant = account.soul.home_tenant or account.soul.tenant
    return (getattr(tenant, "settings", None) or {}).get(SELF_SERVICE_SETTING) is not False


def _keys(account):
    base = f"soul_email_change:{account.pk}"
    return {"proof": f"{base}:proof", "code": f"{base}:code", "tries": f"{base}:tries", "sent": f"{base}:sent"}


def _bump(key, timeout):
    """原子加一(Redis 上是);两步之间键刚好过期时从 1 重新数。"""
    cache.add(key, 0, timeout=timeout)
    try:
        return cache.incr(key)
    except ValueError:
        cache.add(key, 1, timeout=timeout)
        return 1


def _refuse(code, http_status, detail, **extra):
    return Response({"detail": detail, "code": code, **extra}, status=http_status)


def _in_person():
    return _refuse("email_in_person", status.HTTP_403_FORBIDDEN, "本殿不允许自己改联系邮箱,请到殿里办理。")


class ContactEmailStatusSerializer(serializers.Serializer):
    email_masked = serializers.CharField(help_text="打码的联系邮箱;没有登记时为空串")
    can_change = serializers.BooleanField(help_text="本殿是否允许灵魂自己改")
    mfa_enabled = serializers.BooleanField(help_text="改之前要不要再输 6 位数字")


class ContactEmailVerifySerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False)
    code = serializers.CharField(required=False, allow_blank=True, max_length=6)


class ContactEmailStartSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class ContactEmailSentSerializer(serializers.Serializer):
    sent_to = serializers.EmailField()


class ContactEmailConfirmSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=6)


class ContactEmailRefusalSerializer(serializers.Serializer):
    """`code` ∈ email_in_person / wrong_password / rate_limited / mfa_required / wrong / expired / locked /
    proof_required / email_unchanged / reset_code_expired / reset_code_wrong / reset_code_attempts_exceeded / email_taken。"""
    detail = serializers.CharField()
    code = serializers.CharField()


REFUSALS = {400: ContactEmailRefusalSerializer, 403: ContactEmailRefusalSerializer,
            409: ContactEmailRefusalSerializer, 429: ContactEmailRefusalSerializer}


def status_of(account):
    return {"email_masked": mask(account.soul.contact_email), "can_change": self_service(account),
            "mfa_enabled": mfa.is_enabled(account)}


def _send(subject_kind, to, account, *, code=None, email=None):
    from apps.authentication.mail import fill, mail_locale, pack, send_neutral_mail

    locale = mail_locale(account.soul)
    if code is not None:
        title, reset = pack(locale, subject_kind)["title"], pack(locale, "reset_code")
        send_neutral_mail(f"SoulLedger {title}", fill(reset["text"], code=code), heading=title,
                          rows=[(reset["code_label"], code)], notes=[reset["note"]], to=[to], locale=locale)
    else:
        text = pack(locale, subject_kind)
        send_neutral_mail(f"SoulLedger {text['title']}", fill(text["text"], email=email), heading=text["title"],
                          rows=[], notes=[fill(text["note"], email=email)], to=[to], locale=locale)


class MeContactEmailView(SoulAPIView):
    @extend_schema(responses={200: ContactEmailStatusSerializer})
    def get(self, request):
        return Response(status_of(self.account))

    @extend_schema(request=ContactEmailStartSerializer, responses={202: ContactEmailSentSerializer, **REFUSALS})
    def post(self, request):
        """要先过 `verify/`(10 分钟内)。同一账号 5 分钟内最多发 3 次;再发一次,上一个码作废。"""
        account = self.account
        keys = _keys(account)
        if not cache.get(keys["proof"]):
            return _refuse("proof_required", status.HTTP_403_FORBIDDEN, "请先输入密码。")
        body = ContactEmailStartSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        email = body.validated_data["email"].strip()
        if email.lower() == (account.soul.contact_email or "").lower():
            return _refuse("email_unchanged", status.HTTP_400_BAD_REQUEST, "和现在的联系邮箱相同。")
        if _bump(keys["sent"], RESET_REQUEST_WINDOW_SECONDS) > MAX_RESET_REQUESTS_PER_ADDRESS:
            return _refuse("rate_limited", status.HTTP_429_TOO_MANY_REQUESTS, "请求过于频繁，请稍后再试")
        code = f"{secrets.randbelow(900000) + 100000:06d}"
        cache.set(keys["code"], {"email": email, "code": code}, timeout=CODE_SECONDS)
        cache.delete(keys["tries"])
        try:
            _send("email_code", email, account, code=code)
        except Exception:  # 发信失败不带码记日志;App 照常进下一步,收不到就「重新发送」
            logger.error("contact email change code could not be sent", exc_info=False)
        return Response({"sent_to": email}, status=status.HTTP_202_ACCEPTED)


class MeContactEmailVerifyView(SoulAPIView):
    @extend_schema(request=ContactEmailVerifySerializer, responses={204: None, **REFUSALS})
    def post(self, request):
        """当前密码(与开两步验证同一个闸、同一份失败预算);开了两步验证的再要 6 位数字(同一把锁)。"""
        account = self.account
        if not self_service(account):  # 唯一的闸:开始一次改动。往后两步不看开关,在途的照常完成
            return _in_person()
        body = ContactEmailVerifySerializer(data=request.data)
        body.is_valid(raise_exception=True)
        refusal = confirm_current_password(request, account, body.validated_data["password"])
        if refusal is not None:
            return refusal
        if mfa.is_enabled(account):
            code = body.validated_data.get("code") or ""
            if not code:
                return _refuse("mfa_required", status.HTTP_400_BAD_REQUEST, "请输入两步验证的 6 位数字。")
            outcome = mfa.verify_second_step(account, code=code, request=request)
            if outcome["code"] != "ok":
                return _refuse_outcome(outcome)
        cache.set(_keys(account)["proof"], True, timeout=PROOF_SECONDS)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeContactEmailConfirmView(SoulAPIView):
    @extend_schema(request=ContactEmailConfirmSerializer, responses={200: ContactEmailStatusSerializer, **REFUSALS})
    def post(self, request):
        from apps.authentication.models import User

        account = self.account
        body = ContactEmailConfirmSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        keys = _keys(account)
        pending = cache.get(keys["code"])
        if not pending:
            return _refuse("reset_code_expired", status.HTTP_400_BAD_REQUEST, "验证码已过期,请重新获取")
        # 先计数再比较(与 set_new_password 同一个理由:并发的猜测不能共用一次)。
        tries = _bump(keys["tries"], CODE_SECONDS)
        if tries > MAX_RESET_CODE_ATTEMPTS:
            cache.delete_many([keys["code"], keys["tries"]])
            return _refuse("reset_code_attempts_exceeded", status.HTTP_429_TOO_MANY_REQUESTS,
                           "验证码错误次数过多,请重新获取")
        if not secrets.compare_digest(pending["code"], body.validated_data["code"]):
            return _refuse("reset_code_wrong", status.HTTP_400_BAD_REQUEST, "验证码错误",
                           attempts_left=MAX_RESET_CODE_ATTEMPTS - tries)
        new = pending["email"]
        if User.objects.filter(email__iexact=new).exclude(pk=account.user_id).exists():
            cache.delete_many([keys["code"], keys["tries"]])
            return _refuse("email_taken", status.HTTP_409_CONFLICT, "这个邮箱已被其他账号使用。")
        old = account.soul.contact_email
        svc.apply_contacts(account.soul, contact_email=new)
        svc.audit("UPDATE", account.soul, "灵魂自己改了联系邮箱", request=request, resource_id=account.pk,
                  changes={"contact_email_changed_by_soul": True})
        cache.delete_many(list(keys.values()))
        if old:
            try:
                _send("email_changed", old, account, email=mask(new))
            except Exception:
                logger.error("contact email change notice could not be sent", exc_info=False)
        return Response(status_of(account))
