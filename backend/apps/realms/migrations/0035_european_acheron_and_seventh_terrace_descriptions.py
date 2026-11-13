"""
两个欧洲界域的描述跟着 2026-11-13 的核对改(civ-audit-2026-11-13.md,EU-2 / EU-3 / EU-23):

    EU_PURGATORY_T7_LUST   「穿过火墙」是但丁本人离开这一层时做的事;涤罪者是在火中行走(Purg. XXV)。
    EU_ACHERON             渡口在此岸、前庭之后(Inf. III),不是「对岸」;并写明「所有欧洲灵魂一死先记在这里」
                           是本系统的入口站设定,诗里只有下地狱的人聚到这里。

``seed_mythology`` 默认只建不改,已有库里的行不会跟着种子变,所以这里改。只动描述仍是旧值的行。
走 ``_base_manager``,理由同 ``realms/0016``。
"""

from django.db import migrations

DESCRIPTIONS = {
    "EU_PURGATORY_T7_LUST": (
        (
            'Seventh and last terrace: lust. The penitent passes through a wall of flame (Purg. XXV-XXVII). '
            'Love excessive. What lies above is not an eighth terrace but the summit itself — the Earthly '
            'Paradise, Lethe and Eunoè, and the ascent to the stars'
        ),
        (
            'Seventh and last terrace: lust. The penitent walks within the flames (Purg. XXV-XXVII). Love '
            'excessive. What lies above is not an eighth terrace but the summit itself — the Earthly '
            'Paradise, Lethe and Eunoè, and the ascent to the stars'
        ),
    ),
    "EU_ACHERON": (
        (
            "The far bank of Acheron, where the dead are ferried in. Virgil, Aeneid 6.295-297 ('the way leads"
            " to that Tartarean stream of Acheron'); Dante puts Charon here too, before the first circle "
            '(Inferno III), which is why this is a threshold and not a circle. Euripides, Alcestis 252-256 '
            'has the same crossing as a lake. Not a destination: nobody is sentenced here.'
        ),
        (
            'The near bank of Acheron, past the vestibule, where Charon takes the dead on board. Virgil, '
            "Aeneid 6.295-297 ('the way leads to that Tartarean stream of Acheron'); Dante puts Charon here "
            'too, before the first circle (Inferno III), which is why this is a threshold and not a circle. '
            'Euripides, Alcestis 252-256 has the same crossing as a lake. In the poem only those bound for '
            'hell gather here; this system records every European soul here at death, before any verdict, as '
            'its entry station. Not a destination: nobody is sentenced here.'
        ),
    ),
}


def forwards(apps, schema_editor):
    alias = schema_editor.connection.alias
    Realm = apps.get_model("realms", "Realm")
    for code, (old, new) in DESCRIPTIONS.items():
        Realm._base_manager.using(alias).filter(realm_code=code, description=old).update(description=new)


def backwards(apps, schema_editor):
    alias = schema_editor.connection.alias
    Realm = apps.get_model("realms", "Realm")
    for code, (old, new) in DESCRIPTIONS.items():
        Realm._base_manager.using(alias).filter(realm_code=code, description=new).update(description=old)


class Migration(migrations.Migration):
    dependencies = [("realms", "0034_asphodel_meadow_egy_name")]

    operations = [migrations.RunPython(forwards, backwards)]
