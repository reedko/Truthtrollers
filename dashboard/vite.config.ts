import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load environment variables from backend/.env
const env =
  dotenv.config({ path: path.resolve(__dirname, "../backend/.env") }).parsed ||
  {};

// Expose backend .env vars to frontend
const envKeys: Record<string, string> = Object.keys(env).reduce(
  (acc: Record<string, string>, key: string) => {
    acc[`process.env.${key}`] = JSON.stringify(env[key]);
    return acc;
  },
  {}
);

const keyPath = env.SSL_KEY_PATH as string | undefined;
const certPath = env.SSL_CERT_PATH as string | undefined;

const hasCert =
  !!keyPath && !!certPath && fs.existsSync(keyPath) && fs.existsSync(certPath);

// Build the conditional HTTPS options only if certs exist
const httpsOptions = hasCert
  ? {
      key: fs.readFileSync(keyPath!),
      cert: fs.readFileSync(certPath!),
    }
  : undefined;

export default defineConfig({
  base: "/", // keeps paths root-relative in HTML
  plugins: [react()],
  define: envKeys,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  server: {
    // Only include `https` when we actually have certs to use
    ...(httpsOptions ? { https: httpsOptions } : {}),
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "https://localhost:5001",
        changeOrigin: true,
        secure: false,
      },
      "/assets": {
        target: "https://localhost:5001",
        changeOrigin: true,
        secure: false,
      },
    },
  },

  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        assetFileNames: "scripts/[name]-[hash][extname]",
        chunkFileNames: "scripts/[name]-[hash].js",
        entryFileNames: "scripts/[name]-[hash].js",
      },
    },
  },
});
