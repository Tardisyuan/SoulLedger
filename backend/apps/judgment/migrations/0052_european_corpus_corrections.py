"""
欧洲两套条文跟着 2026-11-13 的核对改(civ-audit-2026-11-13.md,EU-5 / EU-16 / EU-23):

    EU-INF-C9、C9-Z1..Z4   `aristotelian_class`:「matta bestialitade」→「malizia — frode (tradimento)」。
                           Inf. XI.52-66 把背叛明文归在欺诈之下;「狂兽性」指哪一圈注家有争议,不指派。
                           C9 的 `conjecture` 文字同步。
    EU-INF-C3              「冷雨、冰雹与黑雪」→「冰雹、污水与雪」(Inf. VI:暗的是水,不是雪)。
    EU-DS-T7               「穿过巨大的火墙」→「在烈火中行走」(Purg. XXV;穿火墙的是但丁本人)。

``seed_mythology`` 默认只建不改,已有库里的行不会跟着种子变,所以这里改。只替换仍是旧文字的地方
(按子串),有人手改过的不覆盖。走 ``_base_manager``(默认 manager 在迁移里不可用)。
"""

from django.db import migrations

ARISTOTLE = ("matta bestialitade", "malizia — frode (tradimento)")
TREACHERY_CONJECTURE = (
    (
        'The assignment of 「matta bestialitade」 to treachery is a reading of Inf. XI, recorded as such in'
        ' verify-christian-structure.md §2, and not a sentence in the poem. Virgil separates fraud from '
        'treachery by whether a special bond of trust existed (Inf. XI.52-66); he does not say in that '
        'speech which of his three headings the ninth circle falls under. The value is carried because '
        'the report carries it, and it is marked here so that nobody re-derives it as settled.'
    ),
    (
        "Virgil's speech puts treachery under fraud: fraud practised on one who trusts breaks the special"
        " bond, and 'hence in the smallest circle ... whoe'er betrays for ever is consumed' (Inf. "
        'XI.52-66, Longfellow). The heading carried is therefore malizia — frode, of the kind that '
        'betrays a trust. Until 2026-11-13 this article carried 「matta bestialitade」, a reading taken '
        'from verify-christian-structure.md §2. Which circle that third word names is disputed among the '
        'commentators (violence is the usual reading) and this corpus assigns it to none; it is marked '
        'here so that nobody re-derives either as settled.'
    ),
)
SNOW_ZH = ("冷雨、冰雹与黑雪", "冰雹、污水与雪")
SNOW_EN = ("cold rain, hail and black snow", "hail, foul water and snow")
FLAME_ZH = ("穿过巨大的火墙", "在烈火中行走")
FLAME_TEXT_EN = ("The penitent passes through a wall of flame.", "The penitent walks within the flames.")
FLAME_PAYLOAD_EN = ("passing through a wall of flame", "walking within the flames")

#: code -> {column or payload key: (old, new)}. `text_*` are columns; every other key is in `payload_json`.
COLUMNS = ("text_zh", "text_en")
CHANGES = {
    "EU-INF-C9": {"aristotelian_class": ARISTOTLE, "conjecture": TREACHERY_CONJECTURE},
    **{f"EU-INF-C9-Z{n}": {"aristotelian_class": ARISTOTLE} for n in (1, 2, 3, 4)},
    "EU-INF-C3": {"text_zh": SNOW_ZH, "text_en": SNOW_EN, "contrapasso_zh": SNOW_ZH, "contrapasso_en": SNOW_EN},
    "EU-DS-T7": {"text_zh": FLAME_ZH, "text_en": FLAME_TEXT_EN,
                 "purgation_zh": FLAME_ZH, "purgation_en": FLAME_PAYLOAD_EN},
}


def _apply(apps, schema_editor, old_index, new_index):
    Statute = apps.get_model("judgment", "Statute")
    manager = Statute._base_manager.using(schema_editor.connection.alias)
    for statute in manager.filter(code__in=list(CHANGES)):
        payload = dict(statute.payload_json or {})
        updates = {}
        for key, pair in CHANGES[statute.code].items():
            old, new = pair[old_index], pair[new_index]
            current = getattr(statute, key) if key in COLUMNS else payload.get(key)
            if not isinstance(current, str) or old not in current:
                continue
            if key in COLUMNS:
                updates[key] = current.replace(old, new)
            else:
                payload[key] = current.replace(old, new)
                updates["payload_json"] = payload
        if updates:
            manager.filter(pk=statute.pk).update(**updates)


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, 0, 1)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, 1, 0)


class Migration(migrations.Migration):
    dependencies = [("judgment", "0051_v4_fail_reasons_deadline_doc_tz")]

    operations = [migrations.RunPython(forwards, backwards)]
