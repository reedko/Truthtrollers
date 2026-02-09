// /backend/src/routes/auth/auth.routes.js
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { verifyCaptcha } from "../../utils/captcha.js";
import { createSessionLogger } from "../../utils/sessionLogger.js";
import { sendPasswordResetEmail, sendPasswordChangedEmail } from "../../utils/emailService.js";

export default function({ query, pool }) {
  const router = Router();

// Create session logger
const { logSuccessfulLogin, logFailedLogin, logRegistrationAttempt } =
  createSessionLogger(query);

/**
 * POST /api/register
 * Register a new user
 */
router.post("/api/register", async (req, res) => {
  const { username, password, email, captcha } = req.body;
  const ipAddress = req.ip;

  if (!username || !password || !email || !captcha) {
    await logRegistrationAttempt({
      username,
      email,
      ipAddress,
      success: false,
      message: "Missing required fields or CAPTCHA",
    });
    return res
      .status(400)
      .json({ error: "All fields and CAPTCHA are required." });
  }

  const isHuman = await verifyCaptcha(captcha);
  if (!isHuman) {
    await logRegistrationAttempt({
      username,
      email,
      ipAddress,
      success: false,
      message: "Failed CAPTCHA verification",
    });
    return res.status(403).json({ error: "Failed CAPTCHA verification" });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const sql = "INSERT INTO users (username, password, email) VALUES (?, ?, ?)";
  const params = [username, hashedPassword, email];

  pool.query(sql, params, async (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        await logRegistrationAttempt({
          username,
          email,
          ipAddress,
          success: false,
          message: "Duplicate username or email",
        });
        return res
          .status(409)
          .json({ error: "Username or email already exists." });
      }

      console.error("Error registering user:", err);
      await logRegistrationAttempt({
        username,
        email,
        ipAddress,
        success: false,
        message: `Database error: ${err.message}`,
      });
      return res.status(500).json({ error: "Database error." });
    }

    // Log success
    await logRegistrationAttempt({
      username,
      email,
      ipAddress,
      success: true,
      message: "Registration successful",
    });

    res.status(201).json({
      user: {
        id: result.insertId,
        username,
        email,
      },
    });
  });
});

/**
 * POST /api/login
 * Login user and return JWT token
 */
