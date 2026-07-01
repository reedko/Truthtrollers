/**
 * Token refresh hook - DISABLED
 *
 * With 30-day token expiration, we don't need proactive refresh.
 * The API interceptor in api.ts handles 401 errors if needed.
 *
 * This hook is now a no-op to prevent refresh loops.
 */
export function useTokenRefresh() {
  // Do nothing - tokens last 30 days, no refresh needed
}
