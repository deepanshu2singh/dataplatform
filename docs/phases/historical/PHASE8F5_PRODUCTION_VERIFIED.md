# Phase 8F.5 — Production Verified Checkpoint

Checkpoint status: **PASS**

This checkpoint represents the Phase 8F full source baseline with the subsequent Phase 8F.2, 8F.3, and 8F.4 production patches applied, plus the verified Phase 8F.5 smoke-test record.

## Source lineage

1. `phase8F-current-deployment.zip` — full source baseline
2. `phase8F2-production-frontend.zip`
3. `phase8F2-production-frontend-health-fix.zip`
4. `phase8F2-runtime-pid-fix.zip`
5. `phase8F3-production-backend.zip`
6. `phase8F4-production-compose.zip`
7. Phase 8F.5 verification record and local Caddy example added in this checkpoint

## Verified production topology

- Browser origin: `https://app.example.test`
- Local TLS edge: Caddy with an internal CA
- Caddy proxies to production frontend on Docker network `dataplatform-prod_edge`
- Production frontend publishes `127.0.0.1:8080->8080/tcp`
- Backend remains internal-only on `8000/tcp`
- PostgreSQL remains internal-only on `5432/tcp`
- Migration job exited successfully with code 0
- Backend, frontend, and PostgreSQL health checks passed

## Phase 8F.5 smoke-test results

- Trusted HTTPS request to `/api/v1/openapi.json`: **200**
- Account registration and automatic login: **PASS**
- `/api/v1/auth/me`: **200**
- Session cookie: **HttpOnly = true, Secure = true, SameSite = Lax**
- Invalid Origin POST: **403**
- Valid production Origin POST: **204**
- Dataset upload: **PASS** (5 rows / 5 columns)
- SQL query execution: **200**, correct aggregation result
- Notebook creation: **201**
- Dashboard widget preview: **PASS**
- Dashboard creation: **201**
- Saved widget execution: **200**
- Manual Refresh Data widget execution: **200**
- Logout: **204**
- Session cookie removed after logout: **PASS**
- Protected dashboard after logout redirects to login: **PASS**

## Test dataset used

Columns:

- `order_id`
- `product`
- `region`
- `quantity`
- `revenue`

Aggregation used for SQL/notebook/dashboard verification:

```sql
SELECT
    product,
    SUM(revenue) AS total_revenue
FROM dataset
GROUP BY product
ORDER BY total_revenue DESC;
```

Expected result:

| product | total_revenue |
| --- | ---: |
| Laptop | 3600.49 |
| Monitor | 899.97 |
| Keyboard | 374.95 |
| Mouse | 239.92 |

## Security / sanitation

This checkpoint intentionally does **not** contain:

- `production.env`
- passwords or application secrets
- session cookies or tokens
- Caddy CA certificates/private keys
- PostgreSQL volumes or database runtime data
- uploaded runtime datasets
- `node_modules`
- virtual environments
- caches/build outputs
- historical nested checkpoint ZIP archives

Use `production.env.example` to create a new environment-specific `production.env`.

For local trusted HTTPS testing, `Caddyfile.local.example` documents the tested proxy configuration. Generate a fresh local CA/certificate for each environment rather than storing certificates or keys in source control/checkpoints.
