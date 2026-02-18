import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  Checkbox,
  VStack,
  Text,
  Box,
  Alert,
  AlertIcon,
  AlertDescription,
} from "@chakra-ui/react";
import { useTaskStore } from "../../store/useTaskStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useShallow } from "zustand/react/shallow";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const AssignUserModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  taskName: string;
  position: any; // Pass the task name
}> = ({ isOpen, onClose, taskId, taskName, position }) => {
  const fetchInitiated = useRef(false);
  const fetchUsers = useTaskStore((state) => state.fetchUsers);
  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);
  const currentUser = useAuthStore((s) => s.user);

  const users = useTaskStore((state) => state.users);

  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers[taskId] || [])
  );

  const [isNewUser, setIsNewUser] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Reset fetch flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      fetchInitiated.current = false;
      setLoadingStatus(true);
    }
  }, [isOpen]);

  // Check if current user is "new" (no completed tasks)
  useEffect(() => {
    const checkUserStatus = async () => {
      if (!currentUser?.user_id || !isOpen) return;

      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/user-status/${currentUser.user_id}`
        );
        setIsNewUser(response.data.isNewUser);
      } catch (error) {
        console.error("Error checking user status:", error);
        setIsNewUser(false); // Default to not restricting on error
      } finally {
        setLoadingStatus(false);
      }
    };

    if (isOpen) {
      checkUserStatus();
    }
  }, [isOpen, currentUser?.user_id]);

  // Only fetch when modal is opened AND user status is determined
  useEffect(() => {
    if (!isOpen || fetchInitiated.current || loadingStatus) return;
    fetchInitiated.current = true;

    console.log("Fetching users and assigned users...");

    // Only fetch all users if NOT a new user
    // New users can only see themselves, so we skip the expensive fetchUsers() call
    if (!isNewUser && users.length === 0) {
      fetchUsers(); // Fetch users only if not already loaded and user is not new
    }

    // Fetch assigned users only if needed
    if (!assignedUsers.length) {
      fetchAssignedUsers(taskId); // Fetch assigned users only if not already fetched
    }
  }, [isOpen, fetchUsers, fetchAssignedUsers, taskId, users.length, loadingStatus, isNewUser]);

  const toggleAssignedUserLocal = useTaskStore(
    (s) => s.toggleAssignedUserLocal
  );

  // Filter users: new users can only see themselves
  // For new users, show only current user without needing to fetch all users
  const displayUsers = isNewUser && currentUser
    ? [{ user_id: currentUser.user_id, username: currentUser.username }]
    : users;

  const handleToggleUser = async (userId: number) => {
    const uid = Number(userId);
    // Look in displayUsers (which includes new users' current user)
    const user = displayUsers.find((u) => Number(u.user_id) === uid);
    if (!user) {
      console.warn("User not found in displayUsers:", uid);
      return;
    }

    // instant UI
    toggleAssignedUserLocal(taskId, { user_id: uid, username: user.username });

    try {
      const wasAssigned = assignedUsers.some((u) => Number(u.user_id) === uid);
      if (wasAssigned) {
        await axios.post(
          `${API_BASE_URL}/api/content/${taskId}/unassign-user`,
          { userId: uid }
        );
      } else {
        await axios.post(`${API_BASE_URL}/api/content/${taskId}/assign-user`, {
          userId: uid,
        });
      }
      // authoritative refresh
      await useTaskStore.getState().fetchAssignedUsers(taskId);
    } catch (e) {
      // revert on failure
      toggleAssignedUserLocal(taskId, {
        user_id: uid,
        username: user.username,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />

      <ModalContent
        className="mr-modal"
        bg="transparent"
        boxShadow="none"
        position="absolute"
        top={`${position.top}px`}
        left={`${position.left}px`}
        transform="translate(-50%, -50%)"
      >
        <Box
          borderWidth="1px"
          borderRadius="lg"
          overflow="hidden"
          boxShadow="md"
          textColor={"black"}
          p={4}
          width="400px"
          margin="10px auto"
          bg="blue.600"
        >
          <ModalHeader className="mr-modal-header">
            Assign Users for{" "}
            <Text as="span" fontStyle="italic" color="yellow.200">
              {taskName}
            </Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {isNewUser && !loadingStatus && (
              <Alert status="info" mb={4} borderRadius="md" bg="blue.100">
                <AlertIcon color="blue.600" />
                <AlertDescription fontSize="sm" color="gray.800">
                  New users can only assign tasks to themselves. Complete your first task to unlock the ability to assign to others!
                </AlertDescription>
              </Alert>
            )}
            <VStack align="start">
              {displayUsers.map((user) => (
                <Checkbox
                  key={user.user_id}
                  isChecked={assignedUsers.some(
                    (assignedUser) => assignedUser.user_id === user.user_id
                  )}
                  onChange={() => handleToggleUser(user.user_id)}
                >
                  {user.username}
                  {isNewUser && user.user_id === currentUser?.user_id && " (you)"}
                </Checkbox>
              ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose}>Close</Button>
          </ModalFooter>
        </Box>
      </ModalContent>
    </Modal>
  );
};

export default AssignUserModal;
