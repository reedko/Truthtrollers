// src/components/AssignedTaskGrid.tsx
import {
  Box,
  Button,
  Flex,
  Image,
  Progress,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import { Task } from "../../../shared/entities/types"; // Adjust to match your Task interface

const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

interface AssignedTaskGridProps {
  tasks: Task[];
}

const AssignedTaskGrid: React.FC<AssignedTaskGridProps> = ({ tasks }) => {
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask); // 🔄 this should exist in your store

  return (
    <VStack align="stretch" spacing={4} maxH="400px" overflowY="auto" pr={2}>
      {tasks.map((task) => (
        <Box
          key={task.content_id}
          p={3}
          borderWidth="1px"
          borderRadius="md"
          bg="gray.800"
          _hover={{ bg: "gray.700" }}
        >
          <Flex align="center" justify="space-between">
            <Image
              src={`${API_BASE_URL}/${task.thumbnail}`}
              alt={task.content_name}
              boxSize="60px"
              objectFit="cover"
              borderRadius="md"
              mr={3}
            />
            <Box flex="1">
              <Text fontWeight="bold" noOfLines={1}>
                {task.content_name}
              </Text>
              <Progress
                value={task.progress === "Completed" ? 100 : 50} // example logic
                size="sm"
                colorScheme="green"
                mt={1}
              />
            </Box>
            <Button
              size="sm"
              ml={3}
              onClick={() => setSelectedTask(task)}
              colorScheme="blue"
            >
              Select
            </Button>
          </Flex>
        </Box>
      ))}
    </VStack>
  );
};

export default AssignedTaskGrid;
