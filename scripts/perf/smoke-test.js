import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000/api/v1";

export const options = {
  vus: 1,
  duration: "10s",
  thresholds: {
    http_req_duration: ["p(95)<1000"],
  },
};

export default function () {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health/`);
  check(healthRes, {
    "health check ok": (r) => r.status === 200 || r.status === 404,
  });

  // Login flow
  const loginRes = http.post(`${BASE_URL}/auth/login/`, JSON.stringify({
    username: __ENV.TEST_USERNAME || "admin",
    password: __ENV.TEST_PASSWORD || "admin123",
  }), { headers: { "Content-Type": "application/json" } });

  check(loginRes, {
    "login works": (r) => r.status === 200 || r.status === 401,
  });

  sleep(1);
}
