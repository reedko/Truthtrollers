import React from "react";
import { Grid, Box, Heading, useBreakpointValue } from "@chakra-ui/react";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import { Task, Publisher, Author } from "../../../shared/entities/types";

interface UnifiedHeaderProps {
  task: Task;
  publishers: Publisher[];
  authors: Author[];
}

const UnifiedHeader: React.FC<UnifiedHeaderProps> = ({
  task,
  publishers,
  authors,
}) => {
  const columnCount = useBreakpointValue({ base: 1, md: 3 });

  return (
    <Grid
      templateColumns={`repeat(${columnCount}, 1fr)`}
      gap={4}
      alignItems="stretch"
      mb={6}
    >
      <Box
        bg="gray.800"
        p={4}
        borderRadius="xl"
        boxShadow="md"
        minH="160px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
      >
        <Heading size="sm" color="gray.300" mb={2}>
          Task Info
        </Heading>
        <TaskCard task={task} useStore={false} compact={true} />
      </Box>

      <Box
        bg="gray.800"
        p={4}
        borderRadius="xl"
        boxShadow="md"
        minH="160px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
      >
        <Heading size="sm" color="gray.300" mb={2}>
          Publisher
        </Heading>
        <PubCard publishers={publishers} compact={true} />
      </Box>

      <Box
        bg="gray.800"
        p={4}
        borderRadius="xl"
        boxShadow="md"
        minH="160px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
      >
        <Heading size="sm" color="gray.300" mb={2}>
          Author(s)
        </Heading>
        <AuthCard authors={authors} compact />
      </Box>
    </Grid>
  );
};

export default UnifiedHeader;
