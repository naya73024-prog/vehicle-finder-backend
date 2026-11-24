if (require.main === module) require("dotenv").config({ quiet: true });
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPool } = require("../config/db");
const { loadDatabaseConfig } = require("../config/env");
const logger = require("../utils/logger");
async function migrate(pool) {
  const client = await pool.connect();
  let failure;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734182901)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const files = (await fs.readdir(path.join(__dirname, "../migrations"))).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      const applied = await client.query("SELECT name FROM schema_migrations WHERE name = $1", [name]);
      if (applied.rows.length) continue;
      await client.query(await fs.readFile(path.join(__dirname, "../migrations", name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      logger.info("database.migration_applied", { migration: name });
    }
    await client.query("COMMIT");
  } catch (error) {
    failure = error;
    try { await client.query("ROLLBACK"); } catch (rollbackError) {
      logger.error("database.rollback_failed", { error: rollbackError });
    }
    throw error;
  } finally { client.release(failure); }
}
if (require.main === module) {
  async function main() {
    logger.info("database.migration_starting");
    const pool = createPool({ ...loadDatabaseConfig(), dbPoolMax: 1, dbTimeout: 10000 });
    try {
      await migrate(pool);
      logger.info("database.migration_completed");
    } finally { await pool.end(); }
  }
  main().catch((error) => {
    logger.error("database.migration_failed", { error });
    process.exitCode = 1;
  });
}
module.exports = { migrate };
