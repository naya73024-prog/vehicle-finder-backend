const express = require("express");
const { validate, email, password, token } = require("../middleware/validate");
module.exports = (controller) => {
  const router = express.Router();
  router.use((req, res, next) => { req.logBaseUrl = req.baseUrl; next(); });
  router.post("/register", validate({ full_name: { max: 200 }, email, password, phone_number: { optional: true, max: 32 } }), controller.register);
  router.post("/login", validate({ email, password: { password: true } }), controller.login);
  router.get("/verify-email", validate({ token }, "query"), controller.verifyEmail);
  router.post("/forgot-password", validate({ email }), controller.forgotPassword);
  router.post("/resend-verification", validate({ email }), controller.resendVerification);
  router.post("/reset-password", validate({ token, newPassword: password }), controller.resetPassword);
  return router;
};
