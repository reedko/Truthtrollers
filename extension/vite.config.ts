import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";
import { resolve } from "path";

// ✅ Load env variables from the backend folder
dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

export default defineConfig({
  plugins: [react()],
  define: {
    // Define process.env for compatibility with webpack-style extension code
    // This only affects Vite dev server - webpack builds still use their own process.env
    'process.env': {
      REACT_APP_BASE_URL: JSON.stringify(process.env.REACT_APP_BASE_URL || 'https://localhost:5001'),
      REACT_APP_EXTENSION_BASE_URL: JSON.stringify(process.env.REACT_APP_EXTENSION_BASE_URL || 'https://localhost:5001'),
      REACT_APP_EXTENSION_URL: JSON.stringify(process.env.REACT_APP_EXTENSION_URL || 'https://localhost:5173'),
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
});
