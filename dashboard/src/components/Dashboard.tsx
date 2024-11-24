// src/components/Dashboard.tsx
import React from "react";
import { Link } from "react-router-dom";

const Dashboard: React.FC = () => {
  return (
    <div>
      <h1>Welcome to Your Dashboard</h1>
      <Link to="/tasks">Go to Tasks</Link>
    </div>
  );
};

export default Dashboard;
