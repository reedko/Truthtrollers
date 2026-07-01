export function createSessionLogger(query) {
  async function logSuccessfulLogin({
    userId,
    jwt,
    ipAddress,
    fingerprint = "manual_login",
  }) {
    try {
      // Truncate IP if too long (safety measure)
      const safeIpAddress = ipAddress ? String(ipAddress).substring(0, 100) : 'unknown';

      const sql = `
        INSERT INTO user_sessions (device_fingerprint, user_id, jwt, updated_at, login_time, ip_address)
        VALUES (?, ?, ?, NOW(), NOW(), ?)
        ON DUPLICATE KEY UPDATE
          jwt = VALUES(jwt),
          updated_at = NOW(),
          login_time = NOW(),
          ip_address = VALUES(ip_address)
      `;
      await query(sql, [fingerprint, userId, jwt, safeIpAddress]);
    } catch (error) {
      console.error('🚨 ===============================================');
      console.error('🚨 FAILED TO LOG SUCCESSFUL LOGIN');
      console.error('🚨 ===============================================');
      console.error('  Error:', error.message);
      console.error('  Error Code:', error.code);
      console.error('  User ID:', userId);
      console.error('  Fingerprint:', fingerprint);
      console.error('  IP Address:', ipAddress, '(length:', ipAddress?.length, ')');
      console.error('🚨 ===============================================');
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
    // Write directly to stderr IMMEDIATELY (bypass buffering)
    process.stderr.write(`[${new Date().toISOString()}] 🔍 logFailedLogin CALLED: user=${username}, reason=${reason}, ip_len=${ipAddress?.length}\n`);

    try {
      // Truncate IP if too long (safety measure)
      const safeIpAddress = ipAddress ? String(ipAddress).substring(0, 100) : 'unknown';

      // Log what we're about to insert
      process.stderr.write(`[${new Date().toISOString()}] 📝 Attempting DB insert for failed login\n`);

      const sql = `
        INSERT INTO login_attempts
          (username, success, ip_address, user_agent, reason, fingerprint)
        VALUES (?, false, ?, ?, ?, ?)
      `;

      await query(sql, [username, safeIpAddress, userAgent, reason, fingerprint]);

      process.stderr.write(`[${new Date().toISOString()}] ✅ Failed login logged successfully\n`);
    } catch (error) {
      // Write to stderr IMMEDIATELY
      const errMsg = `
🚨 ===============================================
🚨 FAILED TO LOG FAILED LOGIN ATTEMPT
🚨 ===============================================
  Time: ${new Date().toISOString()}
  Error: ${error.message}
  Error Code: ${error.code}
  SQL State: ${error.sqlState}
  SQL Message: ${error.sqlMessage}
  Username: ${username}
  Reason: ${reason}
  IP Address: ${ipAddress} (length: ${ipAddress?.length})
  Fingerprint: ${fingerprint}
  User Agent: ${userAgent?.substring(0, 100)}
🚨 ===============================================
`;
      process.stderr.write(errMsg);
      console.error(errMsg);

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
      // Truncate IP if too long (safety measure)
      const safeIpAddress = ipAddress ? String(ipAddress).substring(0, 100) : 'unknown';

      const sql = `
        INSERT INTO registration_attempts (username, email, success, ip_address, message, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      await query(sql, [username, email, success, safeIpAddress, message, userAgent]);
    } catch (error) {
      console.error('🚨 ===============================================');
      console.error('🚨 FAILED TO LOG REGISTRATION ATTEMPT');
      console.error('🚨 ===============================================');
      console.error('  Error:', error.message);
      console.error('  Error Code:', error.code);
      console.error('  SQL State:', error.sqlState);
      console.error('  Email:', email);
      console.error('  Username:', username);
      console.error('  Success:', success);
      console.error('  IP Address:', ipAddress, '(length:', ipAddress?.length, ')');
      console.error('  Message:', message);
      console.error('🚨 ===============================================');
      // Don't throw - logging failure shouldn't break registration flow
    }
  }

  return {
    logSuccessfulLogin,
    logFailedLogin,
    logRegistrationAttempt,
  };
}
