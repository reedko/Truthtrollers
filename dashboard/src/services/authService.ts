import axios from 'axios';

const API_URL = 'http://localhost:5001/api/';

export const register = async (username: string, password: string, email: string) => {
  return await axios.post(`${API_URL}register`, { username, password, email });
};

export const login = async (username: string, password: string) => {
  return await axios.post(`${API_URL}login`, { username, password });
  
};

export const resetPassword = async (email: string, newPassword: string) => {
  return await axios.post(`${API_URL}reset-password`, { email, newPassword });
};


