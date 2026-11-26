const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig, loadDatabaseConfig } = require("../config/env");
const { createPool } = require("../config/db");
const { createEmailService } = require("../services/emailService");
const logger = require("../utils/logger");
const env = { DATABASE_URL: "postgresql://postgres:test@localhost:5432/test", JWT_SECRET: "test-secret-longer-than-thirty-two-bytes" };

test("migrations validate database configuration independently of application secrets", () => {
  assert.equal(loadDatabaseConfig({ DATABASE_URL: env.DATABASE_URL }).dbPort, 5432);
  assert.throws(() => loadDatabaseConfig({ DATABASE_URL: env.DATABASE_URL, DB_SSL: "" }));
  assert.throws(() => loadDatabaseConfig({ DATABASE_URL: env.DATABASE_URL, DB_PORT: "not-a-port" }));
  assert.throws(() => loadDatabaseConfig({}));
});

test("configuration supports platform ports, domain variables, and explicit DB credentials", () => {
  assert.equal(loadConfig(env).port, 3000);
  assert.equal(loadConfig({ ...env, PORT: "10000", RAILWAY_PUBLIC_DOMAIN: "api.up.railway.app" }).baseUrl, "https://api.up.railway.app");
  assert.equal(loadConfig({ ...env, RENDER_EXTERNAL_URL: "https://api.onrender.com" }).baseUrl, "https://api.onrender.com");
  assert.equal(loadConfig({ JWT_SECRET: env.JWT_SECRET, DB_HOST: "localhost", DB_NAME: "test", DB_USER: "postgres", DB_PASSWORD: "test" }).dbPort, 5432);
  assert.equal(loadConfig({ JWT_SECRET: env.JWT_SECRET, PGHOST: "localhost", PGDATABASE: "test", PGUSER: "postgres", PGPASSWORD: "test" }).dbPort, 5432);
});

test("configuration rejects missing secrets, malformed ports and incomplete production setup", () => {
  for (const override of [{ JWT_SECRET: "short" }, { DATABASE_URL: "https://example.com" }, { PORT: "0" }, { PORT: "65536" }, { PORT: "3000abc" },
    { DB_SSL: "yes" }, { DB_SSL: "" }, { SMTP_SECURE: "" }, { NODE_ENV: "production" }, { CORS_ORIGINS: "https://app.example.com/path" }]) {
    assert.throws(() => loadConfig({ ...env, ...override }));
  }
  const production = { ...env, NODE_ENV: "production", PUBLIC_BASE_URL: "https://api.example.com", PASSWORD_RESET_URL: "https://app.example.com/reset-password",
    EMAIL_PROVIDER: "resend", RESEND_API_KEY: "test-key", EMAIL_FROM: "noreply@example.com" };
  assert.equal(loadConfig(production).emailProvider, "resend");
  assert.throws(() => loadConfig({ ...production, EMAIL_PROVIDER: "disabled" }));
  assert.equal(loadConfig({ ...production, PASSWORD_RESET_URL: "" }).resetUrl, undefined);
  assert.throws(() => loadConfig({ ...production, PUBLIC_BASE_URL: "http://api.example.com" }));
});

test("pool accepts DATABASE_URL and explicit SSL with certificate verification", async () => {
  const local = { ...env, DB_SSL: "false" };
  const pool = createPool(loadConfig(local), local);
  assert.ok(pool.options.connectionString.includes("localhost:5432"));
  assert.equal(pool.options.ssl, false);
  assert.equal(pool.options.connectionTimeoutMillis, 5000);
  await pool.end();
  const tlsEnv = { ...env, DATABASE_URL: `${env.DATABASE_URL}?sslmode=no-verify`, DB_SSL: "true", DB_SSL_CA: "line1\\nline2" };
  const tls = createPool(loadConfig(tlsEnv), tlsEnv);
  assert.equal(tls.options.ssl.rejectUnauthorized, true);
  assert.equal(tls.options.ssl.ca, "line1\nline2");
  assert.ok(!tls.options.connectionString.includes("sslmode"));
  await tls.end();
});

test("Resend delivery uses HTTPS and never calls network during service construction", async () => {
  let calls = 0;
  const service = createEmailService({ emailProvider: "resend" }, { RESEND_API_KEY: "test-key", EMAIL_FROM: "noreply@example.com" }, async (url, options) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    assert.deepEqual(JSON.parse(options.body).to, ["a@example.com"]);
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ id: "message-1" }) };
  });
  assert.equal(calls, 0);
  assert.deepEqual(await service.sendEmail({ to: "a@example.com", subject: "test", text: "hello" }), { id: "message-1" });
  assert.equal(calls, 1);
});

test("provider rejection/timeouts and disabled delivery return recoverable errors", async () => {
  for (const impl of [async () => ({ ok: false, status: 429 }), async () => { throw new Error("timed out"); }]) {
    const service = createEmailService({ emailProvider: "resend" }, {}, impl);
    await assert.rejects(service.sendEmail({}), { status: 503, code: "EMAIL_DELIVERY_FAILED" });
  }
  const disabled = createEmailService({ emailProvider: "disabled" });
  await assert.rejects(disabled.sendEmail({}), { status: 503 });
});

test("logger redacts credentials, URLs, tokens, and nested error causes", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "a-private-test-secret";
  try {
    const error = new Error("Failed postgres://user:password@host/db token=sensitive-token a-private-test-secret",
      { cause: new Error("Bearer private-auth-value") });
    const logged = JSON.stringify(logger.clean({ password: "secret-input", Authorization: "Bearer value", body: { password: "input" }, error }));
    for (const secret of ["secret-input", "sensitive-token", "a-private-test-secret", "private-auth-value", "user:password"]) assert.ok(!logged.includes(secret));
    assert.ok(logged.includes("[REDACTED]"));
    assert.ok(logged.includes("config.test.js"));
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});
