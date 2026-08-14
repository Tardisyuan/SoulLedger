#!/usr/bin/env python
"""Populate Egyptian underworld judicial actors.

PARTIALLY SUPERSEDED by `python manage.py seed_mythology --civilization=egyptian`.
The command covers Osiris/Anubis/Thoth/Ma'at/Ammit/Horus/Isis/Nephthys/Ra and
the five Egyptian realms. It deliberately does NOT reproduce two things below,
because they are canon questions rather than plumbing and are recorded as open
items rather than silently resolved:

  * Set (赛特) — present only here, absent from every other seed path.
  * The "42 Judges" roster — RESOLVED as far as it can be without new source
    material. The colliding names ('Ra', 'Maat') have been removed, and the
    block no longer creates a partial roster: it prints why it is skipping.
    The remaining gap — the 42 actual assessors of BD Chapter 125 — is an open
    canon question, spelled out in the comment above that block.

It also disagrees with seed_chinese_data.py on where Horus/Isis/Nephthys stand
(Hall of Two Truths here, Duat entry / Aaru there) and on their roles.
Re-running this script will re-introduce those duplicates. Prefer the command.
"""
import os
import sys

import django

# Setup Django
sys.path.insert(0, '/home/tardis/Documents/跨文明灵魂管理系统/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.actors.models import Actor
from apps.realms.models import Realm
from apps.tenants.models import Tenant


def main():
    # Get realm IDs
    hall = Realm.objects.get(realm_code='EG_HALL_TWO_TRUTHS')
    devourer = Realm.objects.get(realm_code='EG_DEVOURER')

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
    # The "42 Judges" roster — INCOMPLETE, deliberately not created.
    #
    # The 42 assessors of the Hall of Two Truths come from Chapter 125 of
    # the Book of the Dead: each one is paired with one clause of the
    # negative confession ("I have not stolen", "I have not lied"), and
    # each has a name and a home town ("Usekh-nemtut who comes from
    # Heliopolis", and so on). It is a fixed, ordered list of 42.
    #
    # The list this script used to carry was not that list. It held 35
    # names, and they were not assessors at all — they were major deities
    # (Shu, Tefnut, Geb, Nut, Hathor, Ptah, Sekhmet, Bastet), the four
    # sons of Horus (Hapi, Duamutef, Imsety, Qebehsenuef), and personified
    # concepts (Heka, Sia, Hu), padded out to look like a roster. Two of
    # them collided with actors that already exist as full deities:
    #
    #   * 'Ra'   — already seeded as the EGYPTIAN OVERSEER of EG_AARU.
    #   * 'Maat' — a second spelling of the goddess seeded as "Ma'at",
    #              JUDGE of EG_HALL_TWO_TRUTHS.
    #
    # Both are removed below. 'Ra' was creating the duplicate row listed in
    # fix_actor_civilization.DUPLICATE_NAMES; 'Maat' was creating the
    # cross-spelling duplicate that command's SPELLING_MERGES now resolves.
    #
    # That leaves 33 names, none of them verifiably an assessor, against a
    # roster that must contain exactly 42 specific ones. Inventing the
    # remaining nine — or keeping the 33 wrong ones — would put fabricated
    # canon in the database under a name that claims authority. So this
    # block creates nothing and says why.
    #
    # TO FINISH THIS: supply the 42 assessor names from a cited translation
    # of BD Chapter 125 (Budge, Faulkner and Allen all differ in
    # transliteration, so the choice of edition needs to be recorded), in
    # order, each with its negative-confession clause. Then replace this
    # block. Until then the Hall of Two Truths has its five principals
    # (Osiris, Anubis, Thoth, Ma'at, Ammit) seeded by
    # `manage.py seed_mythology` and no assessors.
    # -----------------------------------------------------------------
    FORTY_TWO_ASSESSORS_REQUIRED = 42
    forty_two_assessors = []  # see above — intentionally empty

    if len(forty_two_assessors) != FORTY_TWO_ASSESSORS_REQUIRED:
        print(
            f'\nSKIPPED: "42 Judges" roster holds '
            f'{len(forty_two_assessors)}/{FORTY_TWO_ASSESSORS_REQUIRED} names. '
            f'Creating a partial roster under the name "the Forty-Two" would be '
            f'fabricated canon, so nothing was created. See the comment above '
            f'this block for what is needed to finish it.'
        )
    else:
        for i, (name_en, name_zh, name_egy) in enumerate(forty_two_assessors):
            actor, created = Actor.objects.get_or_create(
                name=name_en,
                civilization='EGYPTIAN',
                defaults={
                    'name': name_en,
                    'name_zh': name_zh,
                    'name_en': name_en,
                    'name_egy': name_egy,
                    'title': 'Judge of the Hall of Two Truths',
                    'title_zh': '真理大厅审判者',
                    'title_en': f'Judge #{i+1} of the Forty-Two',
                    'role': 'JUDGE',
                    'civilization': 'EGYPTIAN',
                    'realm': hall,
                    'description': 'One of the 42 Judges of the Hall of Two Truths who witness the weighing of hearts.',
                    'tenant': tenant,
                }
            )
            if created:
                print(f'Created Judge: {actor.name}')
                created_count += 1
            else:
                print(f'Already exists: {actor.name}')

    print(f'\nTotal EGYPTIAN actors: {Actor.objects.filter(civilization="EGYPTIAN").count()}')
    print(f'Newly created: {created_count}')

if __name__ == '__main__':
    main()
