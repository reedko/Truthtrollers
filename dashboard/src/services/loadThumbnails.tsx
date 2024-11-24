import React, { useEffect, useState } from 'react';
import { Task } from "../entities/useTask";

interface TaskGridProps {
  tasks: Task[];
}
const loadThumbnails:React.FC<TaskGridProps> = ({ tasks }) {
 
    const [thumbnails, setThumbnails] = useState<{ [key: number]: string }>({});

    useEffect(() => {
      const loadThumbnails = async () => {
        const loadedThumbnails: { [key: number]: string } = {};
        for (const task of tasks) {
          try {
            const image = await import(`../assets/task_id_${task.task_id}.png`);
            loadedThumbnails[task.task_id] = image.default;
          } catch (error) {
            console.error(
              `Error loading image for task_id_${task.task_id}:`,
              error
            );
            loadedThumbnails[task.task_id] = ""; // Handle missing images
          }
        }
        setThumbnails(loadedThumbnails);
      };
  
      loadThumbnails();
    }, [tasks]);
    
  
}

export default loadThumbnails