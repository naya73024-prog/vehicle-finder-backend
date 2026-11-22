const { Pool } = require("pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL;
const isLocal =
  !connectionString ||
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1");

const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === "production" || !isLocal
      ? { rejectUnauthorized: false }
      : false,
});

module.exports = pool;
