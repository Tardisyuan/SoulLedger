import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const loginDuration = new Trend("login_duration");
const apiDuration = new Trend("api_duration");

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000/api/v1";
const USERNAME = __ENV.TEST_USERNAME || "admin";
const PASSWORD = __ENV.TEST_PASSWORD || "admin123";

export const options = {
  stages: [
    { duration: "30s", target: 10 },  // ramp up
    { duration: "1m", target: 10 },   // steady state
    { duration: "30s", target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],  // 95% under 500ms
    errors: ["rate<0.1"],              // error rate under 10%
  },
};

function getAuthToken() {
  const loginRes = http.post(`${BASE_URL}/auth/login/`, JSON.stringify({
    username: USERNAME,
    password: PASSWORD,
  }), { headers: { "Content-Type": "application/json" } });

  loginDuration.add(loginRes.timings.duration);

  const success = check(loginRes, {
    "login status 200": (r) => r.status === 200,
    "has access token": (r) => JSON.parse(r.body).access !== undefined,
  });

  errorRate.add(!success);
  return success ? JSON.parse(loginRes.body).access : null;
}

export default function () {
  const token = getAuthToken();
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // Test core API endpoints
  const endpoints = [
    "/souls/",
    "/judgments/",
    "/karma/",
    "/reincarnation/",
    "/organizations/",
  ];

  for (const endpoint of endpoints) {
    const res = http.get(`${BASE_URL}${endpoint}`, { headers });
    apiDuration.add(res.timings.duration);

    const success = check(res, {
      [`${endpoint} status 200`]: (r) => r.status === 200,
      [`${endpoint} has results`]: (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.results !== undefined || Array.isArray(body);
        } catch {
          return false;
        }
      },
    });

    errorRate.add(!success);
  }

  sleep(1);
}
