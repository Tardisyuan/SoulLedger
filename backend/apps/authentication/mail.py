"""系统邮件:纯文本 + HTML 两部分(multipart/alternative)。

纯文本是正文的原件,调用方传进来的字符串逐字不改 —— 不渲染 HTML 的客户端、
以及读 `message.body` 的测试,看到的都是它。HTML 是同一内容的排版版本。

**中性皮**(规范 v2 补足 C16):邮件不按文明变色,理由同推送 —— 它在收件箱里,
不该暴露收件人属于哪个文明。单栏 600、纸底墨字、表格布局、内联样式、圆角 0、
无阴影、不依赖图片。

**语言**(2026-09-30 用户决定):按收件人的语言偏好发;没设置就按所属文明选 ——
见 `mail_locale`。文案的权威在 `packages/core/messages/{zh-Hans,en,egy}.json` 的
`soul_mail` 命名空间,`MESSAGES` 是它的副本(理由同 `apps/soul_push/messages.py`:
后端镜像里没有 `packages/`),由 `tests/test_system_mail_speaks_the_recipients_language.py`
逐字钉住。
"""
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from apps.souls.models import UNKNOWN_CIVILIZATION, Civilization

DEFAULT_LOCALE = "zh-Hans"

# 文明 → 默认语言。不是第二份租户映射:租户 → 文明仍只读 `TENANT_CIVILIZATION`。
CIVILIZATION_LOCALE = {
    Civilization.CHINESE: "zh-Hans",
    Civilization.EGYPTIAN: "egy",
    Civilization.EUROPEAN: "en",
    Civilization.GREEK: "en",
}

MESSAGES = {
    "zh-Hans": {
        "footer": "这封信由系统发出，不接收回复。",
        "reset_code": {
            "title": "密码重置验证码",
            "code_label": "验证码",
            "note": "5 分钟内有效。如非本人操作,请忽略本邮件。",
            "text": "您的验证码: {{code}}\n5 分钟内有效。如非本人操作,请忽略本邮件。",
        },
        "credential": {
            "title": "灵魂账号",
            "soul_code_label": "灵魂编号",
            "password_label": "初始密码",
            "expires_label": "有效期至",
            "note_change": "首次登录后须修改密码。",
            "note_once": "该密码只发送这一次;过期或遗失请联系所属文明的官员重置。",
            "text": (
                "您的灵魂编号:{{soul_code}}\n初始密码:{{password}}\n有效期至 {{expires_at}}。首次登录后须修改密码。\n"
                "该密码只发送这一次;过期或遗失请联系所属文明的官员重置。"
            ),
        },
    },
    "en": {
        "footer": "This message was sent by the system; replies are not received.",
        "reset_code": {
            "title": "Password reset code",
            "code_label": "Code",
            "note": "Valid for 5 minutes. If you did not ask for this, ignore this email.",
            "text": "Your code: {{code}}\nValid for 5 minutes. If you did not ask for this, ignore this email.",
        },
        "credential": {
            "title": "Soul account",
            "soul_code_label": "Soul code",
            "password_label": "Initial password",
            "expires_label": "Valid until",
            "note_change": "You must change the password at first sign-in.",
            "note_once": (
                "This password is sent only once; if it expires or is lost, ask an officer of your civilization to reset it."
            ),
            "text": (
                "Your soul code: {{soul_code}}\nInitial password: {{password}}\n"
                "Valid until {{expires_at}}. You must change the password at first sign-in.\n"
                "This password is sent only once; if it expires or is lost, ask an officer of your civilization to reset it."
            ),
        },
    },
    "egy": {
        "footer": "Shemes Pen Hab In Hemsu. Nen Shesep Wesheb.",
        "reset_code": {
            "title": "Wehem Sekhem · Hesb Maa",
            "code_label": "Hesb Maa",
            "note": "Wenen At 5. Nen Djes: Nen Iri Khet.",
            "text": "Hesb Maa-Ek: {{code}}\nWenen At 5. Nen Djes: Nen Iri Khet.",
        },
        "credential": {
            "title": "Aq En Ba",
            "soul_code_label": "Ren Hesb Ba",
            "password_label": "Sekhem Tepy",
            "expires_label": "Wenen Er",
            "note_change": "Khemen Sekhem Em Aq Tepy.",
            "note_once": "Sekhem Pen: Hab Sep 1 Wa. Wenen Khetem Seth Ky Nen Gem: Sab En Per-Ek Wehem Sekhem.",
            "text": (
                "Ren Hesb Ba-Ek: {{soul_code}}\nSekhem Tepy: {{password}}\n"
                "Wenen Er {{expires_at}}. Khemen Sekhem Em Aq Tepy.\n"
                "Sekhem Pen: Hab Sep 1 Wa. Wenen Khetem Seth Ky Nen Gem: Sab En Per-Ek Wehem Sekhem."
            ),
        },
    },
}


def fill(template, **params):
    """`{{占位符}}`,与语言包同一写法。"""
    for key, value in params.items():
        template = template.replace(f"{{{{{key}}}}}", str(value))
    return template


def mail_locale(soul=None, *, user=None):
    """收件人的语言:本世账号的 `PushPreference.locale` → 所属(原属)文明的默认 → zh-Hans。

    偏好只看**本世**账号,与推送一致(偏好按账号,新一世从默认开始)。刚开号的一世还没有
    偏好,于是初始密码信按文明走。未知文明退回 zh-Hans:这两封信此前对所有人都是中文,
    退回原样是唯一不需要猜的选择。
    """
    from apps.soul_push.models import PushPreference

    if soul is None and user is not None:
        account = getattr(user, "soul_account", None)  # RelatedObjectDoesNotExist 是 AttributeError
        soul = account.soul if account is not None else None
    if soul is not None:
        preferred = (
            PushPreference.objects.filter(account__soul=soul, account__retired_at__isnull=True)
            .values_list("locale", flat=True)
            .first()
        )
        if preferred in MESSAGES:
            return preferred
        civilization = soul.home_civilization
    else:
        tenant = getattr(user, "tenant", None)
        civilization = tenant.civilization if tenant is not None else UNKNOWN_CIVILIZATION
    return CIVILIZATION_LOCALE.get(civilization, DEFAULT_LOCALE)


def send_neutral_mail(subject, text, *, heading, rows, notes, to, locale=DEFAULT_LOCALE):
    """`rows` 是 (标签, 值) 的列表,值用等宽字排;`notes` 是逐段的说明。
    模板开着自动转义,所以值里的 `<` `&` 进 HTML 时是实体,不是标记。"""
    html = render_to_string(
        "emails/neutral.html",
        {
            "subject": subject, "heading": heading, "rows": rows, "notes": notes,
            "lang": locale, "footer": MESSAGES[locale]["footer"],
        },
    )
    message = EmailMultiAlternatives(subject, text, None, to)
    message.attach_alternative(html, "text/html")
    message.send()
