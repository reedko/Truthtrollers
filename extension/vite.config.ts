import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";
import { resolve } from "path";

// ✅ Load env variables from the backend folder
dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
});
