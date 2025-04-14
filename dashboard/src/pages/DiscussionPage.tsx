import { Box, Heading } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import { useEffect } from "react";
import DiscussionBoard from "../components/DiscussionBoard";
import UnifiedHeader from "../components/UnifiedHeader";

const DiscussionPage = () => {
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const navigate = useNavigate();

  useEffect(() => {
    if (!selectedTask) {
      navigate("/tasks", { state: { redirectTo: "/discussion" } });
    }
  }, [selectedTask, navigate]);

  if (!selectedTask) return null;

  return (
    <>
      <UnifiedHeader />
      <Box p={4}>
        <Heading size="md" mb={4}>
          Community Discussion
        </Heading>
        <DiscussionBoard contentId={selectedTask.content_id} />
      </Box>
    </>
  );
};

export default DiscussionPage;
