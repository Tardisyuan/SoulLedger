"""告诉 drf-spectacular 两个认证类是什么(apps.py 的 ready() 导入本模块)。

官员那一个沿用 simplejwt 扩展的名字 `jwtAuth`:它换掉的正是那个类,文档里所有官员接口的
security 不该因此改名。灵魂那一个单独叫 `soulJwtAuth`,生成的客户端据此知道 /me 要的是另一种令牌。
"""
from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme


class OfficerJWTScheme(SimpleJWTScheme):
    target_class = "apps.soul_accounts.authentication.OfficerJWTAuthentication"
    name = "jwtAuth"


class SoulJWTScheme(SimpleJWTScheme):
    target_class = "apps.soul_accounts.authentication.SoulJWTAuthentication"
    name = "soulJwtAuth"
