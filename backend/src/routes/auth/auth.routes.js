// /backend/src/routes/auth/auth.routes.js
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { verifyCaptcha } from "../../utils/captcha.js";
import { createSessionLogger } from "../../utils/sessionLogger.js";

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

  const sql = "SELECT * FROM users WHERE username = ?";
  pool.query(sql, [username], async (err, results) => {
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
          await pool.query(
            "REPLACE INTO user_sessions (device_fingerprint, user_id, jwt, updated_at) VALUES (?, ?, ?, NOW())",
            [fingerprint, user.user_id, token]
          );
        }

        // Log the login event
        await pool.query(
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
 * Reset user password (simplified)
 */
router.post("/api/reset-password", (req, res) => {
  const { email, newPassword } = req.body;
  const hashedPassword = bcrypt.hashSync(newPassword, 10);

  pool.query(
    "UPDATE users SET password = ? WHERE email = ?",
    [hashedPassword, email],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.status(200).send("Password reset successful.");
    }
  );
});

  return router;
}
