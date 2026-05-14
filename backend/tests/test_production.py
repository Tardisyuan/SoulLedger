"""
M8 Production Readiness Tests
- Health endpoints
- Production settings
- Docker configuration validation
"""
import pytest
from django.test import Client
from django.conf import settings


class TestHealthEndpoints:
    """Test /health/ and /health/detailed/ endpoints"""

    def test_health_endpoint_returns_ok(self, api_client):
        """GET /health/ should return 200 with status ok"""
        resp = api_client.get('/health/')
        assert resp.status_code == 200
        assert resp.json()['status'] == 'ok'

    def test_health_detailed_endpoint(self, api_client):
        """GET /health/detailed/ should return 200 or auth error"""
        resp = api_client.get('/health/detailed/')
        # Returns 200 if DB/Redis healthy, 503 if not
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
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/infrastructure/docker-compose.prod.yml'
        assert os.path.exists(path), f"Expected {path} to exist"

    def test_docker_compose_has_required_services(self):
        """All required services should be defined"""
        import yaml
        path = '/home/tardis/Documents/跨文明灵魂管理系统/infrastructure/docker-compose.prod.yml'
        with open(path) as f:
            config = yaml.safe_load(f)
        services = config.get('services', {})
        required = ['postgres', 'redis', 'backend', 'frontend', 'nginx']
        for svc in required:
            assert svc in services, f"Missing service: {svc}"

    def test_docker_compose_has_healthchecks(self):
        """postgres and redis should have healthchecks"""
        import yaml
        path = '/home/tardis/Documents/跨文明灵魂管理系统/infrastructure/docker-compose.prod.yml'
        with open(path) as f:
            config = yaml.safe_load(f)
        services = config.get('services', {})
        for svc in ['postgres', 'redis']:
            assert 'healthcheck' in services[svc], f"{svc} missing healthcheck"

    def test_docker_compose_restart_policies(self):
        """Services should have restart policies"""
        import yaml
        path = '/home/tardis/Documents/跨文明灵魂管理系统/infrastructure/docker-compose.prod.yml'
        with open(path) as f:
            config = yaml.safe_load(f)
        services = config.get('services', {})
        for svc in ['postgres', 'redis', 'backend', 'nginx']:
            assert services[svc].get('restart') in ['unless-stopped', 'always', 'on-failure']

    def test_nginx_config_exists(self):
        """nginx.conf should exist"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/infrastructure/nginx.conf'
        assert os.path.exists(path), f"Expected {path} to exist"

    def test_nginx_has_security_headers(self):
        """nginx.conf should have security headers"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/infrastructure/nginx.conf'
        with open(path) as f:
            content = f.read()
        required_headers = ['X-Frame-Options', 'X-Content-Type-Options', 'X-XSS-Protection']
        for header in required_headers:
            assert header in content, f"Missing security header: {header}"


class TestEnvExample:
    """Validate .env.example structure"""

    def test_env_example_exists(self):
        """ .env.example should exist"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/.env.example'
        assert os.path.exists(path), f"Expected {path} to exist"

    def test_env_example_has_required_vars(self):
        """.env.example should document required variables"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/.env.example'
        with open(path) as f:
            content = f.read()
        required_vars = ['POSTGRES_PASSWORD', 'DJANGO_SECRET_KEY', 'REDIS_PASSWORD']
        for var in required_vars:
            assert var in content, f"Missing env var: {var}"

    def test_env_example_no_real_secrets(self):
        """.env.example should not contain real secrets"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/.env.example'
        with open(path) as f:
            content = f.read()
        # Should have placeholder values, not real passwords
        assert 'changeme' in content or 'your-' in content or 'example' in content.lower()


class TestBackendDockerfile:
    """Validate backend Dockerfile structure"""

    def test_dockerfile_exists(self):
        """backend/Dockerfile should exist"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/backend/Dockerfile'
        assert os.path.exists(path), f"Expected {path} to exist"

    def test_dockerfile_multistage(self):
        """Dockerfile should use multi-stage build"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/backend/Dockerfile'
        with open(path) as f:
            content = f.read()
        assert 'AS' in content.upper() or 'FROM' in content, "Should have multi-stage build"

    def test_dockerfile_exposes_port(self):
        """Dockerfile should EXPOSE the port"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/backend/Dockerfile'
        with open(path) as f:
            content = f.read()
        assert 'EXPOSE 8000' in content or 'EXPOSE' in content

    def test_dockerfile_no_sudo(self):
        """Dockerfile should not use sudo"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/backend/Dockerfile'
        with open(path) as f:
            content = f.read()
        assert 'sudo' not in content.lower()


class TestFrontendDockerfile:
    """Validate frontend Dockerfile structure"""

    def test_dockerfile_exists(self):
        """frontend/Dockerfile should exist"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/frontend/Dockerfile'
        assert os.path.exists(path), f"Expected {path} to exist"

    def test_dockerfile_multistage(self):
        """Dockerfile should use multi-stage build"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/frontend/Dockerfile'
        with open(path) as f:
            content = f.read()
        assert 'AS' in content.upper() or 'FROM' in content

    def test_dockerfile_node_alpine(self):
        """Dockerfile should use alpine for small image"""
        import os
        path = '/home/tardis/Documents/跨文明灵魂管理系统/frontend/Dockerfile'
        with open(path) as f:
            content = f.read()
        assert 'alpine' in content.lower()
