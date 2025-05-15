import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useTaskStore } from "../store/useTaskStore";
import { decodeJwt } from "../utils/jwt";

export default function ProtectedRoute({
  children,
}: {
  children: JSX.Element;
}) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const viewingUserId = useTaskStore((s) => s.viewingUserId);

  const pathname = location.pathname;
  const params = new URLSearchParams(location.search);
  const demoToken = params.get("demo");
  const storedToken = localStorage.getItem("jwt");
  console.log("🔐 ProtectedRoute", {
    pathname: location.pathname,
    user,
    viewingUserId,
    demoToken,
    storedToken,
  });
  // ✅ 1️⃣ Wait for Zustand hydration before doing ANYTHING
  const hasHydrated = user !== undefined;

  if (!hasHydrated) {
    return null; // or <Spinner />
  }

  // ✅ 2️⃣ Apply demoToken only if no real user and token mismatch
  const isGuest = user?.can_post === false;

  const realToken = localStorage.getItem("jwt");

  if (demoToken && !realToken) {
    const payload = decodeJwt(demoToken);
    setAuth(
      {
        ...payload,
        can_post: false,
        jwt: demoToken,
      },
      demoToken
    );

    // Clean up the URL
    params.delete("demo");
    const newSearch = params.toString();
    window.history.replaceState(
      {},
      "",
      location.pathname + (newSearch ? `?${newSearch}` : "")
    );

    return null;
  }

  // ✅ 3️⃣ Require user/viewer for workspace/molecule
  const requiresViewer = ["/workspace", "/molecule"].some((p) =>
    pathname.startsWith(p)
  );
  const hasSelectedViewer = viewingUserId !== undefined;

  if ((isGuest || !user) && requiresViewer && !hasSelectedViewer) {
    return (
      <Navigate to="/select-user" replace state={{ redirectTo: pathname }} />
    );
  }

  // ✅ 4️⃣ Force login for protected paths
  const requiresLogin = [
    "/dashboard",
    "/tasks",
    "/account",
    "/discussion",
    "/logout",
  ];
  const needsAuth = requiresLogin.some((p) => pathname.startsWith(p));

  if (!user && needsAuth) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // ✅ 5️⃣ Success — render protected content
  return children;
}