router.post("/api/login", async (req, res) => {
  const { username, password, captcha, fingerprint } = req.body;
  const ipAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // CAPTCHA bypass for extensions or post-registration
  const skipCaptcha = req.headers["x-skip-captcha"] === "true";

  if (!username || !password || (!skipCaptcha && !captcha)) {
    return res.status(400).json({ error: "All fields are required." });
  }

  if (!skipCaptcha) {
    const isHuman = await verifyCaptcha(captcha);
    if (!isHuman) {
      await logFailedLogin({
        username,
        ipAddress,
        userAgent: req.headers["user-agent"],
        reason: "captcha_failed",
        fingerprint,
      });

      return res.status(403).json({ error: "Failed CAPTCHA verification" });
    }
  }

  // Support login with username OR email
  const sql = "SELECT * FROM users WHERE username = ? OR email = ?";
  pool.query(sql, [username, username], async (err, results) => {
    if (err) {
      console.error("Error logging in user:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    if (results.length === 0) {
      await logFailedLogin({
        username,
        ipAddress,
        userAgent: req.headers["user-agent"],
        reason: "user_not_found",
        fingerprint,
      });
      return res.status(404).send("User not found.");
    }

    const user = results[0];
    const isValidPassword = bcrypt.compareSync(password, user.password);

    if (isValidPassword) {
      const token = jwt.sign(
        {
          user_id: user.user_id,
          username: user.username,
          can_post: true,
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      // --- SESSION LOGIC ---
      // For extension logins, fingerprint will be present.
      // For dashboard logins, fallback to "manual_login" or generate as needed.
      const sessionFingerprint = fingerprint || "manual_login";
      try {
        // Optionally: upsert/replace session for extension/device logins
        if (fingerprint) {
          await query(
            "REPLACE INTO user_sessions (device_fingerprint, user_id, jwt, updated_at) VALUES (?, ?, ?, NOW())",
            [fingerprint, user.user_id, token]
          );
        }

        // Log the login event
        await query(
          "INSERT INTO login_events (user_id, fingerprint, event_type, ip_address, details) VALUES (?, ?, 'login', ?, ?)",
          [
            user.user_id,
            sessionFingerprint,
            ipAddress,
            JSON.stringify({ username, agent: req.headers["user-agent"] }),
          ]
        );
      } catch (logErr) {
        console.warn("Login event/session log failed:", logErr.message);
      }

      // --- END SESSION LOGIC ---

      await logSuccessfulLogin({
        userId: user.user_id,
        jwt: token,
        ipAddress,
        fingerprint: sessionFingerprint,
      });

      res.status(200).json({
        auth: true,
        token,
        user: {
          user_id: user.user_id,
          username: user.username,
          can_post: true,
          user_profile_image: user.user_profile_image ?? null,
        },
      });
    } else {
      await logFailedLogin({
        username,
        ipAddress,
        userAgent: req.headers["user-agent"],
        reason: "Invalid credentials",
        fingerprint,
      });
      res.status(401).send("Invalid credentials.");
    }
  });
});

/**
 * POST /api/logout
 * Logout user by deleting session
 */
router.post("/api/logout", (req, res) => {
  const { fingerprint } = req.body;
  if (!fingerprint) {
    return res.status(400).json({ error: "Missing fingerprint" });
  }

  // 1. First, get the user_id for audit logging
  pool.query(
    "SELECT user_id FROM user_sessions WHERE device_fingerprint = ? LIMIT 1",
    [fingerprint],
    (err, results) => {
      if (err) {
        console.error("Error selecting session for logout:", err);
        return res.status(500).json({ error: "Database query failed" });
      }

      const userId = results.length ? results[0].user_id : null;

      // 2. Delete the session row
      pool.query(
        "DELETE FROM user_sessions WHERE device_fingerprint = ?",
        [fingerprint],
        (err2) => {
          if (err2) {
            console.error("Error deleting session:", err2);
            return res.status(500).json({ error: "Failed to log out" });
          }

          // 3. Optionally log the event for auditing
          pool.query(
            "INSERT INTO login_events (user_id, fingerprint, event_type, ip_address, details) VALUES (?, ?, 'logout', ?, ?)",
            [
              userId,
              fingerprint,
              req.ip,
              JSON.stringify({ agent: req.headers["user-agent"] }),
            ],
            (err3) => {
              if (err3) {
                console.error("Error logging logout event:", err3);
                // We still return success, since session was deleted!
              }
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

/**
 * POST /api/reset-password
 * Request password reset - generates token and sends email
 */
router.post("/api/reset-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    // 1. Check if user exists
    const users = await query("SELECT user_id, username, email FROM users WHERE email = ?", [email]);

    if (users.length === 0) {
      // Don't reveal if email exists or not (security best practice)
      return res.status(200).json({
        message: "If that email exists, a password reset link has been sent."
      });
    }

    const user = users[0];

    // 2. Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');

    // 3. Set expiration to 1 hour from now
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // 4. Delete any existing tokens for this user
    await query("DELETE FROM password_reset_tokens WHERE user_id = ?", [user.user_id]);

    // 5. Store new token
    await query(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
      [user.user_id, token, expiresAt]
    );

    // 6. Send email with reset link
    await sendPasswordResetEmail(user.email, token, user.username);

    // 7. Log the reset request
    await query(
      "INSERT INTO login_events (user_id, fingerprint, event_type, ip_address, details) VALUES (?, ?, 'password_reset_request', ?, ?)",
      [user.user_id, 'email_reset', req.ip, JSON.stringify({ email })]
    );

    res.status(200).json({
      message: "If that email exists, a password reset link has been sent."
    });
  } catch (error) {
    console.error("Password reset request error:", error);
    res.status(500).json({ error: "Failed to process password reset request" });
  }
});

/**
 * POST /api/test-email
 * Test email sending functionality
 */
router.post("/api/test-email", async (req, res) => {
  const { email, type } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    if (type === "reset") {
      // Test password reset email
      const testToken = "test-token-" + Date.now();
      await sendPasswordResetEmail(email, testToken, "TestUser");
      res.status(200).json({
        success: true,
        message: "Password reset email sent successfully",
        type: "reset"
      });
    } else if (type === "confirmation") {
      // Test password changed confirmation email
      await sendPasswordChangedEmail(email, "TestUser");
      res.status(200).json({
        success: true,
        message: "Password confirmation email sent successfully",
        type: "confirmation"
      });
    } else {
      return res.status(400).json({ error: "Invalid email type. Use 'reset' or 'confirmation'" });
    }
  } catch (error) {
    console.error("Email test error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to send test email"
    });
  }
});

/**
 * POST /api/verify-reset-token
 * Verify if a password reset token is valid
 */
router.post("/api/verify-reset-token", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    const tokens = await query(
      `SELECT prt.*, u.username, u.email
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.user_id
       WHERE prt.token = ? AND prt.used = FALSE AND prt.expires_at > NOW()`,
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({
        valid: false,
        error: "Invalid or expired token"
      });
    }

    const tokenData = tokens[0];
    res.status(200).json({
      valid: true,
      email: tokenData.email,
      username: tokenData.username
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(500).json({ error: "Failed to verify token" });
  }
});

/**
 * POST /api/reset-password-with-token
 * Complete password reset with valid token
 */
router.post("/api/reset-password-with-token", async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required" });
  }

  try {
    // 1. Verify token is valid and not expired
    const tokens = await query(
      `SELECT prt.*, u.user_id, u.username, u.email
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.user_id
       WHERE prt.token = ? AND prt.used = FALSE AND prt.expires_at > NOW()`,
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const tokenData = tokens[0];

    // 2. Hash the new password
    const hashedPassword = bcrypt.hashSync(newPassword, 10);

    // 3. Update user's password
    await query(
      "UPDATE users SET password = ? WHERE user_id = ?",
      [hashedPassword, tokenData.user_id]
    );

    // 4. Mark token as used
    await query(
      "UPDATE password_reset_tokens SET used = TRUE WHERE token = ?",
      [token]
    );

    // 5. Log the password change
    await query(
      "INSERT INTO login_events (user_id, fingerprint, event_type, ip_address, details) VALUES (?, ?, 'password_changed', ?, ?)",
      [tokenData.user_id, 'email_reset', req.ip, JSON.stringify({ email: tokenData.email })]
    );

    // 6. Send confirmation email
    await sendPasswordChangedEmail(tokenData.email, tokenData.username);

    res.status(200).json({
      message: "Password reset successful",
      success: true
    });
  } catch (error) {
    console.error("Password reset completion error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

  return router;
}
