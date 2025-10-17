import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";

// ✅ Load env variables from the backend folder
dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

export default defineConfig({
  plugins: [react()],
});
