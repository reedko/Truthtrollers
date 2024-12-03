import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Image,
  Text,
  Progress,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Center,
  useDisclosure,
  Link,
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import AssignUserModal from "./AssignUserModal";
import SourceListModal from "./SourceListModal";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const TaskCard: React.FC<{
  task: any;
  taskUsers: { [taskId: number]: string[] };
  assignedUsers: string[];
  setTaskUsers: React.Dispatch<
    React.SetStateAction<{ [taskId: number]: string[] }>
  >;
  onFetchAssignedUsers: (taskId: number) => Promise<string[]>;
  onFetchReferences: (taskId: number) => Promise<string[]>;
  onAssignUserToTask: (taskId: number, userId: number) => Promise<void>;
}> = ({
  task,
  taskUsers,
  assignedUsers,
  setTaskUsers,
  onFetchAssignedUsers,
}) => {
  const navigate = useNavigate();

  const handleDrillDown = () => {
    console.log(`Navigating to /tasks/${task.task_id}`);
    navigate(`/tasks/${task.task_id}`, { state: { task } });
  };
  const [users, setUsers] = useState<string[]>([]); // Assigned users

  const {
    isOpen: isAssignOpen,
    onOpen: onAssignOpen,
    onClose: onAssignClose,
  } = useDisclosure();
  const {
    isOpen: isReferencesOpen,
    onOpen: onReferencesOpen,
    onClose: onReferencesClose,
  } = useDisclosure();

  const handleAssignedUsersOpen = async () => {
    try {
      const fetchedUsers = await onFetchAssignedUsers(task.task_id);

      setUsers(fetchedUsers); // Update the assigned users list
    } catch (err) {
      console.error("Error fetching assigned users:", err);
    }
  };

  return (
    <Center>
      <Box
        borderWidth="1px"
        borderRadius="lg"
        overflow="hidden"
        boxShadow="md"
        p={4}
        width="250px"
        margin="10px"
        bg="teal"
      >
        <Image
          src={`${API_BASE_URL}/${task.thumbnail}`}
          alt="Thumbnail"
          borderRadius="md"
          boxSize="200px"
          objectFit="cover"
        />
        <Text fontWeight="bold" mt={2} noOfLines={2}>
          <Link href={task.url} target="_blank">
            {task.task_name}
          </Link>
        </Text>
        <Progress
          value={
            task.progress === "Completed"
              ? 100
              : task.progress === "Partially Complete"
              ? 50
              : 25
          }
          colorScheme={
            task.progress === "Completed"
              ? "green"
              : task.progress === "Partially Complete"
              ? "yellow"
              : "red"
          }
          mt={2}
        />
        <Menu onOpen={handleAssignedUsersOpen}>
          <MenuButton as={Button} rightIcon={<BiChevronDown />}>
            Users
          </MenuButton>
          <MenuList>
            {assignedUsers.length > 0 ? (
              assignedUsers.map((user, index) => (
                <MenuItem key={index}>{user}</MenuItem>
              ))
            ) : (
              <MenuItem>No Users Assigned</MenuItem>
            )}
          </MenuList>
        </Menu>
        <Menu>
          <MenuButton as={Button} colorScheme="teal">
            Actions
          </MenuButton>
          <MenuList>
            <MenuItem
              onClick={() => {
                onAssignOpen(); // Open the assign modal
              }}
            >
              Assign User
            </MenuItem>
            <MenuItem
              onClick={() => {
                onReferencesOpen();
              }}
            >
              Source List
            </MenuItem>
            <MenuItem onClick={handleDrillDown}>Drill Down</MenuItem>
          </MenuList>
        </Menu>
        {/* Assign User Modal */}
        <AssignUserModal
          isOpen={isAssignOpen}
          onClose={onAssignClose}
          taskId={task.task_id}
          onUpdateAssignedUsers={(updatedUsers) =>
            setTaskUsers((prev) => ({
              ...prev,
              [task.task_id]: updatedUsers, // Update assigned users for this taskId
            }))
          }
        />
        <SourceListModal
          isOpen={isReferencesOpen}
          onClose={onReferencesClose}
          taskId={task.task_id}
        />
      </Box>
    </Center>
  );
};

export default TaskCard;
