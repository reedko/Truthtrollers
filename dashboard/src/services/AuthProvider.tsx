// src/App.tsx (or AuthProvider.tsx)
import React, { ReactNode, useEffect } from "react";
import { api } from "./api"; // axios instance
import { useAuthStore } from "../store/useAuthStore";

interface AuthBootstrapProps {
  children: ReactNode;
}

export function AuthBootstrap({ children }: AuthBootstrapProps) {
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    api
      .get("/api/auth/me", { withCredentials: true })
      .then((res) => {
        const { user, token } = res.data; // adjust to your API shape
        setAuth({ ...user, can_post: true, jwt: token, isDemo: false }, token);
      })
      .catch(() => {
        // not logged in — leave store alone
      });
  }, [setAuth]);

  return <>{children}</>;
}
