import React, { useEffect } from "react";
import { Grid, Box } from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import BoolCard from "./BoolCard";
import ProgressCard from "./ProgressCard";

const UnifiedHeader: React.FC = () => {
  const task = useTaskStore((s) => s.selectedTask);
  const contentId = task?.content_id;

  const fetchAuthors = useTaskStore((s) => s.fetchAuthors);
  const fetchPublishers = useTaskStore((s) => s.fetchPublishers);

  const authors = useTaskStore(
    useShallow((s) => (contentId ? s.authors[contentId] || [] : []))
  );
  const publishers = useTaskStore(
    useShallow((s) => (contentId ? s.publishers[contentId] || [] : []))
  );

  useEffect(() => {
    if (contentId) {
      fetchAuthors(contentId);
      fetchPublishers(contentId);
    }
  }, [contentId]);

  if (!task) return null;

  return (
    <Grid
      templateColumns={{ base: "1fr", md: "repeat(5, 1fr)" }}
      gap={4}
      mb={6}
    >
      <Box>
        <BoolCard
          verimeterScore={-0.6}
          trollmeterScore={0.2}
          pro={27}
          con={94}
        />
      </Box>
      <Box>
        <TaskCard task={task} useStore={false} />
      </Box>
      <Box>
        <PubCard publishers={publishers} />
      </Box>
      <Box>
        <AuthCard authors={authors} />
      </Box>
      <Box>
        <ProgressCard
          ProgressScore={0.2}
          totalClaims={90}
          verifiedClaims={27}
          totalReferences={20}
          verifiedReferences={10}
        />
      </Box>
    </Grid>
  );
};

export default UnifiedHeader;
