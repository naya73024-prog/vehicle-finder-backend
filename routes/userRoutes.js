const express = require("express");
const { validate, password } = require("../middleware/validate");
module.exports = (controller, authMiddleware) => {
  const router = express.Router();
  router.use((req, res, next) => { req.logBaseUrl = req.baseUrl; next(); });
  router.use(authMiddleware);
  router.get("/profile", controller.getProfile);
  router.put("/profile", validate({ full_name: { optional: true, max: 200 }, phone_number: { optional: true, max: 32 } }), controller.updateProfile);
  router.put("/change-password", validate({ currentPassword: { password: true }, newPassword: password }), controller.changePassword);
  return router;
};
