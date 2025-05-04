import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore"; // or however you store user info

export default function ProtectedRoute({
  children,
}: {
  children: JSX.Element;
}) {
  const user = useAuthStore((state) => state.user); // adapt this to your store shape

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
