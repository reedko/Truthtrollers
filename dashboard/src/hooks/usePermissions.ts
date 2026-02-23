import { useState, useEffect, useCallback } from "react";
import axios from "axios";

const API_URL = process.env.VITE_API_BASE_URL || "http://localhost:5001";

interface PermissionsData {
  permissions: string[];
  roles: string[];
}

const usePermissions = () => {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        setLoading(true);
        const response = await axios.get<PermissionsData>(
          `${API_URL}/api/user/permissions`,
          { withCredentials: true }
        );
        setPermissions(response.data.permissions);
        setRoles(response.data.roles);
        setError(null);
      } catch (err) {
        console.error("Error fetching permissions:", err);
        setError("Failed to fetch permissions");
        setPermissions([]);
        setRoles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, []);

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
