import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from ../backend/.env
const env =
  dotenv.config({ path: path.resolve(__dirname, "../backend/.env") }).parsed ||
  {};

const envKeys: Record<string, string> = Object.keys(env).reduce(
  (acc: Record<string, string>, key: string) => {
    acc[`process.env.${key}`] = JSON.stringify(env[key]);
    return acc;
  },
  {}
);

export default defineConfig({
  base: "/", // keeps paths root-relative in HTML
  plugins: [react()],
  define: envKeys,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist", // main output folder is still /dist
    rollupOptions: {
      output: {
        assetFileNames: "scripts/[name]-[hash][extname]",
        chunkFileNames: "scripts/[name]-[hash].js",
        entryFileNames: "scripts/[name]-[hash].js",
      },
    },
  },
});
