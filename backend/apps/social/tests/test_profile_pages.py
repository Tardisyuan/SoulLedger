"""GET /profiles/ pages in a total order.

It paginated an unordered queryset: the database owes no stable order, so a
row could appear on page 1 and again on page 2 while another appeared on
neither. DRF said so (`UnorderedObjectListWarning`, 4 per run) and nobody read
it; pytest.ini now makes that warning an error.

Users are created in reverse username order so that insertion order — what an
unordered SQLite scan happens to return — is not the order asserted here.
"""
import pytest
from django.contrib.auth import get_user_model

from apps.social.models import UserProfile

User = get_user_model()


@pytest.mark.django_db
def test_every_profile_appears_exactly_once_across_pages_in_username_order(auth_client, user, tenant):
    names = [f"pager{i:02d}" for i in range(25)]
    for name in reversed(names):
        u = User.objects.create_user(username=name, password="x", role="VIEWER", tenant=tenant)
        UserProfile.objects.create(user=u)
    UserProfile.objects.get_or_create(user=user)

    seen = []
    url = "/api/v1/social/profiles/"
    while url:
        resp = auth_client.get(url)
        assert resp.status_code == 200, resp.content
        seen += [row["username"] for row in resp.data["results"]]
        url = resp.data["next"]

    expected = sorted(names + [user.username])
    assert seen == expected
    assert len(seen) == len(set(seen)), "a profile appeared on two pages"
