const { Pool } = require("pg");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.DATABASE_URL);

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    };

const pool = new Pool(poolConfig);

module.exports = pool;
