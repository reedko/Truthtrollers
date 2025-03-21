import React, { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import TaskDetailLayout from "./TaskDetailLayout";
import { useShallow } from "zustand/react/shallow";
import { fetchTaskById } from "../services/useDashboardAPI";
import { Task } from "../../../shared/entities/types";

const TaskDetail = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const passedTask = location.state?.task;

  const storeTask = useTaskStore((state) =>
    state.content.find((t) => t.content_id === Number(taskId))
  );

  const [localTask, setLocalTask] = useState<Task | null>(
    passedTask || storeTask || null
  );
  const [loading, setLoading] = useState<boolean>(!passedTask && !storeTask);

  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);
  const fetchReferences = useTaskStore((state) => state.fetchReferences);

  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers[Number(taskId)] || [])
  );
  const references = useTaskStore(
    useShallow((state) => state.references[Number(taskId)] || [])
  );

  // 🔁 Fetch the task if it's not passed or in store
  useEffect(() => {
    const loadTaskIfNeeded = async () => {
      if (!localTask && taskId) {
        try {
          const fetchedTask = await fetchTaskById(Number(taskId));
          setLocalTask(fetchedTask);
        } catch (err) {
          console.error("❌ Failed to fetch task:", err);
        } finally {
          setLoading(false);
        }
      }
    };

    loadTaskIfNeeded();
  }, [localTask, taskId]);

  // Fetch references and assigned users only once
  useEffect(() => {
    if (taskId && assignedUsers.length === 0) {
      fetchAssignedUsers(Number(taskId));
    }
    if (taskId && references.length === 0) {
      fetchReferences(Number(taskId));
    }
  }, [taskId, assignedUsers.length, references.length]);

  if (loading || !localTask) {
    return <div>Loading task...</div>;
  }

  return (
    <TaskDetailLayout
      task={localTask}
      assignedUsers={assignedUsers}
      content={references}
    />
  );
};

export default TaskDetail;
