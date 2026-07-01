/**
 * Token validation and expiration utilities
 */

export interface TokenInfo {
  valid: boolean;
  expired: boolean;
  expiresAt: number | null;
  minutesRemaining: number | null;
  userId: number | null;
  username: string | null;
}

/**
 * Decode and validate JWT token
 */
export function getTokenInfo(token: string | null): TokenInfo {
  if (!token) {
    return {
      valid: false,
      expired: true,
      expiresAt: null,
      minutesRemaining: null,
      userId: null,
      username: null,
    };
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresAt = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const timeRemaining = expiresAt - now;
    const minutesRemaining = Math.floor(timeRemaining / 1000 / 60);

    return {
      valid: timeRemaining > 0,
      expired: timeRemaining <= 0,
      expiresAt,
      minutesRemaining,
      userId: payload.user_id || null,
      username: payload.username || null,
    };
  } catch (error) {
    console.error('Failed to parse token:', error);
    return {
      valid: false,
      expired: true,
      expiresAt: null,
      minutesRemaining: null,
      userId: null,
      username: null,
    };
  }
}

/**
 * Check if token needs refresh (< 5 minutes remaining)
 */
export function shouldRefreshToken(token: string | null): boolean {
  const info = getTokenInfo(token);
  return info.valid && (info.minutesRemaining ?? 0) < 5;
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: string | null): boolean {
  const info = getTokenInfo(token);
  return info.expired;
}
