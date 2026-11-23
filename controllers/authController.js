const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { sendEmail } = require("../utils/sendEmail");

const getBaseUrl = () => {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, "");
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return `http://localhost:${process.env.PORT || 8080}`;
};

const register = async (req, res) => {
  try {
    const { full_name, email, phone_number, password } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        message: "full_name, email, and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.getUserByEmail(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const verificationToken = crypto.randomBytes(32).toString("hex");

    const verificationTokenHash = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");

    const verificationTokenExpires = new Date(
      Date.now() + 15 * 60 * 1000
    );

    const user = await User.createUser({
      full_name: full_name.trim(),
      email: normalizedEmail,
      phone_number: phone_number || null,
      password_hash: passwordHash,
      verification_token_hash: verificationTokenHash,
      verification_token_expires: verificationTokenExpires,
    });

    const baseUrl = getBaseUrl();
    const verificationLink =
      `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;

    let emailSent = true;

    try {
      await sendEmail({
        to: normalizedEmail,
        subject: "Vehicle Finder - Verify Your Email",
        text: `Open this link to verify your email: ${verificationLink}`,
        html: `
          <h2>Welcome to Vehicle Finder!</h2>
          <p>Please click the link below to verify your email:</p>
          <a href="${verificationLink}">Verify Email</a>
          <p>This link expires in 15 minutes.</p>
        `,
      });
    } catch (emailError) {
      emailSent = false;
      console.error("Verification email error:", emailError.message);
    }

    return res.status(201).json({
      message: emailSent
        ? "Registration successful. Please check your email to verify your account."
        : "Account created, but verification email could not be sent right now.",
      user,
    });
  } catch (error) {
    console.error("Register error:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.getUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (!user.is_email_verified) {
      return res.status(403).json({
        message: "Please verify your email before logging in",
      });
    }

    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.status(200).json({
      message: "Login successful",
      token: token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        is_email_verified: user.is_email_verified,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        message: "Verification token is required",
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.verifyEmail(tokenHash);

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired verification link",
      });
    }

    return res.status(200).json({
      message: "Email verified successfully",
      user,
    });
  } catch (error) {
    console.error("Verify email error:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.getUserForPasswordReset(normalizedEmail);

    if (!user) {
      return res.status(200).json({
        message: "If the account exists, a reset link will be sent",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");

    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    const resetTokenExpires = new Date(
      Date.now() + 15 * 60 * 1000
    );

    await User.saveResetToken(
      user.user_id,
      resetTokenHash,
      resetTokenExpires
    );

    const baseUrl = getBaseUrl();
    const resetLink =
      `${baseUrl}/reset-password?token=${resetToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: "Vehicle Finder - Reset Password",
        text: `Open this link to reset your password: ${resetLink}`,
        html: `
          <h2>Reset Your Password</h2>
          <p>Click the link below to reset your password:</p>
          <a href="${resetLink}">Reset Password</a>
          <p>This link expires in 15 minutes.</p>
        `,
      });
    } catch (emailError) {
      console.error("Forgot password email error:", emailError.message);
    }

    return res.status(200).json({
      message: "If the account exists, a reset link will be sent",
    });
  } catch (error) {
    console.error("Forgot password error:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        message: "Token and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const passwordHash = await bcrypt.hash(newPassword, 12);

    const user = await User.resetPassword(tokenHash, passwordHash);

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset link",
      });
    }

    return res.status(200).json({
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

module.exports = {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
};
