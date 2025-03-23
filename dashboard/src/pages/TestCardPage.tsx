// src/pages/TestCardPage.tsx
import React from "react";
import TaskCard from "../components/TaskCard";

const testTask = {
  content_id: 9002,
  content_name: "Sample Task: Climate Change and Media",
  thumbnail: "assets/images/content/content_id_9002.png",
  url: "https://example.com/climate-article",
  progress: "Partially Complete",
  media_source: "web",
  assigned: "assigned",
  subtopic: [],
  users: "",
  details: "This is a mock detail for preview purposes.",
  topic: "Environment",
};

const TestCardPage = () => {
  return (
    <div style={{ padding: "40px" }}>
      <TaskCard
        task={testTask}
        testMode // ✅ forces mock data: authors, publisher, users
      />
    </div>
  );
};

export default TestCardPage;
