

const bcrypt = require("bcrypt");
const User = require("../models/User");


const getProfile = async (req, res) => {
  try {
    const user = await User.getUserById(req.user.user_id);

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.status(200).json({
      message: "Profile retrieved successfully",
      user
    });

  } catch (error) {
    console.error("Get profile error:", error.message);
    res.status(500).json({
      message: "Internal server error"
    });
  }
};


const updateProfile = async (req, res) => {
  try {
    const { full_name, phone_number } = req.body;

    if (full_name === undefined && phone_number === undefined) {
      return res.status(400).json({
        message: "Please provide full_name or phone_number"
      });
    }

    if (
      full_name !== undefined &&
      (typeof full_name !== "string" || !full_name.trim())
    ) {
      return res.status(400).json({
        message: "Full name cannot be empty"
      });
    }

    const user = await User.updateUser(
      req.user.user_id,
      full_name === undefined ? null : full_name.trim(),
      phone_number === undefined ? null : phone_number
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.status(200).json({
      message: "Profile updated successfully",
      user
    });

  } catch (error) {
    console.error("Update profile error:", error.message);
    res.status(500).json({
      message: "Internal server error"
    });
  }
};



const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required"
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters"
      });
    }

    const user = await User.getPasswordHash(req.user.user_id);

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    const isMatch = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect"
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await User.updatePassword(
      req.user.user_id,
      hashedPassword
    );

    res.status(200).json({
      message: "Password changed successfully"
    });

  } catch (error) {
    console.error("Change password error:", error.message);
    res.status(500).json({
      message: "Internal server error"
    });
  }
};

 
module.exports = {
  getProfile,
  updateProfile,
  changePassword
};

