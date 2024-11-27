import React, { useEffect, useState } from "react";
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
  Grid,
  GridItem,
  Center,
  useDisclosure,
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import { Task } from "../entities/useTask"; // Import Task type
import { useNavigate } from "react-router-dom";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TaskCardProps {
  task: Task;
  onSelect: (taskId: number) => void;
  isSelected: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onSelect, isSelected }) => {
  const navigate = useNavigate();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [assignedUsers, setAssignedUsers] = useState<string[]>([]);

  // Fetch assigned users for the task
  useEffect(() => {
    const fetchAssignedUsers = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/tasks/${task.task_id}/users`
        );
        const data = await response.json();
        console.log(data);
        setAssignedUsers(data); // Assuming data is an array of usernames
      } catch (err) {
        console.error("Error fetching assigned users:", err);
      }
    };
    fetchAssignedUsers();
  }, [task.task_id]);

  const handleCardClick = () => {
    navigate(`/tasks/${task.task_id}`, { state: { task } });
  };

  const getProgressColor = (progress: string) => {
    switch (progress) {
      case "Completed":
        return "green";
      case "Partially Complete":
        return "yellow";
      case "Awaiting Evaluation":
        return "blue";
      default:
        return "red";
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
          {task.task_name}
        </Text>
        <Grid templateRows="repeat(2, 1fr)" templateColumns="repeat(2, 1fr)">
          <GridItem>
            <Progress
              value={
                task.progress === "Completed"
                  ? 100
                  : task.progress === "Partially Complete"
                  ? 50
                  : 25
              }
              colorScheme={getProgressColor(task.progress)}
              mt={2}
            />
          </GridItem>
          <GridItem>
            <Text>{task.progress}</Text>
          </GridItem>
          <GridItem>
            <Menu>
              <MenuButton as={Button} rightIcon={<BiChevronDown />}>
                Users
              </MenuButton>
              <MenuList>
                {assignedUsers.map((user, index) => (
                  <MenuItem key={index}>{user}</MenuItem>
                ))}
              </MenuList>
            </Menu>
          </GridItem>
          <GridItem>
            <Menu>
              <MenuButton as={Button} colorScheme="teal">
                Actions
              </MenuButton>
              <MenuList>
                <MenuItem onClick={() => onSelect(task.task_id)}>
                  Assign
                </MenuItem>
                <MenuItem onClick={handleCardClick}>View Details</MenuItem>
                <MenuItem onClick={onOpen}>Source List</MenuItem>
              </MenuList>
            </Menu>
          </GridItem>
        </Grid>
      </Box>
    </Center>
  );
};

export default TaskCard;
