const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../app");

test("PostgreSQL: migrations, registration, verification, login, profiles and single-use password resets", {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const schema = `test_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 3 });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await migrate(pool);
  await migrate(pool);
  assert.equal((await pool.query("SELECT count(*) FROM schema_migrations")).rows[0].count, "1");
  const sent = [];
  const app = createApp({ pool, config: { jwtSecret: "integration-test-secret-with-more-than-32-bytes",
    baseUrl: "https://api.example.com", resetUrl: "https://app.example.com/reset-password", corsOrigins: [] },
    emailService: { sendEmail: async (mail) => { sent.push(mail); } } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, body, method = "POST", token) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const getToken = () => new URL(sent.at(-1).text.split(" ").at(-1)).searchParams.get("token");
  assert.equal((await request("/health", undefined, "GET")).status, 200);
  const registered = await request("/api/auth/register", { full_name: " Test User ", email: " TEST@EXAMPLE.COM ", password: "password123" });
  assert.equal(registered.status, 201);
  const credentials = { email: "test@example.com", password: "password123" };
  assert.equal((await request("/api/auth/register", { ...credentials, full_name: "Duplicate" })).status, 409);
  assert.equal((await request("/api/auth/login", credentials)).status, 403);
  const verificationToken = getToken();
  assert.equal((await request(`/api/auth/verify-email?token=${verificationToken}`, undefined, "GET")).status, 200);
  assert.equal((await request(`/api/auth/verify-email?token=${verificationToken}`, undefined, "GET")).status, 400);
  const login = await request("/api/auth/login", credentials);
  assert.equal(login.status, 200);
  const token = login.body.token;
  const profile = await request("/api/users/profile", undefined, "GET", token);
  assert.equal(profile.body.user.full_name, "Test User");
  assert.equal((await request("/api/users/profile", { full_name: "Updated", phone_number: "01234567890" }, "PUT", token)).status, 200);
  assert.equal((await request("/api/auth/forgot-password", { email: credentials.email })).status, 200);
  const resetToken = getToken();
  assert.equal((await request("/api/auth/reset-password", { token: resetToken, newPassword: "newpassword123" })).status, 200);
  assert.equal((await request("/api/auth/reset-password", { token: resetToken, newPassword: "reusepassword123" })).status, 400);
  assert.equal((await request("/api/auth/login", credentials)).status, 401);
  assert.equal((await request("/api/auth/login", { ...credentials, password: "newpassword123" })).status, 200);
  await request("/api/auth/forgot-password", { email: credentials.email });
  const pendingReset = getToken();
  assert.equal((await request("/api/users/change-password", { currentPassword: "newpassword123", newPassword: "finalpassword123" }, "PUT", token)).status, 200);
  assert.equal((await request("/api/auth/reset-password", { token: pendingReset, newPassword: "stolenpassword123" })).status, 400);
  assert.equal((await request("/api/auth/login", { ...credentials, password: "finalpassword123" })).status, 200);
  // Database constraint also protects concurrent registrations, bypassing prechecks.
  await assert.rejects(pool.query("INSERT INTO users(full_name,email,password_hash) VALUES($1,$2,$3)", ["Duplicate", "TEST@example.com", "hash"]), { code: "23505" });
});
