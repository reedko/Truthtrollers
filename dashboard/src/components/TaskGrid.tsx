import React from "react";
import { SimpleGrid } from "@chakra-ui/react";
import TaskCard from "./TaskCard";
import { Task } from "../entities/useTask";

const TaskGrid: React.FC<{
  tasks: Task[];
  taskUsers: { [taskId: number]: string[] };
  setTaskUsers: React.Dispatch<
    React.SetStateAction<{ [taskId: number]: string[] }>
  >;
  fetchAssignedUsers: (taskId: number) => Promise<string[]>;
  fetchReferences: (taskId: number) => Promise<string[]>;
  assignUserToTask: (taskId: number, userId: number) => Promise<void>;
}> = ({
  tasks,
  taskUsers,
  setTaskUsers,
  fetchAssignedUsers,
  fetchReferences,
  assignUserToTask,
}) => {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
      {tasks.map((task) => (
        <TaskCard
          key={task.task_id}
          task={task}
          taskUsers={taskUsers}
          assignedUsers={taskUsers[task.task_id] || []}
          setTaskUsers={setTaskUsers} // Pass setTaskUsers to TaskCard
          onFetchAssignedUsers={() => fetchAssignedUsers(task.task_id)}
          onFetchReferences={fetchReferences}
          onAssignUserToTask={assignUserToTask}
        />
      ))}
    </SimpleGrid>
  );
};

export default TaskGrid;
