#!/usr/bin/env python
"""Populate Egyptian underworld judicial actors.

PARTIALLY SUPERSEDED by `python manage.py seed_mythology --civilization=egyptian`.
The command covers Osiris/Anubis/Thoth/Ma'at/Ammit/Horus/Isis/Nephthys/Ra, the
five Egyptian realms, and — since the roster was sourced — the Forty-Two
Assessors of Ma'at. One thing below is still not reproduced anywhere else:

  * Set (赛特) — present only here, absent from every other seed path. That is a
    canon question rather than plumbing, so it is left recorded as an open item
    rather than silently resolved.

The "42 Judges" roster that used to live in this file is GONE — see the note
where it stood. It is now `EGYPTIAN_ASSESSORS` in
`backend/apps/actors/management/commands/seed_mythology.py`.

It also disagrees with seed_chinese_data.py on where Horus/Isis/Nephthys stand
(Hall of Two Truths here, Duat entry / Aaru there) and on their roles.
Re-running this script will re-introduce those duplicates. Prefer the command.
"""
import os
import sys
from pathlib import Path

import django

# The backend package root — resolved from this file's own location, not from a
# hardcoded absolute path off somebody else's machine. Bootstrapping lives in a
# function so that merely *importing* this module (test collection, a linter, an
# editor's autocomplete) does not run django.setup() as a side effect.
BACKEND_ROOT = Path(__file__).resolve().parent.parent


def setup_django():
    sys.path.insert(0, str(BACKEND_ROOT))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    django.setup()


