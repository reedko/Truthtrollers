// src/components/DashboardSection.tsx
import { Box, Heading, SimpleGrid } from "@chakra-ui/react";
import MicroTaskCard from "./MicroTaskCard";
import { Task } from "../../../shared/entities/types";

interface DashboardSectionProps {
  title: string;
  tasks: {
    id: string;
    title: string;
    description: string;
    status: "pending" | "complete" | "urgent";
    actionLink?: string;
    relatedTask?: Task;
  }[];
}

const DashboardSection: React.FC<DashboardSectionProps> = ({
  title,
  tasks,
}) => {
  return (
    <Box mb={8}>
      <Heading size="md" mb={4} color="teal.300">
        {title}
      </Heading>
      <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} spacing={4}>
        {tasks.map((t) => (
          <MicroTaskCard
            key={t.id}
            title={t.title}
            description={t.description}
            status={t.status}
            actionLink={t.actionLink}
            relatedTask={t.relatedTask}
          />
        ))}
      </SimpleGrid>
    </Box>
  );
};

export default DashboardSection;
