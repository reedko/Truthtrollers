import { useEffect, useState } from "react";

export const useTaskDescription = (taskId: number) => {
  const [description, setDescription] = useState<string>("");

  useEffect(() => {
    const fetchDescription = async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}/description`); // Adjust the endpoint as needed
        const data = await response.json();
        setDescription(data.description); // Assuming the API returns a description field
      } catch (error) {
        console.error("Error fetching task description:", error);
      }
    };

    fetchDescription();
  }, [taskId]);

  return description;
};
