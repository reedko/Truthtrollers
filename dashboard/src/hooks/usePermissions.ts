import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import { useAuthStore } from "../store/useAuthStore";

interface PermissionsData {
  permissions: string[];
  roles: string[];
}

let permissionsCache: { key: string; data: PermissionsData } | null = null;
let permissionsRequest: { key: string; promise: Promise<PermissionsData> } | null = null;

const loadPermissions = (key: string) => {
  if (permissionsCache?.key === key) return Promise.resolve(permissionsCache.data);
  if (permissionsRequest?.key === key) return permissionsRequest.promise;

  const promise = api.get<PermissionsData>("/api/user/permissions")
    .then((response) => {
      permissionsCache = { key, data: response.data };
      return response.data;
    })
    .finally(() => {
      if (permissionsRequest?.key === key) permissionsRequest = null;
    });
  permissionsRequest = { key, promise };
  return promise;
};

const usePermissions = () => {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    let active = true;
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
        const data = await loadPermissions(`${user.user_id}:${token}`);
        if (!active) return;
        setPermissions(data.permissions);
        setRoles(data.roles);
        setError(null);
      } catch (err: unknown) {
        if (!active) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        // Silently handle 401 errors - they're expected when not authenticated
        if (status !== 401) {
          console.error("Error fetching permissions:", err);
        }
        setError(status === 401 ? null : "Failed to fetch permissions");
        setPermissions([]);
        setRoles([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchPermissions();
    return () => {
      active = false;
    };
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
