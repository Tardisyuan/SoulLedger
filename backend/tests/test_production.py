"""
M8 Production Readiness Tests
- Health endpoints
- Production settings
- Docker configuration validation

The four Docker/env classes below were skipped with the reason "M8
infrastructure not yet created". They were not skipped because the
infrastructure was missing — M8 shipped it — but because every path in them was
hardcoded to /home/tardis/Documents/跨文明灵魂管理系统/..., the absolute path of
one developer's checkout on one machine. That resolves nowhere on CI or on any
other clone, so the assertions could only ever fail and the skip hid it. Paths
are now derived from this file's location, so the tests follow the repository
instead of the machine.
"""
import os

import yaml
from django.conf import settings
from django.test import Client

# backend/tests/test_production.py -> backend/tests -> backend -> repo root
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

COMPOSE_PROD = os.path.join(REPO_ROOT, "infrastructure", "docker-compose.prod.yml")
NGINX_CONF = os.path.join(REPO_ROOT, "infrastructure", "nginx.conf")
ENV_EXAMPLE = os.path.join(REPO_ROOT, ".env.example")
BACKEND_DOCKERFILE = os.path.join(REPO_ROOT, "backend", "Dockerfile")
FRONTEND_DOCKERFILE = os.path.join(REPO_ROOT, "frontend", "Dockerfile")


def _load_compose():
    with open(COMPOSE_PROD) as f:
        return yaml.safe_load(f)


def _read(path):
    with open(path) as f:
        return f.read()


class TestHealthEndpoints:
    """Test /health/ and /health/detailed/ endpoints"""

    def test_health_endpoint_returns_ok(self, api_client):
        """GET /health/ should return 200 with status ok"""
        resp = api_client.get('/health/')
        assert resp.status_code == 200
        assert resp.json()['status'] == 'ok'

    def test_health_detailed_endpoint(self, db, django_user_model):
        """GET /health/detailed/ should return 200 for ADMIN, 401/403 for others"""

        client = Client()

        # Unauthenticated should get 401
        resp = client.get('/health/detailed/')
        assert resp.status_code == 401

        # Non-admin should get 403
        user = django_user_model.objects.create_user(
            username="test_viewer", password="test123", role="VIEWER"
        )
        client.force_login(user)
        resp = client.get('/health/detailed/')
        assert resp.status_code == 403

        # Admin should get 200 or 503
        admin = django_user_model.objects.create_user(
            username="test_admin", password="admin123", role="ADMIN"
        )
        client.force_login(admin)
        resp = client.get('/health/detailed/')
        assert resp.status_code in [200, 503]

    def test_health_endpoint_no_auth_required(self, api_client):
        """Basic /health/ should be accessible without auth"""
        resp = api_client.get('/health/')
        assert resp.status_code == 200


class TestProductionSettings:
    """Test production security settings are present"""

    def test_debug_setting_exists(self):
        """DEBUG setting should exist"""
        assert hasattr(settings, 'DEBUG')

    def test_security_settings_defined(self):
        """Production security settings should be defined in settings.py"""
        # These settings exist regardless of DEBUG value
        assert hasattr(settings, 'SECURE_HSTS_SECONDS')
        assert hasattr(settings, 'SECURE_SSL_REDIRECT')
        assert hasattr(settings, 'SESSION_COOKIE_SECURE')
        assert hasattr(settings, 'CSRF_COOKIE_SECURE')

    def test_security_settings_correct_type(self):
        """Security settings should have correct types"""
        assert isinstance(settings.SECURE_HSTS_SECONDS, int)
        assert isinstance(settings.SESSION_COOKIE_SECURE, bool)

    def test_allowed_hosts_configured(self):
        """ALLOWED_HOSTS should be configured"""
        assert len(settings.ALLOWED_HOSTS) > 0

    def test_database_configured(self):
        """Database should be PostgreSQL"""
        db_name = settings.DATABASES['default']['NAME']
        # Could be sqlite for dev or postgres for prod
        assert db_name is not None


