import React from "react";
import TaskCard from "../components/TaskCard";

const testTask = {
  content_id: 9002,
  content_name: "Test Task Title",
  thumbnail: "placeholder.jpg",
  url: "https://example.com",
  progress: "Partially Complete",
};

const TestCardPage = () => {
  return (
    <div style={{ padding: "40px" }}>
      <TaskCard task={testTask} testMode />
    </div>
  );
};

export default TestCardPage;
