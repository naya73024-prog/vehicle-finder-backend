const { Pool } = require("pg");
const logger = require("../utils/logger");
function createPool(config, env = process.env) {
  const options = {
    max: config.dbPoolMax, connectionTimeoutMillis: config.dbTimeout,
    idleTimeoutMillis: 30000, query_timeout: config.dbTimeout,
    statement_timeout: config.dbTimeout, application_name: "vehicle-finder-backend",
  };
  if (env.DATABASE_URL) options.connectionString = env.DATABASE_URL;
  else Object.assign(options, {
    host: env.DB_HOST || env.PGHOST, port: config.dbPort,
    database: env.DB_NAME || env.PGDATABASE, user: env.DB_USER || env.PGUSER,
    password: env.DB_PASSWORD || env.PGPASSWORD,
  });
  if (env.DB_SSL !== undefined) {
    if (options.connectionString) {
      const url = new URL(options.connectionString);
      for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
      options.connectionString = url.toString();
    }
    options.ssl = env.DB_SSL === "true" ? { rejectUnauthorized: true,
      ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, "\n") } : {}) } : false;
  }
  const pool = new Pool(options);
  pool.on("error", (error) => logger.error("database.pool_error", { error }));
  return pool;
}
module.exports = { createPool };
