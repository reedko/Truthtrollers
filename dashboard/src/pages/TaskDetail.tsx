import React, { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import TaskDetailLayout from "./TaskDetailLayout";
import { useShallow } from "zustand/react/shallow";

const TaskDetail = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const passedTask = location.state?.task;

  // Find the task from the store (fallback if not passed in location)
  const storeTask = useTaskStore((state) =>
    state.tasks.find((t) => t.task_id === Number(taskId))
  );
  const task = passedTask || storeTask;

  // Store actions for fetching assigned users & references
  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);
  const fetchReferences = useTaskStore((state) => state.fetchReferences);

  // Grab the data from the store (by taskId)
  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers[Number(taskId)] || [])
  );
  const references = useTaskStore(
    useShallow((state) => state.references[Number(taskId)] || [])
  );

  // Fetch assigned users & references once if needed
  useEffect(() => {
    if (taskId && assignedUsers.length === 0) {
      fetchAssignedUsers(Number(taskId));
    }
    if (taskId && references.length === 0) {
      fetchReferences(Number(taskId));
    }
  }, [
    taskId,
    assignedUsers.length,
    references.length,
    fetchAssignedUsers,
    fetchReferences,
  ]);

  // If we still don't have a task, we can show a loading or error message
  if (!task) {
    return <div>Loading task...</div>;
  }

  // Pass the relevant data down to the layout
  return (
    <TaskDetailLayout
      task={task}
      assignedUsers={assignedUsers}
      lit_references={references}
    />
  );
};

export default TaskDetail;