def main():
    setup_django()

    from apps.actors.models import Actor
    from apps.realms.models import Realm
    from apps.tenants.models import Tenant

    # Get realm IDs
    hall = Realm.objects.get(realm_code='EG_HALL_TWO_TRUTHS')
    devourer = Realm.objects.get(realm_code='EG_ANNIHILATION')

    # Get first tenant (system tenant)
    tenant = Tenant.objects.first()

    actors_to_create = [
        # Horus
        {
            'name': 'Horus', 'name_zh': '荷鲁斯', 'name_en': 'Horus', 'name_egy': 'Heru',
            'title': 'Lord of the Sky', 'title_zh': '天空之主', 'title_en': 'Lord of the Sky', 'title_egy': 'Hr',
            'role': 'JUDGE', 'civilization': 'EGYPTIAN', 'realm': hall,
            'description': 'God of kingship and sky. In the Hall of Two Truths, Horus acts as prosecutor in trials against Set.',
            'tenant': tenant,
        },
        # Ammit
        {
            'name': 'Ammit', 'name_zh': '阿米特', 'name_en': 'Ammit', 'name_egy': 'Ammut',
            'title': 'Devourer of the Dead', 'title_zh': '噬魂者', 'title_en': 'Devourer of the Dead', 'title_egy': '',
            'role': 'EXECUTOR', 'civilization': 'EGYPTIAN', 'realm': devourer,
            'description': 'The Devourer who consumes the hearts of the unworthy after the weighing of the heart.',
            'tenant': tenant,
        },
        # Isis
        {
            'name': 'Isis', 'name_zh': '伊西斯', 'name_en': 'Isis', 'name_egy': 'Aset',
            'title': 'Protector of the Dead', 'title_zh': '亡者守护者', 'title_en': 'Protector of the Dead', 'title_egy': 'Aset',
            'role': 'CONDUIT', 'civilization': 'EGYPTIAN', 'realm': hall,
            'description': 'Goddess of magic, marriage, and healing. Wife of Osiris, protector of the dead.',
            'tenant': tenant,
        },
        # Nephthys
        {
            'name': 'Nephthys', 'name_zh': '奈芙蒂斯', 'name_en': 'Nephthys', 'name_egy': 'Nebet-het',
            'title': 'Lady of the House', 'title_zh': '亡灵哀悼者', 'title_en': 'Lady of the House', 'title_egy': 'Nebet-het',
            'role': 'CONDUIT', 'civilization': 'EGYPTIAN', 'realm': hall,
            'description': 'Goddess of mourning and the night. Daughter of Geb and Nut, sister of Isis and Set.',
            'tenant': tenant,
        },
        # Set
        {
            'name': 'Set', 'name_zh': '赛特', 'name_en': 'Set', 'name_egy': 'Seth',
            'title': 'Lord of Chaos', 'title_zh': '混沌之主', 'title_en': 'Lord of Chaos', 'title_egy': 'Seth',
            'role': 'JUDGE', 'civilization': 'EGYPTIAN', 'realm': hall,
            'description': 'God of chaos, storms, and deserts. Opponent of Horus in the great trial.',
            'tenant': tenant,
        },
    ]

    created_count = 0
    for a in actors_to_create:
        actor, created = Actor.objects.get_or_create(name=a['name'], civilization=a['civilization'], defaults=a)
        if created:
            print(f'Created: {actor.name}')
            created_count += 1
        else:
            print(f'Already exists: {actor.name}')

    # -----------------------------------------------------------------
    # The "42 Judges" roster used to live here. It is GONE, and it is not
    # coming back to this file.
    #
    # WHERE IT WENT: `EGYPTIAN_ASSESSORS` in
    # backend/apps/actors/management/commands/seed_mythology.py, seeded by
    # `python manage.py seed_mythology --civilization=egyptian`. That is a
    # real, sourced, ordered 42 — Budge's transliteration of the Papyrus of
    # Nebseni (BM EA 9900, sheet 30), names from The Gods of the Egyptians I
    # (1904) and home places plus confession clauses from The Book of the
    # Dead: ... the Theban Recension II (1901), cross-checked slot by slot
    # against UCL Digital Egypt's Papyrus of Maiherperi transcription. Each
    # row carries its position in the bench, its home town, its clause of the
    # negative confession, and its citation in `powers_json`. Uncertain
    # readings are flagged in the row rather than smoothed away.
    #
    # WHY THE OLD LIST WAS NOT A ROSTER OF ASSESSORS. The 42 assessors of
    # Chapter 125 are a fixed, ordered bench: each is addressed by name, given
    # a home town, and paired with one clause of the negative confession
    # ("O Usekht-nemmat who comest forth from Annu, I have not done
    # iniquity"). What this file held was 33 names that were nothing of the
    # kind — major deities (Shu, Tefnut, Geb, Nut, Hathor, Ptah, Sekhmet,
    # Bastet), the four sons of Horus (Hapi, Duamutef, Imsety, Qebehsenuef),
    # and personified concepts (Heka, Sia, Hu). None of them appears in any
    # papyrus witness of the bench of 42; Geb and Hathor are not assessors in
    # any manuscript.
    #
    # Its actual provenance was traced: the padding came from a single
    # sentence of prose in the World History Encyclopedia article "The
    # Forty-Two Judges" — "Of these, there were nine great judges: Ra, Shu,
    # Tefnut, Geb, Nut, Isis, Nephthys, Horus, Hathor" — which is a different
    # claim about a different group. The list was assembled from that
    # sentence rather than from the article's own list, then topped up to
    # length. Two entries also collided with real seeded deities: 'Ra' (the
    # EGYPTIAN OVERSEER of EG_AARU) manufactured the duplicate row named in
    # fix_actor_civilization.DUPLICATE_NAMES, and 'Maat' manufactured the
    # cross-spelling duplicate of "Ma'at" that the same command's
    # SPELLING_MERGES exists to resolve.
    #
    # The project owner's decision is that the 33 are discarded outright, not
    # migrated: they were never assessors, so there is nothing in them to
    # carry over. Do not re-add a roster here.
    # -----------------------------------------------------------------

    print(f'\nTotal EGYPTIAN actors: {Actor.objects.filter(civilization="EGYPTIAN").count()}')
    print(f'Newly created: {created_count}')

if __name__ == '__main__':
    main()
