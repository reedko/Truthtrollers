import axios from "axios";
import { User } from "../../../shared/entities/types";
import { useAuthStore } from "../store/useAuthStore";

const API_URL = import.meta.env.VITE_BASE_URL || "http://localhost:5001";
export const register = async (
  username: string,
  password: string,
  email: string,
  captcha: string | null
) => {
  return await axios.post(`${API_URL}/api/register`, {
    username,
    password,
    email,
    captcha,
  });
};

export const login = async (
  username: string,
  password: string,
  captcha?: string,
  skipCaptchaHeader: boolean = false
): Promise<User> => {
  const config = {
    headers: {} as Record<string, string>,
  };

  if (skipCaptchaHeader) {
    config.headers["x-skip-captcha"] = "true";
  }

  const res = await axios.post(
    `${API_URL}/api/login`,
    captcha ? { username, password, captcha } : { username, password },
    config
  );

  const { user, token } = res.data;
  localStorage.setItem("jwt", token);

  useAuthStore
    .getState()
    .setAuth({ ...user, jwt: token, can_post: true }, token);

  return user as User;
};

export const resetPassword = async (email: string, newPassword: string) => {
  console.log(`${API_URL}/api/reset-password`);
  return await axios.post(`${API_URL}/api/reset-password`, {
    email,
    newPassword,
  });
};
