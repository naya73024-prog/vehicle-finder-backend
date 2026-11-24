const jwt = require("jsonwebtoken");
const AppError = require("../utils/AppError");
module.exports = (secret) => (req, res, next) => {
  const match = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return next(new AppError(401, "Access denied. Token is required", "AUTH_REQUIRED"));
  try {
    const decoded = jwt.verify(match[1], secret, { algorithms: ["HS256"] });
    if (!decoded || typeof decoded !== "object" || !decoded.user_id ||
        !["string", "number"].includes(typeof decoded.user_id)) throw new Error("Invalid claims");
    req.user = decoded;
    next();
  } catch {
    next(new AppError(401, "Invalid or expired token", "INVALID_TOKEN"));
  }
};
