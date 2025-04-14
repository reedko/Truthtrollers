import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Heading } from "@chakra-ui/react";
import Workspace from "../components/Workspace";
import { useTaskStore } from "../store/useTaskStore";
import UnifiedHeader from "../components/UnifiedHeader";

const WorkspacePage = () => {
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const navigate = useNavigate();

  useEffect(() => {
    if (!selectedTask) {
      // ⏩ Redirect to task selection
      navigate("/tasks", { state: { redirectTo: "/workspace" } });
    }
  }, [selectedTask, navigate]);

  if (!selectedTask) return null; // prevent render flash

  return (
    <>
      <Box p={4}>
        <UnifiedHeader />
        <Heading size="md" mb={4}>
          Workspace
        </Heading>
        <Workspace contentId={selectedTask.content_id} />
      </Box>
    </>
  );
};

export default WorkspacePage;