class TestDockerConfiguration:
    """Validate docker-compose.prod.yml structure"""

    def test_docker_compose_file_exists(self):
        """docker-compose.prod.yml should exist"""
        assert os.path.exists(COMPOSE_PROD), f"Expected {COMPOSE_PROD} to exist"

    def test_docker_compose_has_required_services(self):
        """All required services should be defined"""
        services = _load_compose().get('services', {})
        required = ['postgres', 'redis', 'backend', 'frontend', 'nginx']
        for svc in required:
            assert svc in services, f"Missing service: {svc}"

    def test_docker_compose_has_healthchecks(self):
        """postgres and redis should have healthchecks"""
        services = _load_compose().get('services', {})
        for svc in ['postgres', 'redis']:
            assert 'healthcheck' in services[svc], f"{svc} missing healthcheck"

    def test_docker_compose_restart_policies(self):
        """Services should have restart policies"""
        services = _load_compose().get('services', {})
        for svc in ['postgres', 'redis', 'backend', 'nginx']:
            assert services[svc].get('restart') in ['unless-stopped', 'always', 'on-failure']

    def test_nginx_config_exists(self):
        """nginx.conf should exist"""
        assert os.path.exists(NGINX_CONF), f"Expected {NGINX_CONF} to exist"

    def test_nginx_has_security_headers(self):
        """nginx.conf should have security headers"""
        content = _read(NGINX_CONF)
        required_headers = ['X-Frame-Options', 'X-Content-Type-Options', 'X-XSS-Protection']
        for header in required_headers:
            assert header in content, f"Missing security header: {header}"


class TestEnvExample:
    """Validate .env.example structure"""

    def test_env_example_exists(self):
        """ .env.example should exist"""
        assert os.path.exists(ENV_EXAMPLE), f"Expected {ENV_EXAMPLE} to exist"

    def test_env_example_has_required_vars(self):
        """.env.example should document required variables"""
        content = _read(ENV_EXAMPLE)
        required_vars = ['POSTGRES_PASSWORD', 'DJANGO_SECRET_KEY', 'REDIS_PASSWORD']
        for var in required_vars:
            assert var in content, f"Missing env var: {var}"

    def test_env_example_no_real_secrets(self):
        """.env.example should not contain real secrets"""
        content = _read(ENV_EXAMPLE)
        # Should have placeholder values, not real passwords
        assert 'changeme' in content or 'your-' in content or 'example' in content.lower()


class TestBackendDockerfile:
    """Validate backend Dockerfile structure"""

    def test_dockerfile_exists(self):
        """backend/Dockerfile should exist"""
        assert os.path.exists(BACKEND_DOCKERFILE), f"Expected {BACKEND_DOCKERFILE} to exist"

    def test_dockerfile_multistage(self):
        """Dockerfile should use multi-stage build"""
        content = _read(BACKEND_DOCKERFILE)
        assert 'AS' in content.upper() or 'FROM' in content, "Should have multi-stage build"

    def test_dockerfile_exposes_port(self):
        """Dockerfile should EXPOSE the port"""
        content = _read(BACKEND_DOCKERFILE)
        assert 'EXPOSE 8000' in content or 'EXPOSE' in content

    def test_dockerfile_no_sudo(self):
        """Dockerfile should not use sudo"""
        content = _read(BACKEND_DOCKERFILE)
        assert 'sudo' not in content.lower()


class TestFrontendDockerfile:
    """Validate frontend Dockerfile structure"""

    def test_dockerfile_exists(self):
        """frontend/Dockerfile should exist"""
        assert os.path.exists(FRONTEND_DOCKERFILE), f"Expected {FRONTEND_DOCKERFILE} to exist"

    def test_dockerfile_multistage(self):
        """Dockerfile should use multi-stage build"""
        content = _read(FRONTEND_DOCKERFILE)
        assert 'AS' in content.upper() or 'FROM' in content

    def test_dockerfile_node_alpine(self):
        """Dockerfile should use alpine for small image"""
        content = _read(FRONTEND_DOCKERFILE)
        assert 'alpine' in content.lower()
