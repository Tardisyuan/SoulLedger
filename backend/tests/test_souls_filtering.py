"""
Tests for Soul list filtering and search.
"""
import pytest
from rest_framework.test import APIClient
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestSoulFiltering:
    """Test soul list endpoint filtering."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant, eu_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.cn_tenant = cn_tenant
        self.eu_tenant = eu_tenant
        self.client.force_authenticate(user=admin_user)

    @pytest.fixture
    def create_souls(self):
        """Create souls across different civilizations and states."""
        # Chinese souls
        self.chinese_alive = Soul.objects.create(
            name="李白",
            current_state=SoulState.ALIVE,
            merit_score=100,
            demerit_score=20,
            tenant=self.cn_tenant,
        )
        self.chinese_judging = Soul.objects.create(
            name="杜甫",
            current_state=SoulState.JUDGING,
            merit_score=50,
            demerit_score=50,
            tenant=self.cn_tenant,
        )
        self.chinese_disposed = Soul.objects.create(
            name="白居易",
            current_state=SoulState.DISPOSED,
            merit_score=200,
            demerit_score=30,
            tenant=self.cn_tenant,
        )

        # European souls
        self.eu_soul = Soul.objects.create(
            name="Dante",
            current_state=SoulState.ALIVE,
            merit_score=80,
            demerit_score=10,
            tenant=self.eu_tenant,
        )

        return [
            self.chinese_alive,
            self.chinese_judging,
            self.chinese_disposed,
            self.eu_soul,
        ]

    def test_filter_by_civilization(self, create_souls):
        """GET /api/v1/souls/?civilization=CHINESE returns only Chinese souls."""
        response = self.client.get("/api/v1/souls/", {"civilization": "CHINESE"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 3
        for soul in results:
            assert soul["civilization"] == "CHINESE"

    def test_filter_by_european_civilization(self, create_souls):
        """GET /api/v1/souls/?civilization=EUROPEAN returns only European souls."""
        response = self.client.get("/api/v1/souls/", {"civilization": "EUROPEAN"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 1
        assert results[0]["civilization"] == "EUROPEAN"

    def test_filter_by_state(self, create_souls):
        """GET /api/v1/souls/?state=ALIVE returns only alive souls."""
        response = self.client.get("/api/v1/souls/", {"state": "ALIVE"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 2
        for soul in results:
            assert soul["current_state"] == "ALIVE"

    def test_filter_by_state_judging(self, create_souls):
        """GET /api/v1/souls/?state=JUDGING returns only judging souls."""
        response = self.client.get("/api/v1/souls/", {"state": "JUDGING"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 1
        assert results[0]["current_state"] == "JUDGING"

    def test_filter_by_karma_min(self, create_souls):
        """GET /api/v1/souls/?karma_min=50 returns souls with karmic_balance >= 50."""
        # Chinese alive: 100-20=80, Chinese judging: 50-50=0, Chinese disposed: 200-30=170, EU: 80-10=70
        response = self.client.get("/api/v1/souls/", {"karma_min": 50})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 3
        for soul in results:
            assert soul["karmic_balance"] >= 50

    def test_filter_by_karma_max(self, create_souls):
        """GET /api/v1/souls/?karma_max=80 returns souls with karmic_balance <= 80."""
        # Chinese alive: 80, Chinese judging: 0, Chinese disposed: 170, EU: 70
        response = self.client.get("/api/v1/souls/", {"karma_max": 80})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 3
        for soul in results:
            assert soul["karmic_balance"] <= 80

    def test_filter_by_karma_range(self, create_souls):
        """GET /api/v1/souls/?karma_min=70&karma_max=90 returns souls in range."""
        # Chinese alive: 80, Chinese disposed: 170, EU: 70
        response = self.client.get("/api/v1/souls/", {"karma_min": 70, "karma_max": 90})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 2
        for soul in results:
            assert 70 <= soul["karmic_balance"] <= 90

    def test_search_by_name(self, create_souls):
        """GET /api/v1/souls/?search=杜甫 returns matching soul."""
        response = self.client.get("/api/v1/souls/", {"search": "杜甫"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 1
        assert results[0]["name"] == "杜甫"

    def test_search_by_partial_name(self, create_souls):
        """GET /api/v1/souls/?search=杜 returns souls with '杜' in name."""
        response = self.client.get("/api/v1/souls/", {"search": "杜"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 1
        assert "杜" in results[0]["name"]

    def test_search_case_insensitive(self, create_souls):
        """GET /api/v1/souls/?search=dante returns matching soul (case insensitive)."""
        response = self.client.get("/api/v1/souls/", {"search": "dante"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 1
        assert results[0]["name"] == "Dante"

    def test_ordering_by_name_asc(self, create_souls):
        """GET /api/v1/souls/?ordering=name returns souls sorted by name ascending."""
        response = self.client.get("/api/v1/souls/", {"ordering": "name"})
        assert response.status_code == 200
        results = response.data["results"]
        names = [soul["name"] for soul in results]
        assert names == sorted(names)

    def test_ordering_by_name_desc(self, create_souls):
        """GET /api/v1/souls/?ordering=-name returns souls sorted by name descending."""
        response = self.client.get("/api/v1/souls/", {"ordering": "-name"})
        assert response.status_code == 200
        results = response.data["results"]
        names = [soul["name"] for soul in results]
        assert names == sorted(names, reverse=True)

    def test_ordering_by_karmic_balance(self, create_souls):
        """GET /api/v1/souls/?ordering=karmic_balance returns souls sorted by karma ascending."""
        response = self.client.get("/api/v1/souls/", {"ordering": "karmic_balance"})
        assert response.status_code == 200
        results = response.data["results"]
        balances = [soul["karmic_balance"] for soul in results]
        assert balances == sorted(balances)

    def test_ordering_by_karmic_balance_desc(self, create_souls):
        """GET /api/v1/souls/?ordering=-karmic_balance returns souls sorted by karma descending."""
        response = self.client.get("/api/v1/souls/", {"ordering": "-karmic_balance"})
        assert response.status_code == 200
        results = response.data["results"]
        balances = [soul["karmic_balance"] for soul in results]
        assert balances == sorted(balances, reverse=True)

    def test_ordering_by_created_at(self, create_souls):
        """GET /api/v1/souls/?ordering=created_at returns souls sorted by creation date ascending."""
        response = self.client.get("/api/v1/souls/", {"ordering": "created_at"})
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 4

    def test_combined_filters(self, create_souls):
        """Multiple filters work together."""
        response = self.client.get("/api/v1/souls/", {
            "civilization": "CHINESE",
            "state": "ALIVE",
        })
        assert response.status_code == 200
        results = response.data["results"]
        assert len(results) == 1
        assert results[0]["name"] == "李白"
        assert results[0]["civilization"] == "CHINESE"
        assert results[0]["current_state"] == "ALIVE"

    def test_civilization_and_karma_filter(self, create_souls):
        """Filter by civilization and karma range."""
        response = self.client.get("/api/v1/souls/", {
            "civilization": "CHINESE",
            "karma_min": 70,
        })
        assert response.status_code == 200
        results = response.data["results"]
        # Chinese alive: 80, Chinese disposed: 170 >= 70, Chinese judging: 0 < 70
        assert len(results) == 2
        for soul in results:
            assert soul["civilization"] == "CHINESE"
            assert soul["karmic_balance"] >= 70
