"""
Management command to populate Chinese underworld judicial personnel.
Adds missing actors: Wei Zheng, Cui Fujun, Ksitigarbha
"""
import os
import sys

# Setup Django
sys.path.insert(0, '/home/tardis/Documents/跨文明灵魂管理系统/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from apps.actors.models import Actor, ActorRole
from apps.realms.models import Realm


def run():
    # Find realms
    yama_realm = Realm.objects.filter(name_zh='阎罗殿').first()
    qishi_realm = Realm.objects.filter(name_zh='齐世寺').first()
    taishan_realm = Realm.objects.filter(name_zh='泰山府').first()
    zhonguan_realm = Realm.objects.filter(name_zh='转轮寺').first()

    if not yama_realm:
        print("WARNING: Could not find 阎罗殿 realm, actors will have null realm")
        yama_realm = None
    if not qishi_realm:
        print("WARNING: Could not find 齐世寺 realm")
        qishi_realm = None

    print(f"Realms: 阎罗殿={yama_realm}, 齐世寺={qishi_realm}, 泰山府={taishan_realm}, 转轮寺={zhonguan_realm}")

    created = []

    # 1. 魏征 - Wei Zheng, Head of 察查司 (Appeals Court)
    wei_zheng, created_wz = Actor.objects.get_or_create(
        name_en='Wei Zheng',
        defaults={
            'name': 'wei_zheng',
            'name_zh': '魏征',
            'name_en': 'Wei Zheng',
            'title_zh': '察查司正堂',
            'title_en': 'Head of the Appeals Court',
            'role': ActorRole.JUDGE,
            'civilization': 'CHINESE',
            'realm': yama_realm,
            'description': 'Chief judge of the 察查司 (Appeals Court), handles wrongful judgment appeals in the Chinese underworld.',
        }
    )
    if created_wz:
        created.append('魏征 (Wei Zheng)')
        print(f"Created: 魏征")
    else:
        print(f"Already exists: 魏征")

    # 2. 崔府君 - Cui Fujun (aka 崔判官), Registrar/Judge
    cui_fujun, created_cf = Actor.objects.get_or_create(
        name_en='Cui Fujun',
        defaults={
            'name': 'cui_fujun',
            'name_zh': '崔府君',
            'name_en': 'Cui Fujun',
            'title_zh': '崔判官',
            'title_en': 'Cui the Registrar',
            'role': ActorRole.JUDGE,
            'civilization': 'CHINESE',
            'realm': yama_realm,
            'description': 'Senior registrar and judge in the underworld courts, assists the Ten Yama Kings.',
        }
    )
    if created_cf:
        created.append('崔府君 (Cui Fujun)')
        print(f"Created: 崔府君")
    else:
        print(f"Already exists: 崔府君")

    # 3. 地藏王菩萨 - Ksitigarbha Bodhisattva
    kshitigarbha, created_ks = Actor.objects.get_or_create(
        name_en='Ksitigarbha',
        defaults={
            'name': 'kshitigarbha',
            'name_zh': '地藏王菩萨',
            'name_en': 'Ksitigarbha (地藏王)',
            'title_zh': '地藏王菩萨',
            'title_en': 'Ksitigarbha Bodhisattva',
            'role': ActorRole.OVERSEER,
            'civilization': 'CHINESE',
            'realm': qishi_realm,
            'description': 'The Bodhisattva of the Great Vow who rescues beings from the hell realms. Provides relief to wrongful deaths and those suffering in the tortures chambers.',
        }
    )
    if created_ks:
        created.append('地藏王菩萨 (Ksitigarbha)')
        print(f"Created: 地藏王菩萨")
    else:
        print(f"Already exists: 地藏王菩萨")

    # Fix 转轮王 court number (was 第九殿, should be 第十殿)
    zhuanlun = Actor.objects.filter(name_zh='转轮王').first()
    if zhuanlun and zhuanlun.title_zh != '第十殿转轮王':
        old_title = zhuanlun.title_zh
        zhuanlun.title_zh = '第十殿转轮王'
        zhuanlun.title_en = 'Tenth Court Judge'
        zhuanlun.save()
        print(f"Fixed 转轮王 title: {old_title} -> 第十殿转轮王")
    elif zhuanlun:
        print(f"转轮王 title already correct: {zhuanlun.title_zh}")

    # Fix 平等王 court number if needed (should be 第九殿)
    pingdeng = Actor.objects.filter(name_zh='平等王').first()
    if pingdeng and pingdeng.title_zh != '第九殿平等王':
        old_title = pingdeng.title_zh
        pingdeng.title_zh = '第九殿平等王'
        pingdeng.title_en = 'Ninth Court Judge'
        pingdeng.save()
        print(f"Fixed 平等王 title: {old_title} -> 第九殿平等王")

    print(f"\nTotal created: {len(created)}")
    for c in created:
        print(f"  - {c}")

    # Verify final count
    total = Actor.objects.filter(civilization='CHINESE').count()
    print(f"\nTotal Chinese actors now: {total}")

    return created


if __name__ == '__main__':
    run()
