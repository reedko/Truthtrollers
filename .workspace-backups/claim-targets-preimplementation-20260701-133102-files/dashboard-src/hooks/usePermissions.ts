import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import { useAuthStore } from "../store/useAuthStore";

interface PermissionsData {
  permissions: string[];
  roles: string[];
}

const usePermissions = () => {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    // Don't fetch permissions if user is not logged in or has no token
    if (!user || !token) {
      setPermissions([]);
      setRoles([]);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchPermissions = async () => {
      try {
        setLoading(true);
        const response = await api.get<PermissionsData>("/api/user/permissions");
        setPermissions(response.data.permissions);
        setRoles(response.data.roles);
        setError(null);
      } catch (err: any) {
        // Silently handle 401 errors - they're expected when not authenticated
        if (err?.response?.status !== 401) {
          console.error("Error fetching permissions:", err);
        }
        setError(err?.response?.status === 401 ? null : "Failed to fetch permissions");
        setPermissions([]);
        setRoles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, [user, token]);

  const hasPermission = useCallback(
    (permissionName: string): boolean => {
      return permissions.includes(permissionName);
    },
    [permissions]
  );

  const hasRole = useCallback(
    (roleName: string): boolean => {
      return roles.includes(roleName);
    },
    [roles]
  );

  const hasAnyPermission = useCallback(
    (permissionNames: string[]): boolean => {
      return permissionNames.some((p) => permissions.includes(p));
    },
    [permissions]
  );

  const hasAllPermissions = useCallback(
    (permissionNames: string[]): boolean => {
      return permissionNames.every((p) => permissions.includes(p));
    },
    [permissions]
  );

  return {
    permissions,
    roles,
    loading,
    error,
    hasPermission,
    hasRole,
    hasAnyPermission,
    hasAllPermissions,
  };
};

export default usePermissions;
