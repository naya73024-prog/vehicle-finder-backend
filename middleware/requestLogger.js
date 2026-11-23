const { randomUUID } = require("crypto");
const logger = require("../utils/logger");
module.exports = (req, res, next) => {
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const start = process.hrtime.bigint();
  const log = (aborted) => logger.info("request.completed", {
    requestId: req.id, method: req.method,
    route: req.logRoute || (req.route ? `${req.logBaseUrl || req.baseUrl || ""}${req.route.path}` : `${req.logBaseUrl || ""}/unmatched`),
    status: aborted ? 499 : res.statusCode, aborted,
    durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
  });
  res.once("finish", () => log(false));
  res.once("close", () => { if (!res.writableFinished) log(true); });
  next();
};
