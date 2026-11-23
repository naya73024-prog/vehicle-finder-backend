class AppError extends Error {
  constructor(status, message, code = "REQUEST_FAILED", options) {
    super(message, options);
    this.status = status;
    this.code = code;
  }
}
module.exports = AppError;
