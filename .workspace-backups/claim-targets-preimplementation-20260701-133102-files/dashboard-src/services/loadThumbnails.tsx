import React, { useEffect, useState } from "react";
import { Task } from "../entities/useTask";

interface TaskGridProps {
  content: Task[];
}
const loadThumbnails: React.FC<TaskGridProps> = ({ content }) => {
  const [thumbnails, setThumbnails] = useState<{ [key: number]: string }>({});

  useEffect(() => {
    const loadThumbnails = async () => {
      const loadedThumbnails: { [key: number]: string } = {};
      for (const task of content) {
        try {
          const image = await import(
            `../assets/content_id_${task.content_id}.png`
          );
          loadedThumbnails[task.content_id] = image.default;
        } catch (error) {
          console.error(
            `Error loading image for content_id_${task.content_id}:`,
            error
          );
          loadedThumbnails[task.content_id] = ""; // Handle missing images
        }
      }
      setThumbnails(loadedThumbnails);
    };

    loadThumbnails();
  }, [content]);
  // ✅ Ensure the component returns something
  return (
    <div>
      {Object.entries(thumbnails).map(([taskId, thumbnail]) => (
        <img
          key={taskId}
          src={thumbnail}
          alt={`Thumbnail for content ${taskId}`}
        />
      ))}
    </div>
  );
};

export default loadThumbnails;
