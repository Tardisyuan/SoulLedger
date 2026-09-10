"""One answer to "which language did this request ask for".

Why this module exists
----------------------
Three serializers had each written the same four lines::

    apps/realms/serializers.py:52     RealmLocalizedSerializer.get_display_name
    apps/actors/serializers.py:25     _locale_from_context
    apps/judgment/serializers.py:26   realm_options on the judgment queue

Two more call sites were about to be added (the disposition serializer and the
ledger's souls-by-realm aggregate, both of which read `name_en` directly and so
answered in English no matter who asked). Five copies of a header parse is the
shape `apps/core/client_ip.py` was created to end, and for the same reason: the
copies drift, and the drift is invisible because each one looks right where it
sits.

The parse itself is deliberately narrow. `Accept-Language` can carry a weighted
list (`en-GB,en;q=0.9,zh;q=0.8`), and a full negotiation would try each in turn
against what we have. We do not do that, because this header is not being used
for content negotiation in the usual sense: `packages/core/src/api/client.ts`
sets it to exactly one value — the locale the user picked in the app — and the
only consumers are our own `get_localized_name` methods, which compare it to
three known strings. Taking the first tag and stopping is the whole contract.
A browser-supplied header still resolves sensibly: its first tag wins, which is
the browser's own top preference.
"""

DEFAULT_LOCALE = "en"


def locale_from_request(request) -> str:
    """The primary language tag on the request, or `"en"`.

    `None` is accepted because DRF serializers are routinely built without a
    request in tests and in nested contexts; answering `"en"` there matches what
    every one of the three original copies did.
    """
    if request is None:
        return DEFAULT_LOCALE
    header = request.META.get("HTTP_ACCEPT_LANGUAGE", DEFAULT_LOCALE)
    return header.split(",")[0].strip() or DEFAULT_LOCALE


def locale_from_context(context) -> str:
    """Same, for a serializer's `self.context`."""
    return locale_from_request((context or {}).get("request"))
