// src/components/Register.tsx
import React, { useState } from "react";
import { login, register } from "../services/authService";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import ReCAPTCHA from "react-google-recaptcha";

const Register: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const handleRegister = async () => {
    try {
      await register(username, password, email, captchaToken);

      // Auto-login after registration
      const user = await login(username, password, undefined, true);

      useAuthStore.getState().setUser(user);

      alert("Registration successful!");
      navigate("/dashboard"); // go straight to app
    } catch (error) {
      console.error("Registration failed:", error);
      alert("Registration failed. Check console.");
    }
  };

  return (
    <div>
      <h1>Register</h1>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <ReCAPTCHA
        sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY}
        onChange={(token) => setCaptchaToken(token)}
      />
      <button onClick={handleRegister}>Register</button>
    </div>
  );
};

export default Register;
