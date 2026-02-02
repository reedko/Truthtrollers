import React from "react";
import ReactDOM from "react-dom/client";
import TaskCardDemo from "./TaskCardDemo";

const root = document.getElementById("demo-root");

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <TaskCardDemo />
    </React.StrictMode>
  );
}
