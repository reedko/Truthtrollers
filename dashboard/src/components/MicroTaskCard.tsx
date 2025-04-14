// src/components/MicroTaskCard.tsx
import { Box, Text, Badge, Button, VStack, HStack } from "@chakra-ui/react";
import { Task } from "../../../shared/entities/types";
import { useNavigate } from "react-router-dom";

interface MicroTaskCardProps {
  title: string;
  description: string;
  status?: "pending" | "complete" | "urgent";
  relatedTask?: Task;
  actionLabel?: string;
  actionLink?: string;
  onClick?: () => void;
}

const statusColors = {
  pending: "yellow",
  complete: "green",
  urgent: "red",
};

const MicroTaskCard: React.FC<MicroTaskCardProps> = ({
  title,
  description,
  status = "pending",
  relatedTask,
  actionLabel = "Open",
  actionLink,
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (actionLink) navigate(actionLink);
  };

  return (
    <Box
      border="1px solid"
      borderColor="gray.600"
      borderRadius="md"
      p={2}
      bg="gray.800"
      color="white"
      shadow="md"
    >
      <VStack align="start" spacing={1}>
        <HStack justifyContent="space-between" w="100%">
          <Text fontWeight="bold" colorScheme="whiteAlpha.800">
            {title}
          </Text>
          <Badge colorScheme={statusColors[status]}>{status}</Badge>
        </HStack>
        <Text fontSize="sm">{description}</Text>

        {relatedTask && (
          <Text fontSize="xs" color="gray.400">
            Task: {relatedTask.content_name}
          </Text>
        )}

        {actionLink && (
          <Button size="sm" colorScheme="teal" onClick={handleClick}>
            {actionLabel}
          </Button>
        )}
      </VStack>
    </Box>
  );
};

export default MicroTaskCard;
