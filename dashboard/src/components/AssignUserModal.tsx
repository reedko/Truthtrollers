import React, { useEffect, useState } from "react";
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
} from "@chakra-ui/react";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const AssignUserModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  onUpdateAssignedUsers: (updatedUsers: string[]) => void; // Accept callback to update assigned users
}> = ({ isOpen, onClose, taskId, onUpdateAssignedUsers }) => {
  const [users, setUsers] = useState<{ user_id: number; username: string }[]>(
    []
  );
  const [assignedUsers, setAssignedUsers] = useState<string[]>([]);

  useEffect(() => {
    const fetchUsers = async () => {
      const response = await axios.get(`${API_BASE_URL}/api/all-users`);
      setUsers(response.data);
    };

    const fetchAssignedUsers = async () => {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/get-users`
      );
      setAssignedUsers(response.data.map((user: any) => user.username));
    };

    if (isOpen) {
      fetchUsers();
      fetchAssignedUsers();
    }
  }, [isOpen, taskId]);

  const handleToggleUser = async (userId: number) => {
    const user = users.find((u) => u.user_id === userId);
    if (!user) return;

    const isAssigned = assignedUsers.includes(user.username);

    try {
      if (isAssigned) {
        await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/unassign-user`, {
          userId,
        });
        setAssignedUsers((prev) =>
          prev.filter((username) => username !== user.username)
        );
      } else {
        await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/assign-user`, {
          userId,
        });
        setAssignedUsers((prev) => [...prev, user.username]);
      }

      // Update parent component
      onUpdateAssignedUsers(
        assignedUsers.includes(user.username)
          ? assignedUsers.filter((username) => username !== user.username)
          : [...assignedUsers, user.username]
      );
    } catch (error) {
      console.error("Error toggling user assignment:", error);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Assign Users</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="start">
            {users.map((user) => (
              <Checkbox
                key={user.user_id}
                isChecked={assignedUsers.includes(user.username)}
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
      </ModalContent>
    </Modal>
  );
};

export default AssignUserModal;
