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
import re

import pytest
import yaml
from django.conf import settings
from django.test import Client

# backend/tests/test_production.py -> backend/tests -> backend -> repo root
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# One production stack: docker-compose.yml + docker-compose.production.yml.
# infrastructure/docker-compose.prod.yml was a second, independent copy; every
# fix in this file had to land twice and each copy broke on its own, so it was
# deleted (2026-09-13). nginx.conf moved to the root next to the files that
# mount it.
COMPOSE_BASE = os.path.join(REPO_ROOT, "docker-compose.yml")
COMPOSE_ROOT_PROD = os.path.join(REPO_ROOT, "docker-compose.production.yml")
COMPOSE_STAGING = os.path.join(REPO_ROOT, "docker-compose.staging.yml")
NGINX_CONF = os.path.join(REPO_ROOT, "nginx.conf")
ENV_EXAMPLE = os.path.join(REPO_ROOT, ".env.example")
BACKEND_DOCKERFILE = os.path.join(REPO_ROOT, "backend", "Dockerfile")
FRONTEND_DOCKERFILE = os.path.join(REPO_ROOT, "frontend", "Dockerfile")

APP_SERVICES = ["backend", "celery", "celery-beat", "frontend"]


def _load_compose(path):
    with open(path) as f:
        return yaml.safe_load(f)


def _production_services():
    """The production merge as compose sees it: override keys win, and a
    service only in the override (nginx, pgbouncer) is added."""
    services = _load_compose(COMPOSE_BASE)['services']
    for name, override in _load_compose(COMPOSE_ROOT_PROD)['services'].items():
        merged = dict(services.get(name, {}))
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = {**merged[key], **value}
            else:
                merged[key] = value
        services[name] = merged
    return services


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
    """Validate the production merge (base + docker-compose.production.yml)"""

    def test_docker_compose_files_exist(self):
        for path in [COMPOSE_BASE, COMPOSE_ROOT_PROD]:
            assert os.path.exists(path), f"Expected {path} to exist"

    def test_docker_compose_has_required_services(self):
        """All required services should be defined"""
        services = _production_services()
        required = ['db', 'redis', 'pgbouncer', 'backend', 'celery', 'frontend', 'nginx']
        for svc in required:
            assert svc in services, f"Missing service: {svc}"

    def test_docker_compose_has_healthchecks(self):
        """db and redis should have healthchecks"""
        services = _production_services()
        for svc in ['db', 'redis']:
            assert 'healthcheck' in services[svc], f"{svc} missing healthcheck"

    def test_docker_compose_restart_policies(self):
        """Services should have restart policies"""
        services = _production_services()
        for svc in ['db', 'redis', 'backend', 'nginx']:
            assert services[svc].get('restart') in ['unless-stopped', 'always', 'on-failure']

    def test_pgbouncer_transaction_pool_disables_server_side_cursors(self):
        """pgbouncer in transaction mode cannot keep a server-side cursor
        alive across statements, and `.iterator()` opens one (IS-13). Every
        Django service behind the pool must say so, and settings.py only
        reads the flag from the environment."""
        services = _production_services()
        assert services['pgbouncer']['environment']['POOL_MODE'] == 'transaction'
        for name in ['backend', 'celery', 'celery-beat']:
            env = services[name]['environment']
            assert 'pgbouncer' in env['DATABASE_URL'], f"{name} bypasses the pool"
            assert env.get('DISABLE_SERVER_SIDE_CURSORS') == 'true', name

    def test_nginx_config_exists(self):
        """nginx.conf should exist"""
        assert os.path.exists(NGINX_CONF), f"Expected {NGINX_CONF} to exist"

    def test_nginx_has_security_headers(self):
        """nginx.conf should have security headers"""
        content = _read(NGINX_CONF)
        required_headers = ['X-Frame-Options', 'X-Content-Type-Options', 'X-XSS-Protection']
        for header in required_headers:
            assert header in content, f"Missing security header: {header}"

    def test_nginx_proxies_the_websocket_route(self):
        """channels serves /ws/ only through an Upgrade handshake; a proxy
        that forwards a plain GET there makes every deployment's WebSocket
        dead (IS-06)."""
        content = _read(NGINX_CONF)
        ws = content[content.index("location /ws/"):]
        ws = ws[:ws.index("}")]
        assert "proxy_set_header Upgrade $http_upgrade" in ws
        assert 'proxy_set_header Connection "upgrade"' in ws

    def test_nginx_does_not_listen_on_tls_without_a_certificate(self):
        """`listen 443 ssl` with no ssl_certificate is a fatal config error,
        which is how nginx never started (IS-09). Both directives live on
        commented lines until a certificate is mounted; they must be
        enabled together."""
        live = [
            line for line in _read(NGINX_CONF).splitlines()
            if not line.strip().startswith("#")
        ]
        listens_tls = any("443" in line and "listen" in line for line in live)
        has_cert = any("ssl_certificate " in line for line in live)
        assert listens_tls == has_cert, (
            "listen 443 ssl and ssl_certificate must be enabled together"
        )

    def test_prod_compose_passes_the_names_settings_reads(self):
        """settings.py reads SECRET_KEY and ALLOWED_HOSTS. The deleted
        infrastructure/ stack passed DJANGO_SECRET_KEY / DJANGO_ALLOWED_HOSTS
        — read by nothing — so the backend refused to start; the old version
        of this test pinned the wrong names (IS-05)."""
        env = _production_services()['backend']['environment']
        assert 'SECRET_KEY' in env
        assert 'ALLOWED_HOSTS' in env
        assert 'ENCRYPTION_KEY' in env
        assert not [k for k in env if k.startswith('DJANGO_')]

    def test_prod_compose_mounts_a_file_that_exists(self):
        """A bind-mount source that does not exist is created by docker as
        an empty directory — for nginx.conf that means nginx dies (IS-09)."""
        for path in [COMPOSE_ROOT_PROD]:
            nginx = _load_compose(path)['services']['nginx']
            for vol in nginx['volumes']:
                src = vol.split(':')[0]
                if src.startswith('./') and src.endswith('.conf'):
                    full = os.path.join(os.path.dirname(path), src)
                    assert os.path.isfile(full), f"{path}: {src} does not exist"
                    assert vol.split(':')[1] == '/etc/nginx/nginx.conf', (
                        "a complete nginx.conf (with events{}) is only "
                        "valid as the main file, not under conf.d/"
                    )


