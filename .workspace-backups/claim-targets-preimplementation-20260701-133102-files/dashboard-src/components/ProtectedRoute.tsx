import React, { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useTaskStore } from "../store/useTaskStore";
import { decodeJwt } from "../utils/jwt";
type ProtectedRouteProps = {
  children: ReactNode;
};
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const viewingUserId = useTaskStore((s) => s.viewingUserId);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);

  const pathname = location.pathname;
  const params = new URLSearchParams(location.search);
  const demoToken = params.get("demo");
  const realToken = localStorage.getItem("jwt");
  console.log("PROTECTED ROUTE RUNNING", window.location.pathname, Date.now());

  // 1️⃣ Apply demo token to Zustand (one-time hydration, before anything else)
  if (demoToken && !realToken && (user === undefined || user === null)) {
    console.log("PROTECTEDROUTE DEMO:", { demoToken, realToken, user });
    const payload = decodeJwt(demoToken);
    setAuth(
      {
        ...payload,
        can_post: false,
        jwt: demoToken,
        isDemo: true, // <--- Important: mark as demo!
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
    return null; // Block rendering while Zustand hydrates
  }

  // 2️⃣ Wait for Zustand hydration
  if (user === undefined) {
    return null; // or <Spinner />
  }

  useEffect(() => {
    // Only set viewingUserId if it is undefined/null
    if (
      user?.user_id &&
      (viewingUserId === undefined || viewingUserId === null)
    ) {
      setViewingUserId(user.user_id);
    }
  }, [user?.user_id, viewingUserId, setViewingUserId]);
  // 4️⃣ Guest/Viewer logic (unchanged)
  const requiresViewer = ["/workspace", "/molecule"].some((p) =>
    pathname.startsWith(p)
  );
  const hasSelectedViewer = viewingUserId !== undefined;
  const isDemo = user?.isDemo; // <--- Make sure your demo user has this field set

  if (
    (isDemo || user?.can_post === false) &&
    requiresViewer &&
    !hasSelectedViewer
  ) {
    return (
      <Navigate to="/select-user" replace state={{ redirectTo: pathname }} />
    );
  }

  // 5️⃣ ***THIS IS WHERE WE PATCH THE REDIRECT LOGIC***

  // Only require login for these paths if NOT a demo user!
  const requiresLogin = [
    "/dashboard",
    "/tasks",
    "/account",
    "/discussion",
    "/logout",
  ];
  const needsAuth = requiresLogin.some((p) => pathname.startsWith(p));

  // ⬇️ PATCH: Allow demo users to access /discussion
  if (!user && needsAuth && !isDemo) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // ⬇️ PATCH: If demo user, always allow access to /discussion
  if (isDemo && pathname.startsWith("/discussion")) {
    return children;
  }

  // For all other cases, show children if user exists or is demo
  if (user || isDemo) {
    return children;
  }

  // Default fallback: redirect to login
  return <Navigate to="/login" replace state={{ from: location }} />;
}
