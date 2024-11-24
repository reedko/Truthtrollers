import { Box, Text, Link } from "@chakra-ui/react";
import { useTaskDescription } from "../hooks/useTaskDescription"; // Import the custom hook
import { Task } from "../entities/useTask"; // Import the Task type

interface TaskItemProps {
  task: Task;
}

export const TaskItem: React.FC<TaskItemProps> = ({ task }) => {
  const description = useTaskDescription(task.task_id);

  return (
    <Box borderWidth="1px" borderRadius="lg" p={4} mb={4} bg="gray.50">
      <Text fontWeight="bold">{task.task_name}</Text>
      <Text>Media Source: {task.media_source}</Text>
      <Text>
        URL:{" "}
        <Link href={task.url} isExternal color="teal.500">
          {task.url}
        </Link>
      </Text>
      <Text>Assigned: {task.assigned}</Text>
      <Text>Progress: {task.progress}</Text>
      <Text>Users: {task.users}</Text>
      <Text>Description: {description}</Text> {/* Displaying the description */}
      <Link href={`/task-details/${task.task_id}`} color="blue.500">
        View Details
      </Link>
    </Box>
  );
};
