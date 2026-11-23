const AppError = require("../utils/AppError");

const bcrypt = require("bcrypt");
function createUserController(User) {

  const getProfile = async (req, res, next) => {
    try {
      const user = await User.getUserById(req.user.user_id);

      if (!user) {
        throw new AppError(404, "User not found");
      }

      res.status(200).json({
        message: "Profile retrieved successfully",
        user
      });

    } catch (error) {
      return next(error);
    }
  };

  const updateProfile = async (req, res, next) => {
    try {
      const { full_name, phone_number } = req.body;

      if (full_name === undefined && phone_number === undefined) {
        throw new AppError(400, "Please provide full_name or phone_number");
      }

      if (
        full_name !== undefined &&
        (typeof full_name !== "string" || !full_name.trim())
      ) {
        throw new AppError(400, "Full name cannot be empty");
      }

      const user = await User.updateUser(
        req.user.user_id,
        full_name === undefined ? null : full_name.trim(),
        phone_number === undefined ? null : phone_number
      );

      if (!user) {
        throw new AppError(404, "User not found");
      }

      res.status(200).json({
        message: "Profile updated successfully",
        user
      });

    } catch (error) {
      return next(error);
    }
  };

  const changePassword = async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        throw new AppError(400, "Current password and new password are required");
      }

      if (newPassword.length < 8) {
        throw new AppError(400, "New password must be at least 8 characters");
      }

      const user = await User.getPasswordHash(req.user.user_id);

      if (!user) {
        throw new AppError(404, "User not found");
      }

      const isMatch = await bcrypt.compare(
        currentPassword,
        user.password_hash
      );

      if (!isMatch) {
        throw new AppError(400, "Current password is incorrect");
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);

      const updated = await User.updatePassword(
        req.user.user_id,
        hashedPassword,
        user.password_hash
      );
      if (!updated) throw new AppError(409, "Password changed during this request. Please try again.", "PASSWORD_CHANGED");

      res.status(200).json({
        message: "Password changed successfully"
      });

    } catch (error) {
      return next(error);
    }
  };

  return {
    getProfile,
    updateProfile,
    changePassword
  };

}
module.exports = { createUserController };
