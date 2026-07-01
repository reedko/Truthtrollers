// src/App.tsx (or AuthProvider.tsx)
import React, { ReactNode, useEffect } from "react";
import { api } from "./api"; // axios instance
import { useAuthStore } from "../store/useAuthStore";
import { useTaskStore } from "../store/useTaskStore";

interface AuthBootstrapProps {
  children: ReactNode;
}

export function AuthBootstrap({ children }: AuthBootstrapProps) {
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    // Check if we have a JWT from the extension
    const urlParams = new URLSearchParams(window.location.search);
    const extJwt = urlParams.get('extJwt');

    if (extJwt) {
      // Extension provided JWT - verify it and log in
      console.log('🔐 Extension JWT detected, authenticating...');

      api.defaults.headers.common['Authorization'] = `Bearer ${extJwt}`;

      api
        .get("/api/auth/me", { withCredentials: true })
        .then((res) => {
          const { user, token } = res.data;
          setAuth({ ...user, can_post: true, jwt: token || extJwt, isDemo: false }, token || extJwt);

          // Set default viewing user to logged-in user
          const taskStore = useTaskStore.getState();
          taskStore.setViewingUserId(user.user_id);
          taskStore.setViewScope('user');

          console.log('✅ Authenticated via extension JWT');

          // Clean up URL (remove extJwt parameter)
          urlParams.delete('extJwt');
          const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
          window.history.replaceState({}, '', newUrl);
        })
        .catch((err) => {
          console.error('❌ Extension JWT authentication failed:', err);
          // Fall back to regular auth check
          delete api.defaults.headers.common['Authorization'];
          checkRegularAuth();
        });
    } else {
      // No extension JWT - check regular auth
      checkRegularAuth();
    }

    function checkRegularAuth() {
      api
        .get("/api/auth/me", { withCredentials: true })
        .then((res) => {
          const { user, token } = res.data;
          setAuth({ ...user, can_post: true, jwt: token, isDemo: false }, token);

          const taskStore = useTaskStore.getState();
          taskStore.setViewingUserId(user.user_id);
          taskStore.setViewScope('user');
        })
        .catch(() => {
          // not logged in — leave store alone
        });
    }
  }, [setAuth]);

  return <>{children}</>;
}
