"""
Tests for judgment app - Soul judgment proceedings
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from apps.souls.models import Soul, SoulState, Civilization
from apps.tenants.models import Tenant

User = get_user_model()


class JudgmentModelTest(TestCase):
    """Test Judgment model"""

    def setUp(self):
        self.tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        self.soul = Soul.objects.create(
            name="Test Soul",
            current_state=SoulState.ALIVE,
            tenant=self.tenant,
        )

    def test_judgment_str_pending(self):
        from apps.judgment.models import Judgment
        j = Judgment.objects.create(
            soul=self.soul,
            civilization=Civilization.CHINESE,
            court="第一殿",
        )
        self.assertEqual(str(j), "Judgment of Test Soul: PENDING")

    def test_judgment_str_concluded(self):
        from apps.judgment.models import Judgment
        j = Judgment.objects.create(
            soul=self.soul,
            civilization=Civilization.CHINESE,
            court="第一殿",
            verdict="PASSED",
        )
        self.assertEqual(str(j), "Judgment of Test Soul: PASSED")

    def test_judgment_conclude(self):
        from apps.judgment.models import Judgment
        j = Judgment.objects.create(
            soul=self.soul,
            civilization=Civilization.CHINESE,
            court="第一殿",
        )
        self.assertFalse(j.is_final)
        self.assertIsNone(j.verdict)
        j.conclude("PASSED", "Good soul")
        self.assertTrue(j.is_final)
        self.assertEqual(j.verdict, "PASSED")
        self.assertEqual(j.notes, "Good soul")
        self.assertIsNotNone(j.concluded_at)


class JudgmentAPITest(TestCase):
    """Test Judgment API endpoints"""

    def setUp(self):
        self.client = APIClient()
        self.tenant_cn = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        self.tenant_eg = Tenant.objects.create(code="EG_DUAT", display_name="Egyptian Duat")

        self.admin_user = User.objects.create_user(
            username="judge_admin",
            password="admin123",
            role="ADMIN",
            tenant=self.tenant_cn,
        )
        self.judge_user = User.objects.create_user(
            username="judge",
            password="judge123",
            role="JUDGE",
            tenant=self.tenant_cn,
        )
        self.viewer_user = User.objects.create_user(
            username="viewer",
            password="viewer123",
            role="VIEWER",
            tenant=self.tenant_cn,
        )

        self.soul = Soul.objects.create(
            name="Test Soul",
            current_state=SoulState.ALIVE,
            tenant=self.tenant_cn,
        )
        self.soul2 = Soul.objects.create(
            name="Another Soul",
            current_state=SoulState.JUDGING,
            tenant=self.tenant_eg,
        )

        from apps.judgment.models import Judgment
        self.pending_judgment = Judgment.objects.create(
            soul=self.soul,
            civilization=Civilization.CHINESE,
            court="第一殿",
            tenant=self.tenant_cn,
        )
        self.concluded_judgment = Judgment.objects.create(
            soul=self.soul2,
            civilization=Civilization.EGYPTIAN,
            court="Hall of Two Truths",
            verdict="PASSED",
            is_final=True,
            concluded_at="2024-01-01T00:00:00Z",
            tenant=self.tenant_eg,
        )

    def test_list_judgments_admin(self):
        """Admin sees all judgments"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/v1/judgment/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertGreaterEqual(len(data), 2)

    def test_list_judgments_unauthenticated(self):
        """Unauthenticated user cannot list judgments"""
        response = self.client.get("/api/v1/judgment/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_judgment_admin(self):
        """Admin can create judgments"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post("/api/v1/judgment/", {
            "soul": str(self.soul.id),
            "civilization": "CHINESE",
            "court": "第二殿",
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["court"], "第二殿")

    def test_create_judgment_viewer_forbidden(self):
        """Viewer cannot create judgments"""
        self.client.force_authenticate(user=self.viewer_user)
        response = self.client.post("/api/v1/judgment/", {
            "soul": str(self.soul.id),
            "civilization": "CHINESE",
            "court": "第二殿",
        }, format='json')
        self.assertIn(response.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST])

    def test_retrieve_judgment(self):
        """Can retrieve single judgment"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get(f"/api/v1/judgment/{self.pending_judgment.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["court"], "第一殿")

    def test_conclude_judgment_admin(self):
        """Admin can conclude a pending judgment"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post(
            f"/api/v1/judgment/{self.pending_judgment.id}/conclude/",
            {"verdict": "PASSED", "notes": "Good deeds"},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["verdict"], "PASSED")
        self.assertTrue(data["is_final"])

    def test_conclude_already_concluded(self):
        """Cannot conclude an already-final judgment"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post(
            f"/api/v1/judgment/{self.concluded_judgment.id}/conclude/",
            {"verdict": "FAILED"},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_conclude_requires_verdict(self):
        """Conclude requires a valid verdict"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post(
            f"/api/v1/judgment/{self.pending_judgment.id}/conclude/",
            {"notes": "No verdict"},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
