import React from "react";
import { useNavigate } from "react-router-dom";

const Welcome: React.FC = () => {
  const navigate = useNavigate();

  const handleContinue = () => {
    navigate("/tasks");
  };

  return (
    <div>
      <h1>Welcome!</h1>
      <button onClick={handleContinue}>Continue to Tasks</button>
    </div>
  );
};

export default Welcome;
