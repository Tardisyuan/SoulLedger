# Performance Tests

## Prerequisites
Install k6: https://k6.io/docs/getting-started/installation/

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Running Tests

```bash
# Smoke test (quick validation)
k6 run scripts/perf/smoke-test.js

# Load test (full performance test)
k6 run scripts/perf/load-test.js

# With custom environment
BASE_URL=http://your-api:8000/api/v1 TEST_USERNAME=admin TEST_PASSWORD=secret k6 run scripts/perf/load-test.js
```

## Thresholds
- **Smoke**: p95 < 1000ms
- **Load**: p95 < 500ms, error rate < 10%