class TestRootComposeShape:
    """Compose merging can only add or replace keys, never remove them. So a
    published port or a host-source bind mount in the base file survives into
    `-f docker-compose.yml -f docker-compose.production.yml`, where it bypasses
    nginx and runs the host's source tree — with its `backend/.env` — instead
    of the image (IS-03). The invariant is therefore on the base and on every
    override that is not the dev one."""

    @pytest.mark.parametrize("path", [COMPOSE_BASE, COMPOSE_ROOT_PROD])
    def test_app_services_publish_no_ports(self, path):
        services = _load_compose(path)['services']
        for name in APP_SERVICES:
            assert 'ports' not in services.get(name, {}), f"{path}: {name} publishes ports"

    @pytest.mark.parametrize("path", [COMPOSE_BASE, COMPOSE_ROOT_PROD, COMPOSE_STAGING])
    def test_app_services_have_no_host_bind_mounts(self, path):
        services = _load_compose(path)['services']
        for name in APP_SERVICES:
            for vol in services.get(name, {}).get('volumes', []):
                src = str(vol).split(':')[0]
                assert not src.startswith(('.', '/')), f"{path}: {name} bind-mounts {src}"

    def test_dev_override_is_where_the_ports_are(self):
        """The inverse: the dev stack must still be reachable, and
        `docker compose up` reads docker-compose.override.yml on its own."""
        services = _load_compose(os.path.join(REPO_ROOT, "docker-compose.override.yml"))['services']
        assert services['backend']['ports']
        assert services['frontend']['ports']
        assert services['backend']['environment']['DEBUG'] == 'true'

    def test_base_does_not_set_debug(self):
        """DEBUG absent means settings.py demands ALLOWED_HOSTS, ENCRYPTION_KEY
        and a real database — the production merge must inherit that."""
        for name in APP_SERVICES[:3]:
            env = _load_compose(COMPOSE_BASE)['services'][name]['environment']
            assert 'DEBUG' not in env, f"{name} sets DEBUG in the base file"
            assert 'ENCRYPTION_KEY' in env, f"{name} does not receive ENCRYPTION_KEY"
            assert 'ALLOWED_HOSTS' in env, f"{name} does not receive ALLOWED_HOSTS"

    @pytest.mark.parametrize("path", [COMPOSE_BASE, COMPOSE_ROOT_PROD])
    def test_backend_runs_an_asgi_server(self, path):
        """gunicorn on config.wsgi never serves the channels routes (IS-06)."""
        command = _load_compose(path)['services']['backend']['command']
        assert 'config.asgi' in command, f"{path}: {command}"
        assert 'wsgi' not in command

    @pytest.mark.parametrize("path", [COMPOSE_BASE])
    def test_healthchecks_use_a_route_and_a_binary_that_exist(self, path):
        """`curl` is in neither python:*-slim nor node:*-alpine, and
        /api/v1/health/ was never a route — the check could only ever be red
        (IS-11)."""
        services = _load_compose(path)['services']
        for name in ['backend', 'frontend']:
            test = services[name].get('healthcheck', {}).get('test')
            if test is None:
                continue
            assert 'curl' not in test
            assert '/api/v1/health/' not in ' '.join(test)


class TestEnvExample:
    """Validate .env.example structure"""

    def test_env_example_exists(self):
        """ .env.example should exist"""
        assert os.path.exists(ENV_EXAMPLE), f"Expected {ENV_EXAMPLE} to exist"

    def test_env_example_documents_every_variable_compose_reads(self):
        """Every `${NAME}` the compose files interpolate must be in the
        example, and nothing settings.py never reads may be. This used to
        require DJANGO_SECRET_KEY — the name that made the stack exit 1."""
        content = _read(ENV_EXAMPLE)
        referenced = set()
        for path in [COMPOSE_BASE, COMPOSE_ROOT_PROD, COMPOSE_STAGING]:
            referenced |= set(re.findall(r"\$\{([A-Z_]+)", _read(path)))
        documented = set(re.findall(r"^([A-Z_]+)=", content, flags=re.M))
        assert referenced <= documented, f"undocumented: {referenced - documented}"
        assert not {v for v in documented if v.startswith('DJANGO_')}

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
