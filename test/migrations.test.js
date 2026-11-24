const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { migrate } = require("../scripts/migrate");
const { createUserModel } = require("../models/User");
const { createApp } = require("../app");
const databaseTest = { skip: !process.env.TEST_DATABASE_URL };

async function isolatedPool(t) {
  const schema = `test_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 4 });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  return { pool, schema };
}

test("legacy database upgrades preserve UUID users and nullable verification flags", databaseTest, async (t) => {
  const { pool } = await isolatedPool(t);
  await pool.query(`CREATE TABLE users (user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(200) NOT NULL, email VARCHAR(254) NOT NULL, password_hash TEXT NOT NULL, is_email_verified BOOLEAN)`);
  const original = (await pool.query("INSERT INTO users(full_name,email,password_hash) VALUES($1,$2,$3) RETURNING user_id",
    ["Existing User", "Existing@Example.com", "old-password-hash"])).rows[0];
  await migrate(pool);
  const users = createUserModel(pool);
  const user = await users.getUserByEmail("existing@example.com");
  assert.equal(user.user_id, original.user_id);
  assert.equal(user.password_hash, "old-password-hash");
  assert.equal(user.is_email_verified, null);
  await users.saveVerificationToken(user.user_id, "verification-hash", new Date(Date.now() + 60000));
  assert.equal((await users.verifyEmail("verification-hash")).is_email_verified, true);
  assert.equal(await users.verifyEmail("verification-hash"), undefined);
});

test("duplicate legacy emails roll migrations back cleanly and allow a later retry", databaseTest, async (t) => {
  const { pool, schema } = await isolatedPool(t);
  await pool.query("CREATE TABLE users (user_id SERIAL PRIMARY KEY, full_name TEXT, email TEXT, password_hash TEXT)");
  await pool.query("INSERT INTO users(full_name,email,password_hash) VALUES('One','User@example.com','hash'),('Two','user@example.com','hash')");
  await assert.rejects(migrate(pool), { code: "23505" });
  assert.equal((await pool.query("SELECT count(*) FROM users")).rows[0].count, "2");
  const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users'", [schema]);
  assert.ok(!columns.rows.some((row) => row.column_name === "verification_token_hash"));
  assert.equal((await pool.query("SELECT to_regclass('schema_migrations') AS table_name")).rows[0].table_name, null);
  await pool.query("DELETE FROM users WHERE email = 'User@example.com'");
  await migrate(pool);
  assert.equal((await pool.query("SELECT count(*) FROM schema_migrations")).rows[0].count, "1");
});

test("simultaneous deploy migrations apply each file exactly once", databaseTest, async (t) => {
  const { pool } = await isolatedPool(t);
  await Promise.all([migrate(pool), migrate(pool)]);
  assert.equal((await pool.query("SELECT count(*) FROM schema_migrations")).rows[0].count, "1");
});

test("expired verification and reset tokens cannot modify users", databaseTest, async (t) => {
  const { pool } = await isolatedPool(t);
  await migrate(pool);
  await pool.query(`INSERT INTO users(full_name,email,password_hash,verification_token_hash,verification_token_expires,reset_token_hash,reset_token_expires)
    VALUES('Expired','expired@example.com','original','verify',NOW()-INTERVAL '1 minute','reset',NOW()-INTERVAL '1 minute')`);
  const users = createUserModel(pool);
  assert.equal(await users.verifyEmail("verify"), undefined);
  assert.equal(await users.resetPassword("reset", "must-not-be-saved"), undefined);
  const user = await users.getUserByEmail("expired@example.com");
  assert.equal(user.password_hash, "original");
  assert.equal(user.is_email_verified, false);
});

test("concurrent password changes cannot overwrite a password using stale credentials", databaseTest, async (t) => {
  const { pool } = await isolatedPool(t);
  await migrate(pool);
  const hash = await bcrypt.hash("original-password", 4);
  const user = (await pool.query("INSERT INTO users(full_name,email,password_hash,is_email_verified) VALUES($1,$2,$3,true) RETURNING user_id",
    ["Concurrent", "concurrent@example.com", hash])).rows[0];
  const users = createUserModel(pool);
  let reads = 0, release;
  const bothRead = new Promise((resolve) => { release = resolve; });
  const config = { jwtSecret: "concurrent-password-change-test-secret-long-enough", baseUrl: "http://localhost:3000", corsOrigins: [] };
  const app = createApp({ config, pool, emailService: {}, userModel: { ...users,
    async getPasswordHash(id) {
      const result = await users.getPasswordHash(id);
      if (++reads === 2) release();
      await bothRead;
      return result;
    },
  } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const token = jwt.sign({ user_id: user.user_id }, config.jwtSecret, { expiresIn: "1h" });
  const results = await Promise.all(["first-password", "second-password"].map(async (newPassword) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/users/change-password`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: "original-password", newPassword }), signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json(), newPassword };
  }));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(results.find((result) => result.status === 409).body.code, "PASSWORD_CHANGED");
  const current = await users.getPasswordHash(user.user_id);
  assert.ok(await bcrypt.compare(results.find((result) => result.status === 200).newPassword, current.password_hash));
});
