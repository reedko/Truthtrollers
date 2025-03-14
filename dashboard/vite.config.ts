import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from ../backend/.env
const env =
  dotenv.config({ path: path.resolve(__dirname, "../backend/.env") }).parsed ||
  {};

// Convert env variables into Vite-friendly format
// Ensure TypeScript knows the object is a record with string values
const envKeys: Record<string, string> = Object.keys(env).reduce(
  (acc: Record<string, string>, key: string) => {
    acc[`process.env.${key}`] = JSON.stringify(env[key]); // Ensures values are correctly injected
    return acc;
  },
  {}
);

export default defineConfig({
  plugins: [react()],
  define: envKeys, // Injects the environment variables
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
