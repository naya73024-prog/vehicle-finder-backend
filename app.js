const express = require("express");
const AppError = require("./utils/AppError");
const errorHandler = require("./middleware/errorHandler");
const requestLogger = require("./middleware/requestLogger");
const { createUserModel } = require("./models/User");
const { createAuthController } = require("./controllers/authController");
const { createUserController } = require("./controllers/userController");

function createApp({ config, pool, emailService, userModel = createUserModel(pool) }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin) {
      res.vary("Origin");
      if (config.corsOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
      } else if (req.method === "OPTIONS") {
        return next(new AppError(403, "Origin is not allowed", "CORS_ORIGIN_DENIED"));
      }
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/", (req, res) => res.json({ message: "Vehicle Finder API", health: "/health" }));
  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  const readiness = async (req, res) => {
    try {
      // A reachable database with no schema is not ready to accept API traffic.
      await pool.query("SELECT user_id, full_name, email, phone_number, password_hash, is_email_verified, verification_token_hash, verification_token_expires, reset_token_hash, reset_token_expires, created_at, updated_at FROM users LIMIT 0");
    } catch (cause) {
      throw new AppError(503, "Database is unavailable or its schema is not ready", "DATABASE_NOT_READY", { cause });
    }
    res.json({ status: "ok", database: "connected" });
  };
  app.get("/health", readiness);
  app.get("/api/db-check", readiness);
  const authMiddleware = require("./middleware/authMiddleware")(config.jwtSecret);
  app.use("/api/auth", require("./routes/authRoutes")(createAuthController(userModel, emailService, config)));
  app.use("/api/users", require("./routes/userRoutes")(createUserController(userModel), authMiddleware));
  app.get("/api/auth/profile", authMiddleware, (req, res) => res.json({ message: "Access granted", user: req.user }));
  app.use((req, res, next) => next(new AppError(404, "Route not found", "NOT_FOUND")));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
