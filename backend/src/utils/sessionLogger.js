export function createSessionLogger(query) {
  async function logSuccessfulLogin({
    userId,
    jwt,
    ipAddress,
    fingerprint = "manual_login",
  }) {
    const sql = `
      INSERT INTO user_sessions (device_fingerprint, user_id, jwt, updated_at, login_time, ip_address)
      VALUES (?, ?, ?, NOW(), NOW(), ?)
      ON DUPLICATE KEY UPDATE
        jwt = VALUES(jwt),
        updated_at = NOW(),
        login_time = NOW(),
        ip_address = VALUES(ip_address)
    `;
    await query(sql, [fingerprint, userId, jwt, ipAddress]);
  }

  async function logFailedLogin({
    username,
    ipAddress,
    userAgent,
    reason,
    fingerprint,
  }) {
    const sql = `
    INSERT INTO login_attempts
      (username, success, ip_address, user_agent, reason, fingerprint)
    VALUES (?, false, ?, ?, ?, ?)
  `;

    await query(sql, [username, ipAddress, userAgent, reason, fingerprint]);
  }
  async function logRegistrationAttempt({
    username,
    email,
    ipAddress,
    success,
    message,
  }) {
    const sql = `
    INSERT INTO registration_attempts (username, email, success, ip_address, message)
    VALUES (?, ?, ?, ?, ?)
  `;
    await query(sql, [username, email, success, ipAddress, message]);
  }

  return {
    logSuccessfulLogin,
    logFailedLogin,
    logRegistrationAttempt,
  };
}
