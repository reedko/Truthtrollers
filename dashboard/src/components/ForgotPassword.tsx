// src/components/ForgotPassword.tsx
import React, { useState } from "react";
import { resetPassword } from "../services/authService";
import { useNavigate } from "react-router-dom";

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  const handleResetPassword = async () => {
    try {
      await resetPassword(email, "newPassword"); // You may want to implement a form to enter a new password
      alert("Password reset email sent!");
      navigate("/"); // Redirect to login after reset
    } catch (error) {
      console.error("Reset failed:", error);
    }
  };

  return (
    <div>
      <h1>Forgot Password</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
      />
      <button onClick={handleResetPassword}>Reset Password</button>
    </div>
  );
};

export default ForgotPassword;
