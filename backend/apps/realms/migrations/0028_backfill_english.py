"""The English the display table held for realm descriptions, keyed by the description. Only blank columns are
filled, and a description since rewritten has no match and stays blank. Reverse: `0027` drops the column."""
from django.db import migrations

DESCRIPTION_EN = {
    "Intake court - the Ledger of Life and Death is read and the soul's case opened at the 孽镜台 (Mirror of Retribution); no punishment is administered here": "Intake court - the Ledger of Life and Death is read and the soul's case opened at the Mirror of Retribution; no punishment is administered here",
    "Souls awaiting reunion with loved ones. SOURCE UNKNOWN: no underworld place by this name appears in 《玉历宝钞》 or 《十王经》; treat as this project's own element until a source is produced": "Souls awaiting reunion with loved ones. SOURCE UNKNOWN: no underworld place by this name appears in the Jade Records or the Scripture of the Ten Kings; treat as this project's own element until a source is produced",
    "叫唤大地狱 and the 十六诛心小地狱 - the court that tries the intent behind the act: malice, ingratitude, envy, miserliness. The 望乡台 stands here": "The Howling Hell and its sixteen small hells of the heart - the court that tries the intent behind the act: malice, ingratitude, envy, miserliness. The Terrace for Viewing Home stands here",
    "合大地狱 - fraud, withheld dues, falsified accounts": "Great Crushing Hell - fraud, withheld dues, falsified accounts",
    "大叫唤大地狱 - sacrilege and irreverence": "Greater Howling Hell - sacrilege and irreverence",
    "大热恼大地狱 - unfilial conduct and betrayal of one's own house": "Greater Burning Hell - unfilial conduct and betrayal of one's own house",
    "活大地狱 - the mildest punishment court; thieves and those who wounded others in life": "Great Reviving Hell - the mildest punishment court; thieves and those who wounded others in life",
    "热恼大地狱 - taking bones for medicine, scattering of kin": "Great Burning Hell - taking bones for medicine, scattering of kin",
    "阿鼻地狱 - the deepest hell; murder, arson, the crimes with no remedy": "Avici Hell - the deepest hell; murder, arson, the crimes with no remedy",
    "黑绳大地狱 - 忤逆尊长, 教唆兴讼, 背恩失节: defying one's elders, inciting litigation, betraying a trust": "Great Black Rope Hell - defying one's elders, inciting litigation, betraying a trust",
}


def forwards(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    for description, english in DESCRIPTION_EN.items():
        Realm._base_manager.filter(description=description, description_en="").update(description_en=english)


class Migration(migrations.Migration):
    dependencies = [("realms", "0027_english_columns")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
