// src/pages/TaskDetail.tsx

import React, { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import TaskDetailLayout from "./TaskDetailLayout";
import { useShallow } from "zustand/react/shallow";

const TaskDetail = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const passedTask = location.state?.task;

  // Access store functions
  const fetchAuthors = useTaskStore((state) => state.fetchAuthors);
  const fetchPublishers = useTaskStore((state) => state.fetchPublishers);
  const fetchReferences = useTaskStore((state) => state.fetchReferences);
  const fetchTaskAuthors = useTaskStore((state) => state.fetchTaskAuthors);
  const fetchTaskReferences = useTaskStore(
    (state) => state.fetchTaskReferences
  );
  const fetchAuthReferences = useTaskStore(
    (state) => state.fetchAuthReferences
  );
  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);

  // Access fetched data from the store
  const authors = useTaskStore((state) => state.authors);
  const publishers = useTaskStore((state) => state.publishers);
  const references = useTaskStore(
    useShallow((state) => state.references[Number(taskId)] || [])
  );
  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers[Number(taskId)] || [])
  );

  const task_authors = useTaskStore((state) => state.task_authors);
  const task_references = useTaskStore((state) => state.task_references);
  const auth_references = useTaskStore((state) => state.auth_references);
  // Access fetched data from the store

  // Get a reference to a store selector to find the task by ID
  const storeTask = useTaskStore((state) =>
    state.tasks.find((t) => t.task_id === Number(taskId))
  );
  // Access the store
  // If passedTask is available, use it, otherwise fall back to the store
  const task = passedTask || storeTask;

  // Fetch data when component mounts or taskId changes
  useEffect(() => {
    if (taskId) {
      // Fetch authors, publishers, and references related to the taskId
      fetchAuthors(Number(taskId));
      fetchPublishers(Number(taskId));
      fetchReferences(Number(taskId));
      fetchTaskAuthors(Number(taskId));
      fetchTaskReferences(Number(taskId));
      fetchAuthReferences(); // Assuming this fetches all auth_references
    }
  }, [
    taskId,
    fetchAuthors,
    fetchPublishers,
    fetchReferences,
    fetchTaskAuthors,
    fetchTaskReferences,
    fetchAuthReferences,
  ]);

  useEffect(() => {
    if (taskId && assignedUsers.length === 0) {
      fetchAssignedUsers(Number(taskId));
    }
  }, [taskId, assignedUsers.length, fetchAssignedUsers]);

  if (!task) {
    return <div>Loading task...</div>;
  }

  return (
    <>
      <TaskDetailLayout
        task={task}
        references={references}
        assignedUsers={assignedUsers}
        authors={authors[task.task_id]}
        publishers={publishers[task.task_id]}
        lit_references={references} // Adjust based on your data structure
        task_authors={task_authors}
        task_references={task_references}
        auth_references={auth_references}
      />
    </>
  );
};

export default TaskDetail;
