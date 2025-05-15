// pages/UserSelectionPage.tsx
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Box, Heading, Text, VStack, Button, Spinner } from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import { api } from "../services/api"; // assuming axios instance

export default function UserSelectionPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const navigate = useNavigate();
  const location = useLocation();

  const redirectTo = location.state?.redirectTo || "/workspace";

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const res = await api.get("/api/all-users");
        setUsers(res.data);
      } catch (err) {
        console.error("Error loading users:", err);
      } finally {
        setLoading(false);
      }
    };
    loadUsers();
  }, []);

  const handleSelect = (userId: number | null) => {
    setViewingUserId(userId);
    navigate(redirectTo);
  };

  return (
    <Box p={8}>
      <Heading size="lg" mb={4}>
        Choose a User to View As
      </Heading>
      {loading ? (
        <Spinner />
      ) : (
        <VStack spacing={3} align="start">
          <Button
            onClick={() => handleSelect(null)}
            colorScheme="green"
            variant="outline"
            width="100%"
            justifyContent="flex-start"
          >
            👥 View All Users
          </Button>
          {users.map((user) => (
            <Button
              key={user.user_id}
              onClick={() => handleSelect(user.user_id)}
              width="100%"
              justifyContent="flex-start"
            >
              {user.username} — {user.verimeter_score ?? 0} 🧠
            </Button>
          ))}
        </VStack>
      )}
    </Box>
  );
}
