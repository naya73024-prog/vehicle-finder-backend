# Vehicle Finder Backend

Express API with PostgreSQL, JWT authentication, email verification, and password recovery. Use Node.js 24; the deployment image pins this version.

## Local setup

```powershell
npm.cmd ci
Copy-Item .env.example .env
# Edit .env with your database and email settings.
npm.cmd run db:migrate
npm.cmd run dev
```

On Linux/macOS use `npm` instead of `npm.cmd`. `npm start` runs the server; `npm run dev` uses Node's built-in watch mode. There is no separate build step.

The server binds to `0.0.0.0` and the platform's `PORT` (3000 locally). Configuration errors exit with status 1 and a `server.startup_failed` log instead of silently hanging. Email setup never makes an external request during startup.

## Environment variables

Start from `.env.example`. Set these in the hosting dashboard for production:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection URL supplied by the database provider |
| `JWT_SECRET` | A random secret containing at least 32 bytes |
| `PUBLIC_BASE_URL` | Public HTTPS backend URL, without a trailing slash |
| `PASSWORD_RESET_URL` | Existing frontend HTTPS reset-password page |
| `CORS_ORIGINS` | Comma-separated frontend origins, e.g. `https://app.example.com` |
| `EMAIL_PROVIDER` | `resend` (HTTPS), or `smtp` |
| `EMAIL_FROM` | Sender address on a verified domain |
| `RESEND_API_KEY` | Required when using Resend |

`RENDER_EXTERNAL_URL` or `RAILWAY_PUBLIC_DOMAIN` can supply the backend URL when `PUBLIC_BASE_URL` is unset. The password-reset frontend must read `?token=...` and POST `{ "token": "...", "newPassword": "..." }` to `/api/auth/reset-password`. This repository contains the API, so configure the frontend URL explicitly in production.

For SMTP, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and optionally `SMTP_SECURE` (`true` for implicit TLS, usually port 465). SMTP connections have bounded timeouts. Development can use `EMAIL_PROVIDER=disabled`; attempts to send then return 503 instead of pretending to deliver mail. No temporary Ethereal accounts are created.

Render free web services block outbound SMTP ports 25, 465 and 587. Use the HTTPS provider on that plan. Resend requires a valid API key and a permitted sender/domain. See [Render's free-service limitations](https://render.com/docs/free) and [Resend's sending API](https://resend.com/docs/api-reference/emails/send-email).

Instead of `DATABASE_URL`, the app accepts `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, or their `PG*` equivalents. `DB_POOL_MAX` defaults to 10 per instance; account for all replicas against your database connection limit. Connection/query timeouts default to 5000ms (`DB_TIMEOUT_MS`).

Leave `DB_SSL` unset to honor the database URL's SSL options. Set `DB_SSL=true` to enforce certificate verification, optionally providing `DB_SSL_CA` for a private certificate authority; this overrides URL SSL options. Use `DB_SSL=false` only when the database provider documents a trusted non-TLS connection, such as a private network. Do not disable certificate validation to hide TLS failures. See [node-postgres SSL settings](https://node-postgres.com/features/ssl).

Do not commit real environment credentials. `.gitignore` excludes new `.env` files, but files already tracked by Git remain tracked. If a real `.env` was committed, rotate those credentials and remove it from tracking separately; ignoring it does not remove it from history.

## Railway

Connect the repository to the existing backend service and attach PostgreSQL. Set `DATABASE_URL` to the PostgreSQL service's variable reference, then set the production variables above. Generate a public domain for verification links.

The included Dockerfile runs migrations and starts Node as the final process, so no custom start command is required. Clear any old start-command override that bypasses migrations, or use `npm run db:migrate && node server.js`. Set the healthcheck path to `/health` and its timeout to 120 seconds. Let Railway supply `PORT`.

No `railway.json` is required. Railway's legacy Config as Code is deprecated; configure the existing service in its dashboard or import its configuration using the current IaC workflow. See [Railway configuration](https://docs.railway.com/infrastructure-as-code) and [healthchecks](https://docs.railway.com/deployments/healthchecks).

## Render

For a new service, use the included `render.yaml` Blueprint and fill in its prompted environment variables. It expects an existing PostgreSQL URL; it does not provision a database. For an existing native Node service, set:

| Setting | Value |
| --- | --- |
| Node version | `24` |
| Build command | `npm ci --omit=dev` |
| Start command | `npm run db:migrate && npm start` |
| Health check | `/health` |

Alternatively deploy the Dockerfile, which already runs migrations. Set all production variables from the table above. Do not hardcode `PORT`; Render supplies it. See [Render web-service configuration](https://render.com/docs/web-services).

## Database migrations

`npm run db:migrate` applies versioned SQL once, inside a transaction with a lock to serialize concurrent deployments. It creates a fresh `users` table or adds missing optional auth/timestamp columns to an existing table without removing records or changing primary keys. Core columns `user_id`, `full_name`, `email`, and `password_hash` must already have compatible types on existing installations.

The normalized email uniqueness index intentionally fails if an old database already contains case-insensitive duplicate emails. The transaction rolls back; resolve those records deliberately before redeploying. Inspect `database.migration_failed` logs for SQL codes, such as `23505` (duplicates), `42703` (missing column), or `42501` (insufficient permissions).

## Logs and errors

Logs are JSON lines written to stdout/stderr for Railway and Render to collect. Each HTTP response includes `X-Request-Id`. Error responses use:

```json
{
  "message": "Database is unavailable or its schema is not ready",
  "code": "DATABASE_NOT_READY",
  "requestId": "example-request-id"
}
```

Search hosting logs by the `requestId`. `request.failed` includes the method, route, status, error code, stack with file/line, and nested cause. `request.completed` includes status and duration. Startup, pool, mail delivery, migration, shutdown, and fatal process errors have distinct event names. Client responses hide internal stacks and database details. Request bodies, authorization headers, query tokens, and mail contents are not logged; known environment secrets and credential URLs are redacted from error messages.

`GET /health` and `/api/db-check` return 200 only when the database is reachable and the required user columns exist; otherwise they return 503. `/health/live` checks the running HTTP process only. SMTP/Resend availability is checked during actual sends, with failures logged through the request error handler.

If registration returns `VERIFICATION_EMAIL_FAILED`, the account already exists. After fixing email delivery, POST `{ "email": "user@example.com" }` to `/api/auth/resend-verification`. This also replaces expired verification links. Reset and verification tokens expire after 15 minutes and are single-use; only their hashes are stored. Existing JWTs expire after one hour and are not immediately revoked by a password change.

## Verification

```powershell
npm.cmd test
npm.cmd audit
# Optional: use a separate test PostgreSQL database, never your production database.
$env:TEST_DATABASE_URL = 'postgresql://postgres:password@localhost:5432/vehicle_finder_test'
npm.cmd test
```

Without `TEST_DATABASE_URL`, the PostgreSQL integration test is skipped. With it, the test creates a uniquely named schema, applies migrations twice, exercises the complete account lifecycle over HTTP, and removes its own schema afterward. HTTP tests also cover malformed input, safe errors, CORS, JWT failures, unavailable dependencies, and email retry behavior.
