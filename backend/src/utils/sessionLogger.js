export function createSessionLogger(query) {
  async function logSuccessfulLogin({
    userId,
    jwt,
    ipAddress,
    fingerprint = "manual_login",
  }) {
    try {
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
    } catch (error) {
      console.error('⚠️ Failed to log successful login:', error.message);
      console.error('  User ID:', userId, 'Fingerprint:', fingerprint, 'IP:', ipAddress);
      // Don't throw - logging failure shouldn't break login flow
    }
  }

  async function logFailedLogin({
    username,
    ipAddress,
    userAgent,
    reason,
    fingerprint,
  }) {
    try {
      const sql = `
        INSERT INTO login_attempts
          (username, success, ip_address, user_agent, reason, fingerprint)
        VALUES (?, false, ?, ?, ?, ?)
      `;
      await query(sql, [username, ipAddress, userAgent, reason, fingerprint]);
    } catch (error) {
      console.error('⚠️ Failed to log failed login attempt:', error.message);
      console.error('  Username:', username, 'Reason:', reason, 'IP:', ipAddress);
      console.error('  Error details:', error.code || error);
      // Don't throw - logging failure shouldn't break login flow
    }
  }

  async function logRegistrationAttempt({
    username,
    email,
    ipAddress,
    success,
    message,
    userAgent,
  }) {
    try {
      const sql = `
        INSERT INTO registration_attempts (username, email, success, ip_address, message, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      await query(sql, [username, email, success, ipAddress, message, userAgent]);
    } catch (error) {
      console.error('⚠️ Failed to log registration attempt:', error.message);
      console.error('  Email:', email, 'Username:', username, 'Success:', success, 'IP:', ipAddress);
      console.error('  Error details:', error.code || error);
      // Don't throw - logging failure shouldn't break registration flow
    }
  }

  return {
    logSuccessfulLogin,
    logFailedLogin,
    logRegistrationAttempt,
  };
}
