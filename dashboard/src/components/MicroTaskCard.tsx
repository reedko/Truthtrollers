// src/components/MicroTaskCard.tsx
import {
  Box,
  Text,
  Image,
  Button,
  VStack,
  Progress,
  useColorModeValue,
  Center,
} from "@chakra-ui/react";
import { Task } from "../../../shared/entities/types";
const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

interface MicroTaskCardProps {
  task: Task;
  onSelect: (task: Task) => void;
}

const MicroTaskCard: React.FC<MicroTaskCardProps> = ({ task, onSelect }) => {
  const bg = useColorModeValue("gray.100", "gray.800");

  return (
    <Box
      w="175px"
      h="175px"
      bg={bg}
      borderRadius="xl"
      p={2}
      boxShadow="md"
      border="1px solid"
      borderColor="gray.600"
      display="flex"
      flexDirection="column"
      justifyContent="space-between"
    >
      <VStack spacing={1} align="center">
        <Text fontSize="xs" fontWeight="bold" noOfLines={2}>
          {task.content_name}
        </Text>

        <Image
          src={`${API_BASE_URL}/${task.thumbnail}`}
          alt={task.content_name}
          boxSize="80px"
          borderRadius="md"
          objectFit="cover"
        />

        <Progress
          size="xs"
          value={
            task.progress === "Completed"
              ? 100
              : task.progress === "Started"
              ? 50
              : 0
          }
          colorScheme="teal"
          w="full"
        />
        <Button
          size="xs"
          colorScheme="teal"
          variant="solid"
          onClick={() => onSelect(task)}
        >
          Select
        </Button>
      </VStack>
    </Box>
  );
};

export default MicroTaskCard;
