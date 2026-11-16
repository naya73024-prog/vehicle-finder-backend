
const pool = require("../config/db");


const getUserById = async (userId) => {
  const result = await pool.query(
    `SELECT user_id, full_name, email, phone_number,
            is_email_verified, created_at
     FROM users
     WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0];
};


const getUserByEmail = async (email) => {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );

  return result.rows[0];
};


const createUser = async (userData) => {
  const {
    full_name,
    email,
    phone_number,
    password_hash,
    verification_token_hash,
    verification_token_expires
  } = userData;

  const result = await pool.query(
    `INSERT INTO users (
      full_name,
      email,
      phone_number,
      password_hash,
      verification_token_hash,
      verification_token_expires
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING user_id, full_name, email, phone_number,
              is_email_verified, created_at`,
    [
      full_name,
      email,
      phone_number,
      password_hash,
      verification_token_hash,
      verification_token_expires
    ]
  );

  return result.rows[0];
};


const verifyEmail = async (tokenHash) => {
  const result = await pool.query(
    `UPDATE users
     SET is_email_verified = true,
         verification_token_hash = NULL,
         verification_token_expires = NULL,
         updated_at = NOW()
     WHERE verification_token_hash = $1
       AND verification_token_expires > NOW()
     RETURNING user_id, full_name, email, is_email_verified`,
    [tokenHash]
  );

  return result.rows[0];
};


const getUserForPasswordReset = async (email) => {
  const result = await pool.query(
    "SELECT user_id, email FROM users WHERE email = $1",
    [email]
  );

  return result.rows[0];
};


const saveResetToken = async (userId, tokenHash, expires) => {
  await pool.query(
    `UPDATE users
     SET reset_token_hash = $1,
         reset_token_expires = $2,
         updated_at = NOW()
     WHERE user_id = $3`,
    [tokenHash, expires, userId]
  );
};


const resetPassword = async (tokenHash, passwordHash) => {
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1,
        reset_token_hash = NULL,
        reset_token_expires = NULL,
        updated_at = NOW()
     WHERE reset_token_hash = $2
       AND reset_token_expires > NOW()
     RETURNING user_id`,
    [passwordHash, tokenHash]
  );

  return result.rows[0];
};


const updateUser = async (userId, fullName, phoneNumber) => {
  const result = await pool.query(
    `UPDATE users
     SET full_name = COALESCE($1, full_name),
     phone_number = COALESCE($2, phone_number)
     WHERE user_id = $3
     RETURNING user_id, full_name, email, phone_number,
     is_email_verified, created_at`,
    [fullName, phoneNumber, userId]
  );

  return result.rows[0];
};


const getPasswordHash = async (userId) => {
  const result = await pool.query(
    "SELECT password_hash FROM users WHERE user_id = $1",
    [userId]
  );

  return result.rows[0];
};


const updatePassword = async (userId, hashedPassword) => {
  await pool.query(
    "UPDATE users SET password_hash = $1 WHERE user_id = $2",
    [hashedPassword, userId]
  );
};


module.exports = {
  getUserById,
  getUserByEmail,
  createUser,
  verifyEmail,
  getUserForPasswordReset,
  saveResetToken,
  resetPassword,
  updateUser,
  getPasswordHash,
  updatePassword
};

