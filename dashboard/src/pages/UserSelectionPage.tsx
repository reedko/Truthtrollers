(""); // pages/UserSelectionPage.tsx
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Heading,
  Text,
  VStack,
  Button,
  Spinner,
  HStack,
  useToast,
} from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import { api } from "../services/api";

export default function UserSelectionPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const refPath = (() => {
    try {
      if (document.referrer && document.referrer.startsWith("http")) {
        return new URL(document.referrer).pathname;
      }
    } catch {}
    return "/";
  })();
  const fallbackRedirect = refPath.startsWith("/select-user")
    ? "/workspace"
    : refPath;

  const redirectTo = location.state?.redirectTo || fallbackRedirect;

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const res = await api.get("/api/all-users");
        setUsers(res.data);
      } catch (err) {
        console.error("Error loading users:", err);
        toast({
          title: "Error loading users",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      } finally {
        setLoading(false);
      }
    };
    loadUsers();
  }, [toast]);

  const handleConfirm = () => {
    setViewingUserId(selectedId);
    console.log(redirectTo, "LIJKUJYFDHFGDJ");
    navigate(redirectTo);
  };

  const handleCancel = () => {
    setViewingUserId(null);
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
        <>
          <VStack spacing={3} align="start" mb={6}>
            <Button
              onClick={() => setSelectedId(null)}
              colorScheme={selectedId === null ? "green" : "gray"}
              variant="outline"
              width="100%"
              justifyContent="flex-start"
            >
              👥 View All Users
            </Button>
            {users.map((user) => (
              <Button
                key={user.user_id}
                onClick={() => setSelectedId(user.user_id)}
                colorScheme={selectedId === user.user_id ? "blue" : "gray"}
                width="100%"
                justifyContent="flex-start"
              >
                {user.username} — {user.verimeter_score ?? 0} 🧠
              </Button>
            ))}
          </VStack>
          <HStack spacing={4}>
            <Button
              onClick={handleConfirm}
              colorScheme="blue"
              isDisabled={selectedId === undefined}
            >
              Confirm Selection
            </Button>
            <Button onClick={handleCancel} variant="outline">
              Cancel
            </Button>
          </HStack>
        </>
      )}
    </Box>
  );
}
