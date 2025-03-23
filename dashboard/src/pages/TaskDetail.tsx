import React, { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import TaskDetailLayout from "./TaskDetailLayout";
import {
  fetchTaskById,
  fetchAssignedUsers,
  fetchReferencesForTask,
} from "../services/useDashboardAPI";
import { Task, User, LitReference } from "../../../shared/entities/types";

const TaskDetail = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const passedTask = location.state?.task;

  const [task, setTask] = useState<Task | null>(passedTask || null);
  const [assignedUsers, setAssignedUsers] = useState<User[]>([]);
  const [references, setReferences] = useState<LitReference[]>([]);
  const [loading, setLoading] = useState(!passedTask);
  const [taskLoaded, setTaskLoaded] = useState(!!passedTask);

  // Load the task only once if not passed
  useEffect(() => {
    if (!taskId || task || taskLoaded) return;

    const loadTask = async () => {
      try {
        const fetched = await fetchTaskById(Number(taskId));
        setTask(fetched);
      } catch (err) {
        console.error("❌ Failed to fetch task:", err);
      } finally {
        setTaskLoaded(true);
        setLoading(false);
      }
    };

    loadTask();
  }, [taskId, task, taskLoaded]);

  // Load assigned users and references
  useEffect(() => {
    const loadExtras = async () => {
      if (!task?.content_id) return;
      try {
        const [users, refs] = await Promise.all([
          fetchAssignedUsers(task.content_id),
          fetchReferencesForTask(task.content_id),
        ]);
        setAssignedUsers(users);
        setReferences(refs);
      } catch (err) {
        console.error("❌ Failed to load task extras:", err);
      }
    };
    loadExtras();
  }, [task?.content_id]);

  if (loading || !task) {
    return <div>Loading task...</div>;
  }

  return (
    <TaskDetailLayout
      task={task}
      assignedUsers={assignedUsers}
      content={references}
    />
  );
};

export default TaskDetail;
