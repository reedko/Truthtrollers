import React from "react";
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
  GridItem,
  Grid,
  Center,
} from "@chakra-ui/react";
import { Task } from "../entities/useTask"; // Import the Task type
import { BiChevronDown } from "react-icons/bi";
import { useNavigate } from "react-router-dom";

interface TaskCardProps {
  task: Task;
  onSelect: (taskId: number) => void;
  isSelected: boolean;
}
const BASE_URL = process.env.BASE_URL || "http://localhost:5001";

const TaskCard: React.FC<TaskCardProps> = ({ task, onSelect, isSelected }) => {
  const navigate = useNavigate();

  const handleCardClick = () => {
    // Navigate and pass task data as state
    navigate("/tasks/" + task.task_id, { state: { task } });
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
        return "red"; // For Assigned/Started states
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
        onClick={handleCardClick} // Navigate on click
        cursor="pointer" // Change cursor to pointer
      >
        <Image
          src={`${BASE_URL}${task.thumbnail}${task.task_id}.png`} // Assuming thumbnail images are named as task_id_x.png
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
                {task.users
                  ? task.users
                      .split(",")
                      .map((user, index) => (
                        <MenuItem key={index}>{user.trim()}</MenuItem>
                      ))
                  : ""}
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
                <MenuItem>View Details</MenuItem>
                <MenuItem>Source List</MenuItem>
              </MenuList>
            </Menu>
          </GridItem>
        </Grid>
      </Box>
    </Center>
  );
};

export default TaskCard;
