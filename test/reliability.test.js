const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const logger = require("../utils/logger");
const { migrate } = require("../scripts/migrate");
const { createEmailService } = require("../services/emailService");
const { createApp } = require("../app");
const { createPool } = require("../config/db");
const { loadDatabaseConfig } = require("../config/env");

test("migration CLI rejects invalid SSL before connecting and logs a structured failure", () => {
  const { spawnSync } = require("node:child_process");
  const child = spawnSync(process.execPath, ["scripts/migrate.js"], {
    env: { ...process.env, DATABASE_URL: "postgresql://postgres@127.0.0.1:1/test", DB_SSL: "" },
    encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(child.status, 1);
  const log = JSON.parse(child.stderr.trim());
  assert.equal(log.event, "database.migration_failed");
  assert.equal(log.error.message, "DB_SSL must be true or false");
});

test("a real PostgreSQL query timeout is recoverable and the pool remains usable", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const env = { DATABASE_URL: process.env.TEST_DATABASE_URL, DB_TIMEOUT_MS: "500" };
  const pool = createPool(loadDatabaseConfig(env), env);
  t.after(() => pool.end());
  // Warm the connection first so this specifically tests a slow SQL statement.
  await pool.query("SELECT 1");
  await assert.rejects(pool.query("SELECT pg_sleep(2)"), (error) => error.code === "57014" || error.message === "Query read timeout");
  assert.equal((await pool.query("SELECT 1 AS healthy")).rows[0].healthy, 1);
});

test("failed rollback preserves the original migration error and discards its connection", async () => {
  const original = Object.assign(new Error("schema permission denied"), { code: "42501" });
  let released;
  const client = {
    async query(sql) {
      if (sql === "BEGIN") return;
      if (sql === "ROLLBACK") throw new Error("connection lost during rollback");
      throw original;
    },
    release(error) { released = error; },
  };
  await assert.rejects(migrate({ connect: async () => client }), (error) => error === original);
  assert.equal(released, original);
});

test("logging BigInt IDs and cyclic causes never throws during error handling", () => {
  const error = new Error("failure");
  error.code = 12n;
  error.cause = error;
  const result = logger.clean({ userId: 9007199254740993n, error });
  assert.equal(result.userId, "9007199254740993");
  assert.equal(result.error.code, "12");
  assert.equal(result.error.cause, "[Circular]");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("Resend failures release the HTTP body and malformed successes return 503", async () => {
  let cancelled = false;
  const service = createEmailService({ emailProvider: "resend" }, {}, async () => ({
    ok: false, status: 503, body: { async cancel() { cancelled = true; } },
  }));
  await assert.rejects(service.sendEmail({}), { status: 503, code: "EMAIL_DELIVERY_FAILED" });
  assert.equal(cancelled, true);
  const malformed = createEmailService({ emailProvider: "resend" }, {}, async () => ({ ok: true, json: async () => ({}) }));
  await assert.rejects(malformed.sendEmail({}), { status: 503 });
});

test("SMTP success and rejected recipients use the real Nodemailer transport", { timeout: 10000 }, async (t) => {
  let rejectRecipient = false;
  let delivered = "";
  const sockets = new Set();
  const smtp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.write("220 localhost Test SMTP\r\n");
    let buffer = "", inData = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (inData) {
          if (line === ".") { inData = false; socket.write("250 queued-test-message\r\n"); }
          else delivered += line + "\n";
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH /.test(line)) socket.write("235 authenticated\r\n");
        else if (/^RCPT /.test(line)) socket.write(rejectRecipient ? "550 recipient rejected\r\n" : "250 accepted\r\n");
        else if (line === "DATA") { inData = true; socket.write("354 Send message\r\n"); }
        else if (line === "QUIT") socket.end("221 goodbye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); smtp.close(resolve); }));
  const service = createEmailService({ emailProvider: "smtp", smtpPort: smtp.address().port }, {
    SMTP_HOST: "127.0.0.1", SMTP_SECURE: "false", SMTP_USER: "local-test", SMTP_PASSWORD: "local-password",
    EMAIL_FROM: "noreply@example.com",
  });
  t.after(() => service.close());
  assert.ok((await service.sendEmail({ to: "test@example.com", subject: "Local test", text: "SMTP smoke test" })).id);
  assert.ok(delivered.includes("SMTP smoke test"));
  rejectRecipient = true;
  await assert.rejects(service.sendEmail({ to: "test@example.com", subject: "Rejected", text: "test" }), { status: 503, code: "EMAIL_DELIVERY_FAILED" });
});

test("database timeouts return 503 and protected-route errors log the correct endpoint", async (t) => {
  let failure;
  const config = { jwtSecret: "reliability-tests-secret-at-least-32-bytes", corsOrigins: [], baseUrl: "http://localhost:3000" };
  const app = createApp({ config, pool: {}, emailService: {}, userModel: { getUserByEmail: async () => { throw failure; } } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const error of [Object.assign(new Error("statement timed out"), { code: "57014" }), new Error("Query read timeout"),
    Object.assign(new Error("database starting"), { code: "57P03" }), Object.assign(new Error("socket reset"), { code: "ECONNRESET" })]) {
    failure = error;
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "test@example.com", password: "password123" }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "SERVICE_UNAVAILABLE");
  }
  const events = [];
  const original = logger.warn;
  logger.warn = (event, fields) => events.push(fields);
  t.after(() => { logger.warn = original; });
  for (const path of ["/api/users/profile", "/api/auth/profile"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 401);
    await response.json();
    assert.equal(events.at(-1).route, path);
  }
});
