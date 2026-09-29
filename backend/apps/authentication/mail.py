"""系统邮件:纯文本 + HTML 两部分(multipart/alternative)。

纯文本是正文的原件,调用方传进来的字符串逐字不改 —— 不渲染 HTML 的客户端、
以及读 `message.body` 的测试,看到的都是它。HTML 是同一内容的排版版本。

**中性皮**(规范 v2 补足 C16):邮件不按文明变色,理由同推送 —— 它在收件箱里,
不该暴露收件人属于哪个文明。单栏 600、纸底墨字、表格布局、内联样式、圆角 0、
无阴影、不依赖图片。

语言:两封现有邮件都只有中文(调用方写死),这里不另做语言选择。
"""
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string


def send_neutral_mail(subject, text, *, heading, rows, notes, to):
    """`rows` 是 (标签, 值) 的列表,值用等宽字排;`notes` 是逐段的说明。
    模板开着自动转义,所以值里的 `<` `&` 进 HTML 时是实体,不是标记。"""
    html = render_to_string(
        "emails/neutral.html",
        {"subject": subject, "heading": heading, "rows": rows, "notes": notes},
    )
    message = EmailMultiAlternatives(subject, text, None, to)
    message.attach_alternative(html, "text/html")
    message.send()
