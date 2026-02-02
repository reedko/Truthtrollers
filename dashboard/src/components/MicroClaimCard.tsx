// src/components/MicroClaimCard.tsx
import { Box, Text, Badge, Button, VStack, HStack } from "@chakra-ui/react";
import { Task } from "../../../shared/entities/types";
import { useNavigate } from "react-router-dom";

interface MicroClaimCardProps {
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

const MicroClaimCard: React.FC<MicroClaimCardProps> = ({
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
      className="mr-card mr-card-blue"
      p={2}
      position="relative"
    >
      <div className="mr-glow-bar mr-glow-bar-blue" />
      <div className="mr-scanlines" />
      <VStack align="start" spacing={1}>
        <HStack justifyContent="space-between" w="100%">
          <Text className="mr-text-primary" fontWeight="bold">
            {title}
          </Text>
          <Badge colorScheme={statusColors[status]}>{status}</Badge>
        </HStack>
        <Text className="mr-text-secondary" fontSize="sm">{description}</Text>

        {relatedTask && (
          <Text className="mr-text-muted" fontSize="xs">
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

export default MicroClaimCard;
