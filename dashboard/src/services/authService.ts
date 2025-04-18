import axios from "axios";
import { User } from "../../../shared/entities/types";

//const API_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
const API_URL = import.meta.env.VITE_BASE_URL || "http://localhost:5001";
export const register = async (
  username: string,
  password: string,
  email: string
) => {
  return await axios.post(`${API_URL}/api/register`, {
    username,
    password,
    email,
  });
};

export const login = async (
  username: string,
  password: string
): Promise<User> => {
  const res = await axios.post(`${API_URL}/api/login`, { username, password });

  const { user, token } = res.data;
  localStorage.setItem("token", token);
  return user as User;
};

export const resetPassword = async (email: string, newPassword: string) => {
  console.log(`${API_URL}/api/reset-password`);
  return await axios.post(`${API_URL}/api/reset-password`, {
    email,
    newPassword,
  });
};
