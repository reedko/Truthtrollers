import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/api';
import { getTokenInfo } from '../utils/tokenUtils';

/**
 * Smart token refresh strategy:
 * - Tokens expire after 30 minutes
 * - Auto-refreshes at 20 minutes when tab is visible
 * - Also refreshes automatically before API requests if token is near expiry (handled in API interceptor)
 */
export function useTokenRefresh() {
  const { token, user, setAuth, logout } = useAuthStore();
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    if (!token || !user) {
      // Clear any existing refresh timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      console.log('⚠️ [Token Status] No token or user - not logged in');
      return;
    }

    // Log initial token status
    const initialInfo = getTokenInfo(token);
    const now = new Date();
    const expiresAt = initialInfo.expiresAt ? new Date(initialInfo.expiresAt) : null;

    console.log('📊 [Token Status] Current status:', {
      valid: initialInfo.valid,
      expired: initialInfo.expired,
      minutesRemaining: initialInfo.minutesRemaining,
      userId: initialInfo.userId,
      username: initialInfo.username,
      currentTime: now.toLocaleTimeString(),
      expiresAt: expiresAt?.toLocaleTimeString(),
    });

    if (initialInfo.expired) {
      console.error('🚨 [Token Status] Token is EXPIRED - you need to log in again!');
      console.error(`   Expired at: ${expiresAt?.toLocaleTimeString()}`);
      console.error(`   Current time: ${now.toLocaleTimeString()}`);
      console.error(`   Expired ${Math.abs(initialInfo.minutesRemaining || 0)} minutes ago`);
      console.log('💡 [Token Status] Refresh the page to log in again');
    } else if ((initialInfo.minutesRemaining ?? 0) < 5) {
      console.warn(`⏰ [Token Status] Token expiring soon - ${initialInfo.minutesRemaining} minutes remaining`);
      console.warn(`   Will expire at: ${expiresAt?.toLocaleTimeString()}`);
    } else {
      console.log(`✅ [Token Status] Token healthy - ${initialInfo.minutesRemaining} minutes remaining`);
    }

    const refreshToken = async () => {
      if (isRefreshingRef.current) {
        console.log('⏸️ [Token Refresh] Refresh already in progress, skipping...');
        return;
      }

      isRefreshingRef.current = true;
      const refreshStartTime = Date.now();
      console.log('🔄 [Token Refresh] Background refresh triggered by useTokenRefresh hook');
      console.log(`   Current time: ${new Date().toLocaleTimeString()}`);
      console.log(`   Tab visible: ${!document.hidden}`);

      try {
        const response = await api.post('/api/refresh-token');
        const { token: newToken, user: updatedUser } = response.data;

        // Parse new token to show expiration
        const newPayload = JSON.parse(atob(newToken.split('.')[1]));
        const newExpiresAt = newPayload.exp * 1000;
        const newMinutesRemaining = Math.floor((newExpiresAt - Date.now()) / 1000 / 60);
        const refreshDuration = Date.now() - refreshStartTime;

        console.log(`✅ [Token Refresh] Token refreshed successfully in ${refreshDuration}ms`);
        console.log(`   New token expires at: ${new Date(newExpiresAt).toLocaleTimeString()} (${newMinutesRemaining} min from now)`);
        console.log(`   User: ${updatedUser.username} (ID: ${updatedUser.user_id})`);

        setAuth(updatedUser, newToken);

        // Dispatch custom event to notify socket manager
        window.dispatchEvent(new CustomEvent('token-refreshed', {
          detail: { token: newToken }
        }));
      } catch (error: any) {
        console.error('❌ [Token Refresh] Failed to refresh token - AUTO-LOGGING OUT');
        console.error(`   Error: ${error.message}`);
        console.error(`   Refresh attempt took: ${Date.now() - refreshStartTime}ms`);
        if (error.response) {
          console.error(`   Backend response status: ${error.response.status}`);
          console.error(`   Backend response data:`, error.response.data);
        }
        logout();
      } finally {
        isRefreshingRef.current = false;
      }
    };

    const scheduleRefresh = () => {
      // Clear any existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }

      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expiresAt = payload.exp * 1000;
        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;
        const minutesUntilExpiry = Math.round(timeUntilExpiry / 1000 / 60);

        // Refresh at 40 minutes (20 minutes before 60-minute expiration)
        const refreshAt = timeUntilExpiry - (20 * 60 * 1000);
        const minutesUntilRefresh = Math.round(Math.max(0, refreshAt) / 1000 / 60);

        console.log(`📅 [Token Refresh] Scheduling refresh:`);
        console.log(`   Current time: ${new Date(now).toLocaleTimeString()}`);
        console.log(`   Token expires at: ${new Date(expiresAt).toLocaleTimeString()} (${minutesUntilExpiry} min from now)`);
        console.log(`   Will refresh in: ${minutesUntilRefresh} minutes`);
        console.log(`   Refresh scheduled for: ${new Date(now + refreshAt).toLocaleTimeString()}`);
        console.log(`   Tab visible: ${!document.hidden}`);

        if (timeUntilExpiry <= 0) {
          // Token already expired - can't refresh, must log out
          console.error('🚨 [Token Refresh] Token ALREADY EXPIRED - logging out');
          console.error(`   Expired ${Math.abs(minutesUntilExpiry)} minutes ago`);
          logout();
        } else if (refreshAt > 0) {
          // Schedule refresh for the future
          // Only schedule if tab is visible
          if (!document.hidden) {
            refreshTimeoutRef.current = setTimeout(refreshToken, refreshAt);
            console.log(`✅ [Token Refresh] Background refresh timer SET for ${minutesUntilRefresh} minutes from now`);
          } else {
            console.log(`⏸️ [Token Refresh] Tab hidden, refresh timer NOT scheduled (will schedule when tab becomes visible)`);
          }
        } else {
          // Token not expired but refresh time is in the past (token is close to expiry)
          console.warn(`⚠️ [Token Refresh] Token near expiry (${minutesUntilExpiry} min remaining), refreshing IMMEDIATELY`);
          refreshToken();
        }
      } catch (error) {
        console.error('❌ [Token Refresh] Error parsing token:', error);
      }
    };

    // Handle visibility change - check token and refresh/logout as needed
    const handleVisibilityChange = () => {
      if (!document.hidden && token) {
        console.log('👁️ [Token Refresh] Tab became visible, checking token...');

        // Check if token is already expired
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const expiresAt = payload.exp * 1000;
          const now = Date.now();
          const timeUntilExpiry = expiresAt - now;
          const minutesUntilExpiry = Math.round(timeUntilExpiry / 1000 / 60);

          if (timeUntilExpiry <= 0) {
            // Token already expired - log out immediately
            console.error('🚨 [Token Refresh] Token EXPIRED while tab was hidden!');
            console.error(`   Expired ${Math.abs(minutesUntilExpiry)} minutes ago`);
            console.error(`   Cannot refresh expired token - logging out`);
            logout();
            return;
          } else if (timeUntilExpiry < 5 * 60 * 1000) {
            // Token expires in < 5 minutes - refresh immediately
            console.warn(`⚠️ [Token Refresh] Token expiring soon (${minutesUntilExpiry} min), refreshing NOW`);
            refreshToken();
            return;
          }
        } catch (error) {
          console.error('❌ [Token Refresh] Error checking token on visibility change:', error);
        }

        scheduleRefresh();
      } else if (document.hidden && refreshTimeoutRef.current) {
        // Clear timeout when tab is hidden to save resources
        console.log('🙈 [Token Refresh] Tab hidden, pausing refresh timer');
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };

    // Handle page focus (e.g., after computer wakes from sleep)
    const handleFocus = () => {
      if (token) {
        console.log('🔍 [Token Refresh] Page focused (computer may have woken from sleep), checking token...');
        handleVisibilityChange();
      }
    };

    // Initial schedule
    scheduleRefresh();

    // Listen for visibility changes and focus events
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    // Cleanup
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [token, user, setAuth, logout]);
}
