const AppError = require("../utils/AppError");
function validate(rules, source = "body") {
  return (req, res, next) => {
    const data = req[source];
    if (!data || typeof data !== "object" || Array.isArray(data)) return next(new AppError(400, `A valid ${source} is required`, "VALIDATION_ERROR"));
    for (const [key, rule] of Object.entries(rules)) {
      const value = data[key];
      if (value === undefined && rule.optional) continue;
      if (typeof value !== "string" || !value.trim() || (rule.max && value.length > rule.max) ||
          (rule.min && value.length < rule.min) || (rule.password && Buffer.byteLength(value) > 72) ||
          (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) || (rule.token && !/^[a-f0-9]{64}$/i.test(value))) {
        return next(new AppError(400, `Invalid ${key}`, "VALIDATION_ERROR"));
      }
    }
    next();
  };
}
module.exports = { validate, email: { email: true, max: 254 }, password: { min: 8, password: true }, token: { token: true } };
