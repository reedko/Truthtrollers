import React from "react";
import { SimpleGrid } from "@chakra-ui/react";
import TaskCard from "./TaskCard"; // Import the TaskCard component
import { Task } from "../entities/useTask"; // Import the Task type

interface TaskGridProps {
  tasks: Task[];
  selectedTasks: number[];
  onCheckboxChange: (taskId: number) => void; // Callback for checkbox selection
}

const TaskGrid: React.FC<TaskGridProps> = ({
  tasks,
  selectedTasks,
  onCheckboxChange,
}) => {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
      {tasks.map((task) => (
        <TaskCard
          key={task.task_id}
          task={task}
          onSelect={onCheckboxChange}
          isSelected={selectedTasks.includes(task.task_id)}
        />
      ))}
    </SimpleGrid>
  );
};

export default TaskGrid;
