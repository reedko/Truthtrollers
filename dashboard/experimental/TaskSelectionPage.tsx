import { Box, Heading, VStack, Text, Button } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";

const TaskSelectionPage = () => {
  const navigate = useNavigate();
  const { assignedTasks, setSelectedTask } = useTaskStore();

  const handleSelectTask = (task) => {
    setSelectedTask(task);
    navigate("/workspace"); // or "/dashboard" if needed
  };

  return (
    <Box p={6}>
      <Heading size="md" mb={4}>
        Assigned Tasks
      </Heading>
      <VStack spacing={3}>
        {assignedTasks.length ? (
          assignedTasks.map((task) => (
            <Box
              key={task.content_id}
              p={3}
              borderWidth="1px"
              w="100%"
              borderRadius="md"
            >
              <Text fontWeight="bold">{task.content_name}</Text>
              <Button size="sm" mt={2} onClick={() => handleSelectTask(task)}>
                Open Task
              </Button>
            </Box>
          ))
        ) : (
          <Text>No tasks assigned.</Text>
        )}
      </VStack>
    </Box>
  );
};

export default TaskSelectionPage;
