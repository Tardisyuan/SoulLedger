#!/usr/bin/env python
"""Populate Egyptian underworld judicial actors."""
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

    # 42 Judges
    egyptian_names = [
        ('Aati', '阿蒂', 'Aati'), ('Anat', '阿纳特', 'Anat'), ('Anpu', '安普', 'Anpu'),
        ('Aped', '阿佩德', 'Aped'), ('Apuat', '阿普阿特', 'Apuat'), ('Babi', '芭比', 'Babi'),
        ('Ba-Pef', '巴佩夫', 'Ba-Pef'), ('Bes', '贝斯', 'Bes'), ('Neith', '奈斯', 'Neith'),
        ('Nekhbet', '奈赫贝特', 'Nekhbet'), ('Satet', '萨泰特', 'Satet'), ('Sebut', '塞布特', 'Sebut'),
        ('Serket', '塞尔凯特', 'Serket'), ('Shu', '舒', 'Shu'), ('Tefnut', '泰芙努特', 'Tefnut'),
        ('Geb', '盖布', 'Geb'), ('Nut', '努特', 'Nut'), ('Hathor', '哈托尔', 'Het-Heru'),
        ('Maat', '玛特', 'Maat'), ('Ptah', '普塔赫', 'Ptah'), ('Ra', '拉', 'Ra'),
        ('Sekhmet', '塞赫麦特', 'Sekhmet'), ('Bastet', '芭丝特', 'Bastet'), ('Tau', '陶', 'Tau'),
        ('Aah', '阿赫', 'Aah'), ('Hapi', '哈皮', 'Hapi'), ('Duamutef', '杜阿穆特夫', 'Duamutef'),
        ('Imsety', '伊姆塞蒂', 'Imsety'), ('Qebehsenuef', '凯贝塞努夫', 'Qebehsenuef'),
        ('Mafdet', '玛夫戴特', 'Mafdet'), ('Aker', '阿克尔', 'Aker'), ('Heka', '赫卡', 'Heka'),
        ('Sia', '西亚', 'Sia'), ('Hu', '胡', 'Hu'), ('Ced', '塞德', 'Sed'),
    ]

    # Ensure we have exactly 42 judges
    for i, (name_en, name_zh, name_egy) in enumerate(egyptian_names):
        if i >= 42:
            break
        actor, created = Actor.objects.get_or_create(
            name=name_en,
            civilization='EGYPTIAN',
            defaults={
                'name': name_en,
                'name_zh': name_zh,
                'name_en': name_en,
                'name_egy': name_egy,
                'title': f'Judge of the Hall of Two Truths',
                'title_zh': '真理大厅审判者',
                'title_en': f'Judge #{i+1} of the Forty-Two',
                'role': 'JUDGE',
                'civilization': 'EGYPTIAN',
                'realm': hall,
                'description': f'One of the 42 Judges of the Hall of Two Truths who witness the weighing of hearts.',
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