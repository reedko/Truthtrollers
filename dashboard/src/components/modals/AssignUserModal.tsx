import React, { useEffect, useRef } from "react";
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
} from "@chakra-ui/react";
import { useTaskStore } from "../../store/useTaskStore";
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

  const users = useTaskStore((state) => state.users);

  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers[taskId] || [])
  );

  // Only fetch when modal is opened
  useEffect(() => {
    if (!isOpen || fetchInitiated.current) return;
    fetchInitiated.current = true;
    if (isOpen) {
      console.log("Fetching users and assigned users...");
      if (users.length === 0) {
        fetchUsers(); // Fetch users only if not already loaded
      }
      if (!assignedUsers.length && isOpen) {
        fetchAssignedUsers(taskId); // Fetch assigned users only if not already fetched
      }
    }
  }, [isOpen, fetchUsers, fetchAssignedUsers, taskId, users.length]);

  const toggleAssignedUserLocal = useTaskStore(
    (s) => s.toggleAssignedUserLocal
  );

  const handleToggleUser = async (userId: number) => {
    const uid = Number(userId);
    const user = users.find((u) => Number(u.user_id) === uid);
    if (!user) return;

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
            <VStack align="start">
              {users.map((user) => (
                <Checkbox
                  key={user.user_id}
                  isChecked={assignedUsers.some(
                    (assignedUser) => assignedUser.user_id === user.user_id
                  )}
                  onChange={() => handleToggleUser(user.user_id)}
                >
                  {user.username}
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
